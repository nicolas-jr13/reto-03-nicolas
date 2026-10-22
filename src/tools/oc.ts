import { z } from "zod"
import { anexarControl } from "../control"
import { generarEvidencia } from "../evidence"
import { leerMaestros, leerPaquete } from "../fixtures"
import { construirOrden, guardarTrazabilidad, payloadAlterado } from "../payload"
import { SapMock } from "../sap/mock"
import type { Hallazgo, Paquete, ToolContext, Validacion } from "../types"
import { toolError, toolOk } from "../types"
import { codigos, validarPaquete } from "../validate"

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : "No pude completar la operación."
}

function explicar(items: Hallazgo[]): string {
  return items.map((item) => `${item.codigo}: ${item.detalle} ${item.accion}`).join(" ")
}

function desempaquetarOrden(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload
  const root = payload as Record<string, unknown>
  if (root.orden && typeof root.orden === "object") return root.orden
  const data = root.data
  if (data && typeof data === "object" && "orden" in data && data.orden && typeof data.orden === "object") return data.orden
  return payload
}

async function preparar(directory: string, caso: string): Promise<{ paquete: Paquete; validacion: Validacion }> {
  const paquete = await leerPaquete(directory, caso)
  const validacion = validarPaquete(paquete, await leerMaestros(directory))
  return { paquete, validacion }
}

function solicitudDe(paquete: unknown): Record<string, unknown> | null {
  if (!paquete || typeof paquete !== "object") return null
  const root = paquete as Record<string, unknown>
  const base =
    root.data && typeof root.data === "object" && !("solicitud" in root) ? (root.data as Record<string, unknown>) : root
  const solicitud = base.solicitud
  return solicitud && typeof solicitud === "object" ? (solicitud as Record<string, unknown>) : null
}

function paqueteAlterado(disco: Paquete, recibido: unknown): string | null {
  const solicitud = solicitudDe(recibido)
  if (!solicitud) return null
  const campos = [
    "valor_total",
    "valor_unitario",
    "cantidad",
    "proveedor_nit",
    "proveedor_nombre",
    "centro_costo",
    "subarea",
    "indicador_iva",
    "condiciones_pago",
    "fecha_solicitud",
    "moneda",
    "solicitud_id",
  ] as const
  for (const campo of campos) {
    if (!(campo in solicitud) || solicitud[campo] === undefined) continue
    const original = disco.solicitud[campo]
    if (solicitud[campo] !== original) return `El paquete recibido altera ${campo}. Los datos salen del fixture, no del modelo.`
  }
  return null
}

async function registrar(
  ctx: ToolContext,
  validacion: Validacion,
  solicitudId: string,
  resultado: "creada" | "bloqueada" | "pendiente" | "idempotente",
  numeroOc: string,
): Promise<void> {
  await anexarControl(ctx.directory, {
    solicitud_id: solicitudId,
    resultado,
    numero_oc: numeroOc,
    retroactiva: validacion.retroactiva,
    bloqueos: codigos(validacion.bloqueos),
    confirmaciones: codigos(validacion.confirmaciones),
    ts: new Date().toISOString(),
  })
}

export const leer_paquete = {
  description: "Lee y normaliza el correo, la solicitud, la cotización, la aprobación y la factura opcional de un caso.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo sol-001."),
  },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    try {
      return toolOk(await leerPaquete(ctx.directory, args.caso))
    } catch (error) {
      return toolError(mensaje(error))
    }
  },
}

export const validar = {
  description: "Valida el caso contra maestros y controles, y separa bloqueos, confirmaciones y derivados.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso, por ejemplo sol-001."),
    paquete: z.unknown().describe("Paquete devuelto por oc_leer_paquete. No modifiques sus montos."),
  },
  async execute(args: { caso: string; paquete: unknown }, ctx: ToolContext): Promise<string> {
    try {
      const { paquete, validacion } = await preparar(ctx.directory, args.caso)
      const alterado = paqueteAlterado(paquete, args.paquete)
      if (alterado) return toolError(alterado)
      return toolOk(validacion)
    } catch (error) {
      return toolError(mensaje(error))
    }
  },
}

export const construir_payload = {
  description: "Construye la orden de compra canónica, valida su esquema y guarda la trazabilidad de cada campo.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso, por ejemplo sol-001."),
    paquete: z.unknown().describe("Paquete devuelto por oc_leer_paquete."),
    derivados: z.unknown().describe("Objeto derivados devuelto por oc_validar."),
  },
  async execute(args: { caso: string; paquete: unknown; derivados: unknown }, ctx: ToolContext): Promise<string> {
    try {
      const { paquete, validacion } = await preparar(ctx.directory, args.caso)
      const alterado = paqueteAlterado(paquete, args.paquete)
      if (alterado) return toolError(alterado)
      if (!validacion.apta) return toolError(`No construyo la OC porque hay bloqueos. ${explicar(validacion.bloqueos)}`)
      const evidencia = await generarEvidencia(ctx.directory, args.caso)
      const { orden, trazas } = construirOrden(paquete, validacion, evidencia.sha256, false)
      const trazabilidad = await guardarTrazabilidad(ctx.directory, args.caso, paquete.solicitud.solicitud_id, trazas)
      return toolOk({ orden, trazabilidad, derivados: validacion.derivados, evidencia })
    } catch (error) {
      return toolError(mensaje(error))
    }
  },
}

export const generar_evidencia = {
  description: "Genera la evidencia de aprobación en texto y PDF, y devuelve su ruta y el sha256 del contenido.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso, por ejemplo sol-001."),
  },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    try {
      return toolOk(await generarEvidencia(ctx.directory, args.caso))
    } catch (error) {
      return toolError(mensaje(error))
    }
  },
}

export const crear = {
  description: "Crea la orden en el SAP simulado si el caso es apto y las confirmaciones ya fueron aceptadas por la analista.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso, por ejemplo sol-001."),
    payload: z.unknown().describe("OrdenCompra devuelta por oc_construir_payload."),
    confirmado: z.boolean().optional().describe("True solo si la analista confirmó en un mensaje posterior."),
  },
  async execute(args: { caso: string; payload: unknown; confirmado?: boolean }, ctx: ToolContext): Promise<string> {
    try {
      const { paquete, validacion } = await preparar(ctx.directory, args.caso)
      const solicitudId = paquete.solicitud.solicitud_id
      const sap = new SapMock(ctx.directory)
      const existente = await sap.buscarOrdenPorReferencia(solicitudId)
      if (existente) {
        await registrar(ctx, validacion, solicitudId, "idempotente", existente.numero_oc)
        return toolOk({ numero_oc: existente.numero_oc, fecha: existente.fecha ?? "", idempotente: true })
      }
      if (!validacion.apta) {
        await registrar(ctx, validacion, solicitudId, "bloqueada", "")
        return toolError(`No se creó la OC. ${explicar(validacion.bloqueos)}`)
      }
      const confirmado = args.confirmado === true && ctx.confirmedByUser
      if (validacion.confirmaciones.length > 0 && !confirmado) {
        await registrar(ctx, validacion, solicitudId, "pendiente", "")
        return toolError(`La OC no se crea hasta que la analista confirme en su siguiente mensaje. ${explicar(validacion.confirmaciones)}`)
      }
      const evidencia = await generarEvidencia(ctx.directory, args.caso)
      const { orden, trazas } = construirOrden(paquete, validacion, evidencia.sha256, confirmado)
      const alterado = payloadAlterado(desempaquetarOrden(args.payload), orden)
      if (alterado) {
        await registrar(ctx, validacion, solicitudId, "bloqueada", "")
        return toolError(`${alterado} No modifiqué el payload para hacerlo coincidir.`)
      }
      const proveedorSap = await sap.consultarProveedor(orden.proveedor.nit)
      if (!proveedorSap?.activo || proveedorSap.codigo_sap !== orden.proveedor.codigo_sap) {
        await registrar(ctx, validacion, solicitudId, "bloqueada", "")
        return toolError("El adaptador SAP no confirmó el proveedor activo. No se creó la OC.")
      }
      const creada = await sap.crearOrden(orden)
      await guardarTrazabilidad(ctx.directory, args.caso, solicitudId, trazas)
      await registrar(ctx, validacion, solicitudId, "creada", creada.numero_oc)
      return toolOk({
        numero_oc: creada.numero_oc,
        fecha: creada.fecha,
        idempotente: false,
        evidencia: evidencia.ruta,
        evidencia_pdf: evidencia.ruta_pdf,
        retroactiva: validacion.retroactiva,
      })
    } catch (error) {
      return toolError(mensaje(error))
    }
  },
}
