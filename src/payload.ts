import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fechaCalendario } from "./text"
import { OrdenCompraSchema, type OrdenCompra, type Paquete, type Traza, type Validacion } from "./types"

const CONFIRMANTE = "analista"

export function construirOrden(
  paquete: Paquete,
  validacion: Validacion,
  evidenciaSha: string,
  confirmado: boolean,
): { orden: OrdenCompra; trazas: Traza[] } {
  const proveedor = validacion.derivados.proveedor
  if (!proveedor) throw new Error("No hay proveedor de maestro para armar la OC.")
  if (!paquete.aprobacion) throw new Error("No hay aprobación para armar la OC.")

  const indicador = paquete.solicitud.indicador_iva ?? validacion.derivados.indicador_iva
  const condiciones = paquete.solicitud.condiciones_pago ?? validacion.derivados.condiciones_pago
  if (!indicador || !condiciones) throw new Error("Falta indicador de IVA o condición de pago para armar la OC.")

  const descripcionOriginal = paquete.solicitud.descripcion
  const descripcion = descripcionOriginal.slice(0, 40)
  const fechaAprobacion = fechaCalendario(paquete.aprobacion.fecha) ?? paquete.aprobacion.fecha
  const trazas: Traza[] = []
  const anotar = (campo: string, valor: unknown, fuente: Traza["fuente"], nota?: string) => {
    trazas.push(nota ? { campo, valor, fuente, nota } : { campo, valor, fuente })
  }

  anotar("referencia.solicitud_id", paquete.solicitud.solicitud_id, "solicitud")
  anotar("referencia.correo_id", paquete.correo.id, "correo")
  anotar("referencia.cotizacion_ref", paquete.cotizacion?.referencia ?? null, paquete.cotizacion ? "cotizacion" : "derivado")
  anotar("sociedad", "1000", "derivado", "Constante de la sociedad del reto.")
  anotar("organizacion_compras", "1000", "derivado", "Constante de la organización de compras del reto.")
  anotar("proveedor.codigo_sap", proveedor.codigo_sap, "maestro.proveedores")
  anotar("proveedor.nit", proveedor.nit, "maestro.proveedores")
  anotar("proveedor.nombre", proveedor.nombre, "maestro.proveedores")
  anotar("moneda", paquete.solicitud.moneda, "solicitud")
  anotar(
    "condiciones_pago",
    condiciones,
    paquete.solicitud.condiciones_pago ? "solicitud" : "derivado",
    paquete.solicitud.condiciones_pago ? undefined : "Tomada de condiciones_pago_default del proveedor.",
  )
  anotar("aprobador.email", paquete.aprobacion.de, "aprobacion")
  anotar("aprobador.fecha_aprobacion", fechaAprobacion, "aprobacion")
  anotar("aprobador.evidencia_sha256", evidenciaSha, "derivado", "SHA-256 del texto de la evidencia, sin la línea del hash.")
  anotar("posiciones[0].numero", 10, "derivado", "La solicitud trae una sola posición.")
  anotar(
    "posiciones[0].descripcion",
    descripcion,
    "solicitud",
    descripcionOriginal.length > 40 ? "Texto breve SAP: primeros 40 caracteres." : undefined,
  )
  anotar("posiciones[0].cantidad", paquete.solicitud.cantidad, "solicitud")
  anotar("posiciones[0].unidad", "UN", "derivado", "La solicitud no trae unidad. Se usa UN.")
  anotar("posiciones[0].precio_unitario", paquete.solicitud.valor_unitario, "solicitud")
  anotar("posiciones[0].centro_costo", paquete.solicitud.centro_costo, "solicitud")
  anotar("posiciones[0].subarea", paquete.solicitud.subarea, "solicitud")
  anotar(
    "posiciones[0].indicador_iva",
    indicador,
    paquete.solicitud.indicador_iva ? "solicitud" : "derivado",
    paquete.solicitud.indicador_iva ? undefined : "Tomado de indicador_iva_default del proveedor.",
  )

  const excepciones = validacion.confirmaciones.map((item, index) => {
    const confirmadoPor = confirmado ? CONFIRMANTE : null
    anotar(`excepciones[${index}].codigo`, item.codigo, "derivado")
    anotar(`excepciones[${index}].detalle`, item.detalle, "derivado")
    anotar(`excepciones[${index}].confirmado_por`, confirmadoPor, "derivado", confirmado ? "La analista confirmó en el chat." : "Pendiente de confirmación.")
    return { codigo: item.codigo, detalle: item.detalle, confirmado_por: confirmadoPor }
  })

  const orden = OrdenCompraSchema.parse({
    referencia: {
      solicitud_id: paquete.solicitud.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: paquete.cotizacion?.referencia ?? null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor,
    moneda: paquete.solicitud.moneda,
    condiciones_pago: condiciones,
    aprobador: {
      email: paquete.aprobacion.de,
      fecha_aprobacion: fechaAprobacion,
      evidencia_sha256: evidenciaSha,
    },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: paquete.solicitud.cantidad,
        unidad: "UN",
        precio_unitario: paquete.solicitud.valor_unitario,
        centro_costo: paquete.solicitud.centro_costo,
        subarea: paquete.solicitud.subarea,
        indicador_iva: indicador,
      },
    ],
    excepciones,
  })

  return { orden, trazas }
}

export async function guardarTrazabilidad(directory: string, caso: string, solicitudId: string, trazas: Traza[]): Promise<string> {
  const dir = path.join(directory, "out", caso)
  await mkdir(dir, { recursive: true })
  const ruta = path.join("out", caso, "trazabilidad.json")
  await writeFile(
    path.join(directory, ruta),
    JSON.stringify({ caso, solicitud_id: solicitudId, campos: trazas }, null, 2),
    "utf8",
  )
  return ruta.replaceAll("\\", "/")
}

function leerRuta(origen: unknown, ruta: string): { present: boolean; value: unknown } {
  const partes = ruta.split(".")
  let actual: unknown = origen
  for (const parte of partes) {
    if (!actual || typeof actual !== "object") return { present: false, value: undefined }
    const match = /^([^[]+)\[(\d+)\]$/.exec(parte)
    if (match?.[1] && match[2]) {
      const lista = (actual as Record<string, unknown>)[match[1]]
      if (!Array.isArray(lista)) return { present: false, value: undefined }
      if (!(match[2] in lista)) return { present: false, value: undefined }
      actual = lista[Number(match[2])]
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(actual, parte)) return { present: false, value: undefined }
    actual = (actual as Record<string, unknown>)[parte]
  }
  return { present: true, value: actual }
}

function distinto(recibido: unknown, canonico: unknown): boolean {
  if (typeof canonico === "number") return Number(recibido) !== canonico
  if (typeof canonico === "string" && typeof recibido === "string" && canonico.length === 40) {
    return recibido.slice(0, 40) !== canonico
  }
  return recibido !== canonico
}

const CAMPOS_VIGILADOS = [
  "moneda",
  "condiciones_pago",
  "sociedad",
  "proveedor.codigo_sap",
  "proveedor.nit",
  "referencia.solicitud_id",
  "posiciones[0].cantidad",
  "posiciones[0].precio_unitario",
  "posiciones[0].centro_costo",
  "posiciones[0].subarea",
  "posiciones[0].indicador_iva",
  "posiciones[0].descripcion",
  "posiciones[0].numero",
] as const

export function payloadAlterado(recibido: unknown, canonico: OrdenCompra): string | null {
  if (!recibido || typeof recibido !== "object" || Array.isArray(recibido)) return "El payload no es un objeto."
  if (Object.keys(recibido).length === 0) return "Falta el payload de oc_construir_payload."
  const posiciones = (recibido as { posiciones?: unknown }).posiciones
  if (Array.isArray(posiciones) && posiciones.length !== canonico.posiciones.length) {
    return "El payload trae un número de posiciones distinto al de la solicitud."
  }
  for (const campo of CAMPOS_VIGILADOS) {
    const visto = leerRuta(recibido, campo)
    if (!visto.present || visto.value === undefined || visto.value === null || visto.value === "") continue
    const esperado = leerRuta(canonico, campo)
    if (distinto(visto.value, esperado.value)) return `El campo ${campo} no coincide con el valor calculado por las herramientas.`
  }
  return null
}
