import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { esConfirmacion } from "../text"
import type { LlmMessage } from "../llm/adapter"
import { crearAdaptador, estimarTokens } from "../llm/openai"
import { zodToJsonSchema } from "../llm/json-schema"
import { listarHerramientas, resumirHerramienta, runTool } from "../tools/registry"

export type ToolCallVista = {
  name: string
  arguments: unknown
  summary: string
  result: string
}

export type Turno = {
  reply: string
  toolCalls: ToolCallVista[]
  needsConfirmation: boolean
}

type Sesion = {
  id: string
  messages: LlmMessage[]
  pendingConfirmation: boolean
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function archivoSesion(directory: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)) throw new Error("Identificador de sesión inválido.")
  return path.join(directory, "out", "sessions", `${sessionId}.json`)
}

async function leerSesion(directory: string, sessionId: string): Promise<Sesion> {
  const archivo = archivoSesion(directory, sessionId)
  try {
    const raw = await readFile(archivo, "utf8")
    const data = JSON.parse(raw) as Sesion
    return {
      id: sessionId,
      messages: Array.isArray(data.messages) ? data.messages : [],
      pendingConfirmation: data.pendingConfirmation === true,
    }
  } catch {
    return { id: sessionId, messages: [], pendingConfirmation: false }
  }
}

async function guardarSesion(directory: string, sesion: Sesion): Promise<void> {
  const archivo = archivoSesion(directory, sesion.id)
  await mkdir(path.dirname(archivo), { recursive: true })
  await writeFile(archivo, JSON.stringify(sesion, null, 2), "utf8")
}

async function systemPrompt(directory: string): Promise<string> {
  const prompt = await readFile(path.join(directory, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(path.join(directory, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${prompt.trim()}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento.trim()}`
}

function pideConfirmacion(calls: ToolCallVista[]): boolean {
  let pendiente = false
  for (const call of calls) {
    let body: { ok?: boolean; error?: string; data?: { apta?: boolean; confirmaciones?: unknown[] } }
    try {
      body = JSON.parse(call.result) as typeof body
    } catch {
      continue
    }
    if (call.name === "oc_validar" && body.ok) {
      pendiente = body.data?.apta === true && (body.data.confirmaciones?.length ?? 0) > 0
    }
    if (call.name === "oc_crear" && body.ok) pendiente = false
    if (call.name === "oc_crear" && body.ok === false && /confirm/i.test(body.error ?? "")) pendiente = true
    if (call.name === "oc_validar" && body.ok && body.data?.apta === false) pendiente = false
  }
  return pendiente
}

export async function obtenerSesion(directory: string, sessionId: string): Promise<Sesion> {
  return leerSesion(directory, sessionId)
}

export async function ejecutarTurno(directory: string, sessionId: string, message: string): Promise<Turno> {
  const sesion = await leerSesion(directory, sessionId)
  const confirmedByUser = sesion.pendingConfirmation && esConfirmacion(message)
  sesion.messages = sesion.messages.filter((item) => item.role !== "system")
  sesion.messages.unshift({ role: "system", content: await systemPrompt(directory) })
  sesion.messages.push({ role: "user", content: message })

  const adaptador = crearAdaptador()
  const tools = listarHerramientas().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters),
  }))
  const maxIteraciones = envInt("MAX_TOOL_ITERATIONS", 25)
  const maxTokens = envInt("MAX_SESSION_TOKENS", 80_000)
  const vistas: ToolCallVista[] = []
  let reply = ""

  try {
    for (let iteracion = 0; iteracion < maxIteraciones; iteracion += 1) {
      if (estimarTokens(sesion.messages) > maxTokens) {
        reply = "Esta sesión llegó al tope de tokens configurado. Abra una sesión nueva para seguir. No se hizo otra llamada al modelo."
        break
      }
      const respuesta = await adaptador.enviar(sesion.messages, tools)
      if (respuesta.toolCalls?.length) {
        sesion.messages.push({ role: "assistant", content: respuesta.content, toolCalls: respuesta.toolCalls })
        for (const call of respuesta.toolCalls) {
          let argumentos: unknown = {}
          try {
            argumentos = JSON.parse(call.arguments || "{}") as unknown
          } catch {
            argumentos = {}
          }
          const result = await runTool(call.name, argumentos, {
            directory,
            sessionId,
            confirmedByUser,
          })
          vistas.push({
            name: call.name,
            arguments: argumentos,
            summary: resumirHerramienta(call.name, result),
            result,
          })
          sesion.messages.push({ role: "tool", content: result, toolCallId: call.id })
        }
        continue
      }
      reply = respuesta.content.trim()
      sesion.messages.push({ role: "assistant", content: reply })
      break
    }
    if (!reply) {
      reply = "Llegué al tope de iteraciones de herramientas. Arriba quedó lo que alcancé a verificar y lo que todavía falta."
    }
  } catch (error) {
    reply = error instanceof Error ? error.message : "No pude completar el turno. La sesión sigue activa."
    sesion.messages.push({ role: "assistant", content: reply })
  }

  const needsConfirmation = pideConfirmacion(vistas)
  sesion.pendingConfirmation = needsConfirmation
  await guardarSesion(directory, sesion)
  return { reply, toolCalls: vistas, needsConfirmation }
}
