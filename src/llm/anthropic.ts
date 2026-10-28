import Anthropic from "@anthropic-ai/sdk"
import type { LlmAdapter, LlmMessage, LlmTool } from "./adapter"

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function configuracionAnthropic(): { provider: string; model: string } {
  return {
    provider: "anthropic",
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5",
  }
}

export function crearAdaptadorAnthropic(): LlmAdapter {
  const { provider, model } = configuracionAnthropic()
  return {
    provider,
    model,
    async enviar(mensajes, herramientas) {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
      if (!apiKey) {
        throw new Error("No hay clave de Anthropic en el servidor. Péguela en ANTHROPIC_API_KEY dentro de .env y reinicie. La clave no se muestra aquí.")
      }
      const client = new Anthropic({ apiKey, timeout: envInt("LLM_TIMEOUT_MS", 60_000) })
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 4096,
          system: mensajes.filter((mensaje) => mensaje.role === "system").map((mensaje) => mensaje.content).join("\n\n"),
          messages: aMensajes(mensajes),
          tools: herramientas.map(aTool),
        })
        const toolCalls = response.content.flatMap((block) => {
          if (block.type !== "tool_use") return []
          return [{ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }]
        })
        const content = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim()
        return { role: "assistant", content, toolCalls }
      } catch (error) {
        if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || error.name === "APIConnectionTimeoutError")) {
          throw new Error("El proveedor de lenguaje no respondió a tiempo. Intente de nuevo. La sesión sigue activa.")
        }
        if (error instanceof Anthropic.APIError && error.status === 401) {
          throw new Error("El proveedor de lenguaje rechazó la clave. La sesión sigue activa.")
        }
        throw new Error("No pude contactar al proveedor de lenguaje. La sesión sigue activa.")
      }
    },
  }
}

function aTool(tool: LlmTool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  }
}

function aMensajes(mensajes: LlmMessage[]): Anthropic.MessageParam[] {
  const salida: Anthropic.MessageParam[] = []
  for (const mensaje of mensajes) {
    if (mensaje.role === "system") continue
    if (mensaje.role === "user") {
      salida.push({ role: "user", content: mensaje.content })
      continue
    }
    if (mensaje.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = []
      if (mensaje.content.trim()) content.push({ type: "text", text: mensaje.content })
      for (const call of mensaje.toolCalls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: parsear(call.arguments),
        })
      }
      salida.push({ role: "assistant", content: content.length ? content : mensaje.content || "" })
      continue
    }
    const bloque: Anthropic.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: mensaje.toolCallId ?? "tool",
      content: mensaje.content,
    }
    const ultimo = salida.at(-1)
    if (ultimo?.role === "user" && Array.isArray(ultimo.content)) {
      ultimo.content.push(bloque)
    } else {
      salida.push({ role: "user", content: [bloque] })
    }
  }
  return salida
}

function parsear(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}") as unknown
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    return {}
  }
  return {}
}
