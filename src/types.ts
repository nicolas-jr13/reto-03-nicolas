import { z } from "zod"

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export type Solicitud = z.infer<typeof SolicitudSchema>

export const CorreoSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  asunto: z.string(),
  fecha: z.string().min(1),
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).default([]),
})

export type CorreoArchivo = z.infer<typeof CorreoSchema>

export const AprobacionArchivoSchema = z.object({
  de: z.string().min(1),
  para: z.string().min(1),
  fecha: z.string().min(1),
  asunto: z.string(),
  cuerpo: z.string(),
})

export type AprobacionArchivo = z.infer<typeof AprobacionArchivoSchema>

export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})

export type Proveedor = z.infer<typeof ProveedorSchema>

export const CentroSchema = z.object({
  centro_costo: z.string(),
  subareas: z.array(z.string()),
  aprobadores: z.array(
    z.object({
      email: z.string(),
      tope: z.number(),
      nombre: z.string().optional(),
    }),
  ),
})

export type CentroCosto = z.infer<typeof CentroSchema>

export const IndicadorIvaSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  tasa: z.number(),
})

export const CondicionPagoSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  dias: z.number(),
})

export type Cotizacion = {
  proveedor: string
  nit: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
  referencia: string | null
}

export type Aprobacion = {
  de: string
  fecha: string
  aprobado: boolean
  texto: string
}

export type Factura = {
  numero: string
  fecha: string
  total: number
}

export type CorreoNormalizado = {
  id: string
  de: string
  asunto: string
  fecha: string
}

export type Paquete = {
  correo: CorreoNormalizado
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
  faltantes: string[]
}

export type Hallazgo = {
  codigo: string
  detalle: string
  accion: string
}

export type Derivados = {
  indicador_iva?: string
  condiciones_pago?: string
  proveedor?: { codigo_sap: string; nit: string; nombre: string }
  unidad: "UN"
}

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}

export type Fuente =
  | "solicitud"
  | "correo"
  | "cotizacion"
  | "maestro.proveedores"
  | "maestro.centros-costo"
  | "maestro.indicadores-iva"
  | "maestro.condiciones-pago"
  | "derivado"
  | "aprobacion"

export type Traza = { campo: string; valor: unknown; fuente: Fuente; nota?: string }

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string(),
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number(),
        descripcion: z.string().max(40),
        cantidad: z.number(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({
      codigo: z.string(),
      detalle: z.string(),
      confirmado_por: z.string().nullable(),
    }),
  ),
})

export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadores: { codigo: string; descripcion: string; tasa: number }[]
  condiciones: { codigo: string; descripcion: string; dias: number }[]
}

export type ToolContext = {
  directory: string
  sessionId: string
  confirmedByUser: boolean
}

export function toolOk(data: unknown): string {
  return JSON.stringify({ ok: true, data })
}

export function toolError(error: string): string {
  return JSON.stringify({ ok: false, error })
}
