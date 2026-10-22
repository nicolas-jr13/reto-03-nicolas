import { z } from "zod"
import { anexarJsonl } from "../control"
import { crear, construir_payload, generar_evidencia, leer_paquete, validar } from "./oc"
import { toolError, type ToolContext } from "../types"

type ToolDef = {
  description: string
  args: Record<string, z.ZodTypeAny>
  execute: (args: never, ctx: ToolContext) => Promise<string>
}

const herramientas: Record<string, ToolDef> = {
  oc_leer_paquete: leer_paquete,
  oc_validar: validar,
  oc_construir_payload: construir_payload,
  oc_generar_evidencia: generar_evidencia,
  oc_crear: crear,
}

export function listarHerramientas(): { name: string; description: string; parameters: z.ZodTypeAny }[] {
  return Object.entries(herramientas).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: z.object(tool.args),
  }))
}

export function resumirHerramienta(name: string, raw: string): string {
  try {
    const body = JSON.parse(raw) as { ok?: boolean; error?: string; data?: Record<string, unknown> }
    if (!body.ok) return `Error: ${body.error ?? "sin detalle"}`
    const data = body.data ?? {}
    if (name === "oc_leer_paquete") {
      const solicitud = data.solicitud as { solicitud_id?: string } | undefined
      const faltantes = Array.isArray(data.faltantes) ? data.faltantes.filter(Boolean) : []
      const id = solicitud?.solicitud_id ?? "de la solicitud"
      return faltantes.length ? `Leí ${id}. Faltan: ${faltantes.join(", ")}.` : `Leí ${id}. No falta ningún archivo.`
    }
    if (name === "oc_validar") {
      const bloqueos = Array.isArray(data.bloqueos) ? data.bloqueos.length : 0
      const confirmaciones = Array.isArray(data.confirmaciones) ? data.confirmaciones.length : 0
      const partes = [
        data.apta ? "El caso está apto." : "El caso no está apto.",
        bloqueos === 0 ? "Sin bloqueos." : `${bloqueos} ${bloqueos === 1 ? "bloqueo" : "bloqueos"}.`,
        confirmaciones === 0 ? "Sin confirmaciones." : `${confirmaciones} ${confirmaciones === 1 ? "confirmación" : "confirmaciones"}.`,
      ]
      if (data.retroactiva === true) partes.push("Es retroactiva.")
      return partes.join(" ")
    }
    if (name === "oc_construir_payload") return "La orden quedó armada para revisión."
    if (name === "oc_generar_evidencia") return "Quedó la evidencia de aprobación."
    if (name === "oc_crear") {
      return data.idempotente
        ? `La OC ${String(data.numero_oc ?? "")} ya existía. No se creó otra.`
        : `Creé la OC ${String(data.numero_oc ?? "")}.`
    }
    return raw.slice(0, 280)
  } catch {
    return raw.slice(0, 280)
  }
}

export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<string> {
  const tool = herramientas[name]
  if (!tool) return toolError(`Herramienta desconocida: ${name}.`)
  const parsed = z.object(tool.args).safeParse(args)
  let body: string
  if (!parsed.success) {
    const detalle = parsed.error.issues.map((issue) => `${issue.path.join(".") || "argumento"}: ${issue.message}`).join("; ")
    body = toolError(`Argumentos inválidos. ${detalle}`)
  } else {
    try {
      body = await tool.execute(parsed.data as never, ctx)
    } catch (error) {
      body = toolError(error instanceof Error ? error.message : "La herramienta falló.")
    }
  }
  await anexarJsonl(ctx.directory, "out/log.jsonl", {
    ts: new Date().toISOString(),
    sessionId: ctx.sessionId,
    tool: name,
    args,
    result: body.slice(0, 20_000),
  })
  return body
}
