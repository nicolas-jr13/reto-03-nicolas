import type { LlmAdapter, LlmMessage, LlmTool } from "./adapter"

type OpenAiToolCall = {
  id: string
  function?: { name?: string; arguments?: string }
}

type OpenAiMessage = {
  content?: string | null
  tool_calls?: OpenAiToolCall[]
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function configuracionModelo(): { provider: string; model: string; baseUrl: string } {
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, "")
  const model = process.env.OPENAI_MODEL?.trim() || "qwen/qwen3.8-27b"
  const provider = baseUrl.includes("groq.com")
    ? "groq"
    : baseUrl.includes("googleapis.com")
      ? "gemini"
      : baseUrl.includes("openai.com")
        ? "openai"
        : "openai-compatible"
  return { provider, model, baseUrl }
}

export function crearAdaptador(): LlmAdapter {
  const { provider, model, baseUrl } = configuracionModelo()
  return {
    provider,
    model,
    async enviar(mensajes, herramientas) {
      const apiKey = process.env.OPENAI_API_KEY?.trim()
      if (!apiKey) {
        throw new Error("No hay clave de Groq en el servidor. Péguela en OPENAI_API_KEY dentro de .env y reinicie. La clave no se muestra aquí.")
      }
      const timeout = envInt("LLM_TIMEOUT_MS", 60_000)
      const cuerpo = JSON.stringify({
        model,
        temperature: 0,
        messages: mensajes.map(haciaOpenAi),
        tools: herramientas.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      })
      let raw = ""
      let response: Response | null = null
      for (let intento = 1; intento <= 4; intento += 1) {
        try {
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: cuerpo,
            signal: AbortSignal.timeout(timeout),
          })
        } catch (error) {
          if (error instanceof Error && error.name === "TimeoutError") {
            throw new Error("El proveedor de lenguaje no respondió a tiempo. Intente de nuevo. La sesión sigue activa.")
          }
          throw new Error("No pude contactar al proveedor de lenguaje. La sesión sigue activa.")
        }
        raw = await response.text()
        if (response.status === 429 && intento < 4) {
          await esperar(esperaPorCupo(response, raw))
          continue
        }
        break
      }
      if (!response?.ok) {
        if (response?.status === 429) {
          throw new Error("Groq alcanzó el cupo gratis de 8.000 tokens por minuto. Espere un minuto y envíe el mismo mensaje otra vez. La sesión sigue activa.")
        }
        throw new Error(`El proveedor de lenguaje rechazó la solicitud (${response?.status ?? "sin respuesta"}). La sesión sigue activa.`)
      }
      let data: { choices?: { message?: OpenAiMessage }[] }
      try {
        data = JSON.parse(raw) as { choices?: { message?: OpenAiMessage }[] }
      } catch {
        throw new Error("El proveedor de lenguaje devolvió una respuesta ilegible. La sesión sigue activa.")
      }
      const message = data.choices?.[0]?.message
      if (!message) throw new Error("El proveedor de lenguaje no devolvió un mensaje. La sesión sigue activa.")
      return {
        role: "assistant",
        content: message.content ?? "",
        toolCalls: (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function?.name ?? "",
          arguments: call.function?.arguments ?? "{}",
        })),
      }
    },
  }
}

function esperaPorCupo(response: Response, body: string): number {
  const cabecera = aMilisegundos(response.headers.get("retry-after"))
    ?? aMilisegundos(response.headers.get("x-ratelimit-reset-tokens"))
  const texto = body.match(/try again in ([0-9.]+)s/i)
  const cuerpo = texto?.[1] ? Math.ceil(Number(texto[1]) * 1000) : null
  const espera = Math.max(cabecera ?? 0, cuerpo ?? 0, cabecera === null && cuerpo === null ? 8_000 : 500)
  return Math.min(espera + 400, 45_000)
}

function aMilisegundos(valor: string | null): number | null {
  if (!valor) return null
  const texto = valor.trim()
  if (/^\d+(\.\d+)?$/.test(texto)) return Math.ceil(Number(texto) * 1000)
  let total = 0
  let encontro = false
  const minutos = texto.match(/(\d+)m(?!s)/)
  const segundos = texto.match(/(\d+(?:\.\d+)?)s/)
  const milis = texto.match(/(\d+)ms/)
  if (minutos?.[1]) {
    total += Number(minutos[1]) * 60_000
    encontro = true
  }
  if (segundos?.[1]) {
    total += Number(segundos[1]) * 1000
    encontro = true
  }
  if (milis?.[1]) {
    total += Number(milis[1])
    encontro = true
  }
  return encontro ? Math.ceil(total) : null
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function haciaOpenAi(message: LlmMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

export function estimarTokens(mensajes: LlmMessage[]): number {
  const chars = mensajes.reduce((total, message) => {
    const calls = message.toolCalls?.reduce((sum, call) => sum + call.arguments.length + call.name.length, 0) ?? 0
    return total + message.content.length + calls
  }, 0)
  return Math.ceil(chars / 4)
}
