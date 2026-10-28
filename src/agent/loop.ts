import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { LlmMessage } from "../llm/adapter"
import { crearAdaptador, estimarTokens } from "../llm/factory"
import { zodToJsonSchema } from "../llm/json-schema"
import { raizEscritura } from "../raiz"
import { listarHerramientas, resumirHerramienta, runTool } from "../tools/registry"
import type { ToolContext } from "../types"

export type EstadoSesion =
  | "inicio"
  | "solicitud_leida"
  | "campos_mapeados"
  | "formulario_generado"
  | "esperando_confirmacion"
  | "envio_simulado"

export type ToolCallVista = {
  name: string
  arguments: unknown
  summary: string
  result: string
}

export type RespaldoSesion = {
  messages: LlmMessage[]
  estado: EstadoSesion
  caso: string | null
}

export type Turno = {
  reply: string
  toolCalls: ToolCallVista[]
  needsConfirmation: boolean
  estado: EstadoSesion
  caso: string | null
  respaldo: RespaldoSesion
}

type Sesion = {
  id: string
  messages: LlmMessage[]
  estado: EstadoSesion
  caso: string | null
}

const ESTADOS = new Set<EstadoSesion>([
  "inicio",
  "solicitud_leida",
  "campos_mapeados",
  "formulario_generado",
  "esperando_confirmacion",
  "envio_simulado",
])

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function esConfirmacionExplicita(mensaje: string): boolean {
  const texto = mensaje.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  if (/\bno\b/.test(texto) && /envi/.test(texto)) return false
  return /^(si\b|envia\b|enviar\b|envialo\b|confirmo\b|confirmado\b|adelante\b|apruebo\b|de acuerdo\b|ok\b|vale\b|procede\b)/.test(texto)
}

function archivoSesion(directory: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)) throw new Error("Identificador de sesión inválido.")
  return path.join(raizEscritura(directory), "out", "sessions", `${sessionId}.json`)
}

async function leerSesion(directory: string, sessionId: string): Promise<Sesion> {
  try {
    const data = JSON.parse(await readFile(archivoSesion(directory, sessionId), "utf8")) as Partial<Sesion>
    const estado = ESTADOS.has(data.estado as EstadoSesion) ? (data.estado as EstadoSesion) : "inicio"
    return {
      id: sessionId,
      messages: Array.isArray(data.messages) ? data.messages : [],
      estado,
      caso: typeof data.caso === "string" && data.caso.trim() ? data.caso : null,
    }
  } catch {
    return { id: sessionId, messages: [], estado: "inicio", caso: null }
  }
}

async function guardarSesion(directory: string, sesion: Sesion): Promise<void> {
  const archivo = archivoSesion(directory, sesion.id)
  await mkdir(path.dirname(archivo), { recursive: true })
  await writeFile(archivo, JSON.stringify(sesion, null, 2), "utf8")
}

async function systemPrompt(directory: string, sesion: Sesion): Promise<string> {
  const prompt = await readFile(path.join(directory, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(path.join(directory, "src", "knowledge", "registro-proveedor.md"), "utf8")
  return [
    prompt.trim(),
    "",
    "# Conocimiento del proceso",
    conocimiento.trim(),
    "",
    "# Estado persistente de la sesión",
    `Estado: ${sesion.estado}`,
    `Caso activo: ${sesion.caso ?? "ninguno"}`,
  ].join("\n")
}

export async function obtenerSesion(directory: string, sessionId: string): Promise<Sesion> {
  return leerSesion(directory, sessionId)
}

export async function ejecutarTurno(directory: string, sessionId: string, message: string, respaldo?: unknown): Promise<Turno> {
  const sesion = await leerSesion(directory, sessionId)
  const previa = interpretarRespaldo(respaldo)
  const guardados = sesion.messages.filter((item) => item.role !== "system").length
  if (previa && previa.messages.length >= guardados) {
    sesion.messages = previa.messages
    sesion.estado = previa.estado
    sesion.caso = previa.caso
  }
  sesion.messages = sesion.messages.filter((item) => item.role !== "system")
  sesion.messages.unshift({ role: "system", content: await systemPrompt(directory, sesion) })
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
  const ctx: ToolContext = {
    directory,
    sessionId,
    confirmacionExplicita: esConfirmacionExplicita(message),
  }
  let reply = ""

  try {
    for (let iteracion = 0; iteracion < maxIteraciones; iteracion += 1) {
      if (estimarTokens(sesion.messages) > maxTokens) {
        reply = "Esta sesión llegó al tope de uso configurado. Abra una sesión nueva para seguir."
        break
      }
      const respuesta = await adaptador.enviar(sesion.messages, tools)
      if (respuesta.toolCalls?.length) {
        sesion.messages.push({ role: "assistant", content: respuesta.content, toolCalls: respuesta.toolCalls })
        for (const call of respuesta.toolCalls) {
          const argumentos = parsearArgumentos(call.arguments)
          const result = await runTool(call.name, argumentos, ctx)
          const caso = casoDe(argumentos)
          if (caso) sesion.caso = caso
          sesion.estado = siguienteEstado(sesion.estado, call.name, result)
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
      reply = "Llegué al tope de iteraciones de herramientas. Esto es lo que alcancé a preparar y lo que todavía falta."
    }
  } catch (error) {
    reply = error instanceof Error ? error.message : "No pude completar el turno. La sesión sigue activa."
    sesion.messages.push({ role: "assistant", content: reply })
  }

  const needsConfirmation = pideConfirmacion(vistas, reply, sesion.estado)
  if (needsConfirmation && !reply.includes("¿")) {
    reply = `${reply}\n\n¿Confirmas cómo seguimos? Si quieres el envío simulado, responde «envía». No firmo ni envío nada sin esa confirmación.`
    const ultimo = sesion.messages.at(-1)
    if (ultimo?.role === "assistant" && !ultimo.toolCalls?.length) ultimo.content = reply
  }

  await guardarSesion(directory, sesion)
  return {
    reply,
    toolCalls: vistas,
    needsConfirmation,
    estado: sesion.estado,
    caso: sesion.caso,
    respaldo: {
      messages: sesion.messages.filter((item) => item.role !== "system"),
      estado: sesion.estado,
      caso: sesion.caso,
    },
  }
}

function interpretarRespaldo(valor: unknown): RespaldoSesion | null {
  if (!valor || typeof valor !== "object") return null
  const data = valor as { messages?: unknown; estado?: unknown; caso?: unknown }
  if (!Array.isArray(data.messages)) return null
  const messages: LlmMessage[] = []
  for (const item of data.messages) {
    if (!item || typeof item !== "object") continue
    const fila = item as LlmMessage
    if (fila.role !== "user" && fila.role !== "assistant" && fila.role !== "tool") continue
    if (typeof fila.content !== "string") continue
    messages.push({
      role: fila.role,
      content: fila.content,
      toolCallId: typeof fila.toolCallId === "string" ? fila.toolCallId : undefined,
      toolCalls: Array.isArray(fila.toolCalls) ? fila.toolCalls : undefined,
    })
  }
  if (!messages.some((item) => item.role === "user")) return null
  return {
    messages,
    estado: ESTADOS.has(data.estado as EstadoSesion) ? (data.estado as EstadoSesion) : "inicio",
    caso: typeof data.caso === "string" && data.caso.trim() ? data.caso : null,
  }
}

function parsearArgumentos(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}") as unknown
  } catch {
    return {}
  }
}

function casoDe(args: unknown): string | null {
  if (!args || typeof args !== "object" || !("caso" in args)) return null
  const caso = (args as { caso?: unknown }).caso
  return typeof caso === "string" && caso.trim() ? caso : null
}

function siguienteEstado(actual: EstadoSesion, herramienta: string, raw: string): EstadoSesion {
  try {
    if ((JSON.parse(raw) as { ok?: boolean }).ok !== true) return actual
  } catch {
    return actual
  }
  if (herramienta === "proveedor_leer_solicitud") return "solicitud_leida"
  if (herramienta === "proveedor_mapear_campos") return "campos_mapeados"
  if (herramienta === "proveedor_generar_formulario") return "formulario_generado"
  if (herramienta === "proveedor_armar_paquete") return "esperando_confirmacion"
  if (herramienta === "proveedor_simular_envio") return "envio_simulado"
  return actual
}

function pideConfirmacion(vistas: ToolCallVista[], reply: string, estado: EstadoSesion): boolean {
  if (estado === "envio_simulado") return false
  if (estado === "esperando_confirmacion") return true
  for (const vista of vistas) {
    if (vista.name !== "proveedor_mapear_campos") continue
    try {
      const body = JSON.parse(vista.result) as { ok?: boolean; data?: { requiere_confirmacion?: unknown[] } }
      if (body.ok && (body.data?.requiere_confirmacion?.length ?? 0) > 0) return true
    } catch {
      continue
    }
  }
  return /¿/.test(reply) && /confirm|envi|firma/i.test(reply)
}
