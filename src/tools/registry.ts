import { z } from "zod"
import { anexarJsonl } from "../control"
import { toolError, type ToolContext } from "../types"
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, simular_envio } from "./proveedor"

type ToolDef = {
  description: string
  args: Record<string, z.ZodTypeAny>
  execute: (args: never, ctx: ToolContext) => Promise<string>
}

const herramientas: Record<string, ToolDef> = {
  proveedor_leer_solicitud: leer_solicitud,
  proveedor_mapear_campos: mapear_campos,
  proveedor_generar_formulario: generar_formulario,
  proveedor_armar_paquete: armar_paquete,
  proveedor_simular_envio: simular_envio,
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
    if (!body.ok) return body.error ?? "La herramienta no pudo completar la acción."
    const data = body.data ?? {}
    if (name === "proveedor_leer_solicitud") {
      const campos = Array.isArray(data.campos) ? data.campos.length : 0
      const soportes = Array.isArray(data.soportes) ? data.soportes.length : 0
      return `${String(data.cliente ?? "")} · ${String(data.pais ?? "")} · ${String(data.formato ?? "")} · ${campos} campos · ${soportes} soportes`
    }
    if (name === "proveedor_mapear_campos") {
      return `${contar(data.llenos)} llenos, ${contar(data.faltantes)} faltantes, ${contar(data.requiere_confirmacion)} por confirmar`
    }
    if (name === "proveedor_generar_formulario") {
      const aviso = typeof data.aviso === "string" ? ` · ${data.aviso}` : ""
      return `${String(data.formato ?? "")}${aviso} · ${String(data.ruta ?? "")}`
    }
    if (name === "proveedor_armar_paquete") {
      return `listo_para_firma=${String(data.listo_para_firma)} · ${String(data.ruta ?? "")}`
    }
    if (name === "proveedor_simular_envio") return String(data.ruta ?? "Envío simulado registrado.")
    return "Acción completada."
  } catch {
    return "La herramienta devolvió una respuesta ilegible."
  }
}

function contar(valor: unknown): number {
  return Array.isArray(valor) ? valor.length : 0
}

export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<string> {
  const tool = herramientas[name]
  let body: string
  if (!tool) {
    body = toolError(`Herramienta desconocida: ${name}.`)
  } else {
    const parsed = z.object(tool.args).safeParse(args)
    if (!parsed.success) {
      const detalle = parsed.error.issues.map((issue) => `${issue.path.join(".") || "argumento"}: ${issue.message}`).join("; ")
      body = toolError(`Argumentos inválidos. ${detalle}`)
    } else {
      body = await tool.execute(parsed.data as never, ctx)
    }
  }
  let ok = false
  try {
    ok = (JSON.parse(body) as { ok?: boolean }).ok === true
  } catch {
    ok = false
  }
  await anexarJsonl(ctx.directory, "out/log.jsonl", {
    ts: new Date().toISOString(),
    sessionId: ctx.sessionId,
    herramienta: name,
    ok,
    resumen: resumirHerramienta(name, body),
  })
  return body
}
