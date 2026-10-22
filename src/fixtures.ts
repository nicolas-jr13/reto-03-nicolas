import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { estaAprobado, fechaCalendario, parseMonto } from "./text"
import {
  AprobacionArchivoSchema,
  CentroSchema,
  CondicionPagoSchema,
  CorreoSchema,
  IndicadorIvaSchema,
  ProveedorSchema,
  SolicitudSchema,
  type Cotizacion,
  type Factura,
  type Maestros,
  type Paquete,
} from "./types"

const CASO_RE = /^sol-\d{3}$/

export function assertCaso(caso: string): string {
  const name = caso.trim()
  if (!CASO_RE.test(name)) {
    throw new Error(`Caso inválido "${caso}". Use la carpeta, por ejemplo sol-001.`)
  }
  return name
}

export function dirCaso(directory: string, caso: string): string {
  const name = assertCaso(caso)
  const base = path.resolve(directory, "fixtures", "reto-03", "solicitudes")
  const dir = path.resolve(base, name)
  if (!dir.startsWith(base + path.sep)) throw new Error("Ruta de caso fuera de fixtures.")
  return dir
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function formatoZod(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "dato"}: ${issue.message}`).join("; ")
}

export function parseCotizacion(texto: string): Cotizacion {
  const proveedor = texto.match(/^Proveedor:\s*(.+)$/m)?.[1]?.trim() ?? ""
  const nitRaw = texto.match(/^NIT:\s*(.+)$/m)?.[1]?.trim() ?? ""
  const totalLine = texto.match(/^TOTAL(?:\s*\([^)\n]*\))?\s*:\s*([A-Z]{3})\s*([\d.,]+)\s*$/m)
  if (!proveedor || !totalLine?.[1] || !totalLine[2]) {
    throw new Error("La cotización no trae proveedor o total legible. Pida el PDF o el texto de la oferta otra vez.")
  }
  const total = parseMonto(totalLine[2])
  if (total === null) throw new Error("El total de la cotización no es numérico.")
  const validez = texto.match(/^Validez de la oferta:\s*(.+)$/m)?.[1]?.trim() ?? null
  const referencia = texto.match(/^COTIZACI[ÓO]N\s+(\S+)/m)?.[1] ?? null
  return {
    proveedor,
    nit: nitRaw ? nitRaw.replace(/\D/g, "") || null : null,
    total,
    moneda: totalLine[1],
    validez_hasta: validez ? fechaCalendario(validez) : null,
    texto,
    referencia,
  }
}

export function parseFactura(texto: string): Factura {
  const numero = texto.match(/No\.\s*([A-Za-z0-9-]+)/)?.[1]
  const fecha = texto.match(/Fecha de emisi[oó]n:\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
  const totalLine = texto.match(/^TOTAL:\s*[A-Z]{3}\s*([\d.,]+)\s*$/m)
  const total = totalLine?.[1] ? parseMonto(totalLine[1]) : null
  if (!numero || !fecha || total === null) {
    throw new Error("La factura no trae número, fecha o total legible. Pida el documento otra vez.")
  }
  return { numero, fecha, total }
}

function esperado(adjuntos: string[], token: string): boolean {
  return adjuntos.some((nombre) => nombre.toLowerCase().includes(token))
}

export async function leerPaquete(directory: string, caso: string): Promise<Paquete> {
  const dir = dirCaso(directory, caso)
  const correoRaw = await readText(path.join(dir, "correo.json"))
  const solicitudRaw = await readText(path.join(dir, "solicitud.json"))
  if (!correoRaw || !solicitudRaw) {
    const faltan = [!correoRaw ? "correo.json" : null, !solicitudRaw ? "solicitud.json" : null].filter(Boolean)
    throw new Error(`Paquete incompleto en ${caso}. Falta ${faltan.join(" y ")}. Pida al solicitante reenviar el correo con esos adjuntos.`)
  }

  let correoJson: unknown
  let solicitudJson: unknown
  try {
    correoJson = JSON.parse(correoRaw)
  } catch {
    throw new Error(`correo.json de ${caso} está malformado. Pida el correo otra vez.`)
  }
  try {
    solicitudJson = JSON.parse(solicitudRaw)
  } catch {
    throw new Error(`solicitud.json de ${caso} está malformado. Pida el Excel de la solicitud otra vez.`)
  }

  const correoParsed = CorreoSchema.safeParse(correoJson)
  if (!correoParsed.success) {
    throw new Error(`El correo de ${caso} no tiene la forma esperada (${formatoZod(correoParsed.error)}).`)
  }
  const solicitudParsed = SolicitudSchema.safeParse(solicitudJson)
  if (!solicitudParsed.success) {
    const texto = formatoZod(solicitudParsed.error)
    const monto = /cantidad|valor_unitario|valor_total/.test(texto)
    throw new Error(
      monto
        ? `Hay un monto o una cantidad no numérica en ${caso}. ${texto}. Pida al solicitante corregir el Excel.`
        : `La solicitud de ${caso} no tiene la forma esperada (${texto}).`,
    )
  }

  const faltantes: string[] = []
  const cotizacionTexto = await readText(path.join(dir, "cotizacion.txt"))
  let cotizacion: Cotizacion | null = null
  if (cotizacionTexto === null) {
    if (esperado(correoParsed.data.adjuntos, "cotizacion")) faltantes.push("cotizacion")
  } else {
    cotizacion = parseCotizacion(cotizacionTexto)
  }

  const aprobacionTexto = await readText(path.join(dir, "aprobacion.json"))
  let aprobacion: Paquete["aprobacion"] = null
  if (aprobacionTexto === null) {
    if (esperado(correoParsed.data.adjuntos, "aprobacion")) faltantes.push("aprobacion")
  } else {
    let json: unknown
    try {
      json = JSON.parse(aprobacionTexto)
    } catch {
      throw new Error(`aprobacion.json de ${caso} está malformado. Pida el correo del líder otra vez.`)
    }
    const parsed = AprobacionArchivoSchema.safeParse(json)
    if (!parsed.success) throw new Error(`La aprobación de ${caso} no tiene de, para, fecha, asunto y cuerpo.`)
    aprobacion = {
      de: parsed.data.de,
      fecha: parsed.data.fecha,
      aprobado: estaAprobado(parsed.data.cuerpo),
      texto: parsed.data.cuerpo,
    }
  }

  const facturaTexto = await readText(path.join(dir, "factura.txt"))
  let factura: Factura | null = null
  if (facturaTexto === null) {
    if (esperado(correoParsed.data.adjuntos, "factura")) faltantes.push("factura")
  } else {
    factura = parseFactura(facturaTexto)
  }

  return {
    correo: {
      id: correoParsed.data.id,
      de: correoParsed.data.de,
      asunto: correoParsed.data.asunto,
      fecha: correoParsed.data.fecha,
    },
    solicitud: solicitudParsed.data,
    cotizacion,
    aprobacion,
    factura,
    faltantes,
  }
}

export async function leerAprobacionArchivo(directory: string, caso: string) {
  const dir = dirCaso(directory, caso)
  const raw = await readText(path.join(dir, "aprobacion.json"))
  if (!raw) return null
  const parsed = AprobacionArchivoSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error(`La aprobación de ${caso} no tiene los encabezados requeridos.`)
  return parsed.data
}

export async function leerMaestros(directory: string): Promise<Maestros> {
  const base = path.resolve(directory, "fixtures", "reto-03", "maestros")
  const leer = async (nombre: string) => {
    const raw = await readText(path.join(base, nombre))
    if (!raw) throw new Error(`Falta el maestro ${nombre}.`)
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new Error(`El maestro ${nombre} está malformado.`)
    }
  }
  return {
    proveedores: z.array(ProveedorSchema).parse(await leer("proveedores.json")),
    centros: z.array(CentroSchema).parse(await leer("centros-costo.json")),
    indicadores: z.array(IndicadorIvaSchema).parse(await leer("indicadores-iva.json")),
    condiciones: z.array(CondicionPagoSchema).parse(await leer("condiciones-pago.json")),
  }
}
