import { existsSync } from "node:fs"
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { z } from "zod"
import { anexarJsonl } from "../control"
import { raizEscritura } from "../raiz"
import { toolError, toolOk, type ToolContext } from "../types"

export const UMBRAL_CONFIANZA = 0.85

const ID_POR_PAIS: Record<string, string> = {
  CO: "NIT",
  EC: "RUC",
  PE: "RUC",
  PA: "RUC",
  HN: "RTN",
}

const ETIQUETAS_TRIBUTO = new Set([
  "NIT",
  "RUC",
  "RTN",
  "Identificación tributaria",
  "Número de identificación fiscal",
])

const ETIQUETAS_AMBIGUAS = new Set(["Identificación tributaria", "Número de identificación fiscal"])

const campoSchema = z.object({
  etiqueta: z.string().optional(),
  estado: z.string().optional(),
  confianza: z.number().optional(),
  ruta: z.string().optional(),
  valor: z.union([z.string(), z.number(), z.boolean()]).optional(),
  nota: z.string().optional(),
})

export const leer_solicitud = {
  description: "Lee la solicitud de un caso y devuelve país, cliente, formato, campos y soportes exigidos.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  },
  async execute(args: { caso: string }, ctx: ToolContext) {
    return envolver("proveedor_leer_solicitud", args.caso, ctx, () => cargarSolicitud(ctx.directory, args.caso))
  },
}

export const mapear_campos = {
  description: "Cruza los campos pedidos con el maestro y el glosario, sin inventar valores.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    campos: z.array(z.string()).describe("Etiquetas solicitadas por la plantilla del cliente"),
  },
  async execute(args: { caso: string; campos: string[] }, ctx: ToolContext) {
    return envolver("proveedor_mapear_campos", args.caso, ctx, async () => {
      const base = await baseDelCaso(ctx.directory, args.caso)
      if (!base.ok) return base
      const mapeo = mapearEtiquetas(args.campos, base.data.solicitud.pais, base.data.glosario, base.data.maestro)
      return { ok: true, data: mapeo }
    })
  },
}

export const generar_formulario = {
  description: "Genera el formulario del caso en Excel, PDF o un listado copiable si el formato es un portal.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    mapeo: z
      .object({
        llenos: z.array(campoSchema).optional(),
        faltantes: z.array(campoSchema).optional(),
        requiere_confirmacion: z.array(campoSchema).optional(),
      })
      .describe("Resultado de proveedor_mapear_campos. Los valores escritos salen del maestro, no de este objeto."),
  },
  async execute(args: { caso: string; mapeo: unknown }, ctx: ToolContext) {
    return envolver("proveedor_generar_formulario", args.caso, ctx, () => escribirFormulario(ctx.directory, args.caso))
  },
}

export const armar_paquete = {
  description: "Arma el paquete de firma con formulario, soportes, checklist y borrador de correo.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  },
  async execute(args: { caso: string }, ctx: ToolContext) {
    return envolver("proveedor_armar_paquete", args.caso, ctx, () => armar(ctx.directory, args.caso))
  },
}

export const simular_envio = {
  description: "Escribe el archivo de envío simulado solo si el usuario confirmó en el turno anterior.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    confirmado: z.boolean().describe("True solo cuando la analista confirmó el envío de forma explícita"),
  },
  async execute(args: { caso: string; confirmado: boolean }, ctx: ToolContext) {
    return envolver("proveedor_simular_envio", args.caso, ctx, async () => {
      if (args.confirmado !== true || !ctx.confirmacionExplicita) {
        return { ok: false, error: "requiere confirmación explícita" }
      }
      const nombre = segmentoCaso(args.caso)
      if (!nombre) return { ok: false, error: "El caso indicado no es válido." }
      const dir = path.join(ctx.directory, "fixtures", "reto-01", "casos", nombre)
      if (!existsSync(dir)) return { ok: false, error: `No existe el caso «${nombre}».` }
      const relativo = `out/${nombre}/ENVIO-SIMULADO.md`
      await escribirTexto(ctx.directory, relativo, markdownEnvio(nombre))
      return { ok: true, data: { ruta: relativo } }
    })
  },
}

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

type Solicitud = {
  id: string
  de: string
  asunto: string
  fecha: string
  pais: string
  cliente: string
  formato: string
  cuerpo: string
  adjuntos: string[]
}

type Celda = { hoja: string; celda_etiqueta: string; etiqueta: string; celda_valor: string }
type CampoPdf = { etiqueta: string; obligatorio?: boolean }

export type CampoMapeado = {
  etiqueta: string
  estado: "lleno" | "faltante" | "requiere_confirmacion"
  confianza: number
  ruta?: string
  valor?: string | number | boolean
  nota?: string
  equivalente_pais?: string
}

export type Mapeo = {
  llenos: CampoMapeado[]
  faltantes: CampoMapeado[]
  requiere_confirmacion: CampoMapeado[]
}

type SoporteMaestro = {
  tipo: string
  archivo: string
  vigencia_hasta: string | null
  pais_emisor: string
  descripcion: string
}

export type ItemChecklist = {
  tipo: string
  estado: "presente" | "ausente" | "vencido"
  vigencia_hasta: string | null
  archivo?: string
  descripcion?: string
}

type BaseCaso = {
  solicitud: Solicitud
  glosario: Record<string, string>
  maestro: Record<string, unknown>
  etiquetas: string[]
  plantillaCeldas: Celda[] | null
  plantillaCampos: CampoPdf[] | null
  soportesExigidos: string[]
  advertencias: string[]
}

export function fechaLocal(fecha = new Date()): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0")
  const dia = String(fecha.getDate()).padStart(2, "0")
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

export function interpretarJson(raw: string): Resultado<unknown> {
  try {
    return { ok: true, data: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false, error: "El archivo está corrupto o no es JSON válido." }
  }
}

export async function listarCasos(directory: string): Promise<string[]> {
  const dir = path.join(directory, "fixtures", "reto-01", "casos")
  const entradas = await readdir(dir, { withFileTypes: true })
  return entradas.filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name).sort()
}

async function envolver<T>(
  herramienta: string,
  caso: string,
  ctx: ToolContext,
  tarea: () => Promise<Resultado<T>>,
): Promise<string> {
  try {
    const resultado = await tarea()
    await bitacora(ctx, caso, herramienta, resultado.ok, resultado.ok ? "ok" : resultado.error)
    return resultado.ok ? toolOk(resultado.data) : toolError(resultado.error)
  } catch {
    const error = "No pude completar la herramienta. El proceso puede seguir con otro caso."
    await bitacora(ctx, caso, herramienta, false, error)
    return toolError(error)
  }
}

async function bitacora(ctx: ToolContext, caso: string, herramienta: string, ok: boolean, resumen: string): Promise<void> {
  const nombre = segmentoCaso(caso)
  if (!nombre) return
  await anexarJsonl(ctx.directory, path.join("out", nombre, "log.jsonl"), {
    ts: new Date().toISOString(),
    herramienta,
    ok,
    resumen,
  })
}

function segmentoCaso(caso: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(caso) ? caso : null
}

async function cargarSolicitud(directory: string, caso: string): Promise<Resultado<Record<string, unknown>>> {
  const base = await baseDelCaso(directory, caso)
  if (!base.ok) return base
  const { solicitud, etiquetas, soportesExigidos, advertencias } = base.data
  return {
    ok: true,
    data: {
      pais: solicitud.pais,
      cliente: solicitud.cliente,
      formato: solicitud.formato,
      campos: etiquetas,
      soportes: soportesExigidos,
      de: solicitud.de,
      asunto: solicitud.asunto,
      fecha: solicitud.fecha,
      advertencias,
    },
  }
}

async function baseDelCaso(directory: string, caso: string): Promise<Resultado<BaseCaso>> {
  const nombre = segmentoCaso(caso)
  if (!nombre) return { ok: false, error: "El caso indicado no es válido." }
  const dir = path.join(directory, "fixtures", "reto-01", "casos", nombre)
  if (!existsSync(dir)) return { ok: false, error: `No existe el caso «${nombre}».` }
  const solicitudJson = await leerArchivoJson(path.join(dir, "solicitud.json"))
  if (!solicitudJson.ok) return { ok: false, error: "No pude leer la solicitud. El archivo falta o está corrupto." }
  const solicitud = comoSolicitud(solicitudJson.data)
  if (!solicitud) return { ok: false, error: "La solicitud no trae los campos mínimos del caso." }

  const glosarioJson = await leerArchivoJson(path.join(directory, "fixtures", "reto-01", "glosario-campos.json"))
  const maestroJson = await leerArchivoJson(path.join(directory, "fixtures", "reto-01", "repositorio", "maestro.json"))
  if (!glosarioJson.ok || !maestroJson.ok) {
    return { ok: false, error: "No pude leer el maestro o el glosario." }
  }
  const glosario = comoGlosario(glosarioJson.data)
  const maestro = comoObjeto(maestroJson.data)
  if (!glosario || !maestro) return { ok: false, error: "El maestro o el glosario no tienen la forma esperada." }

  const advertencias: string[] = []
  let etiquetas: string[] = []
  let plantillaCeldas: Celda[] | null = null
  let plantillaCampos: CampoPdf[] | null = null
  const archivo = archivoPlantilla(solicitud.formato)
  if (!archivo) {
    advertencias.push("formato no soportado")
  } else {
    const plantilla = await leerArchivoJson(path.join(dir, archivo))
    if (!plantilla.ok) {
      advertencias.push(plantilla.error)
    } else if (solicitud.formato === "xlsx") {
      plantillaCeldas = comoCeldas(plantilla.data)
      if (!plantillaCeldas) advertencias.push("La plantilla Excel no tiene celdas legibles.")
      else etiquetas = plantillaCeldas.map((celda) => celda.etiqueta)
    } else {
      plantillaCampos = comoCamposPdf(plantilla.data)
      if (!plantillaCampos) advertencias.push("La plantilla de campos no tiene etiquetas legibles.")
      else etiquetas = plantillaCampos.map((campo) => campo.etiqueta)
    }
  }

  let soportesExigidos: string[] = []
  const soportes = await leerArchivoJson(path.join(dir, "soportes-exigidos.json"))
  if (!soportes.ok) advertencias.push("No pude leer la lista de soportes exigidos.")
  else {
    const lista = comoTextos(soportes.data)
    if (!lista) advertencias.push("La lista de soportes exigidos no es legible.")
    else soportesExigidos = lista
  }

  return {
    ok: true,
    data: { solicitud, glosario, maestro, etiquetas, plantillaCeldas, plantillaCampos, soportesExigidos, advertencias },
  }
}

function archivoPlantilla(formato: string): string | null {
  if (formato === "xlsx") return "plantilla-celdas.json"
  if (formato === "pdf" || formato === "portal") return "plantilla-campos.json"
  return null
}

async function escribirFormulario(directory: string, caso: string): Promise<Resultado<{ ruta: string; formato: string; aviso?: string }>> {
  const base = await baseDelCaso(directory, caso)
  if (!base.ok) return base
  const mapeo = mapearEtiquetas(base.data.etiquetas, base.data.solicitud.pais, base.data.glosario, base.data.maestro)
  const porEtiqueta = indiceCampos(mapeo)
  const formato = base.data.solicitud.formato
  if (formato === "xlsx" && base.data.plantillaCeldas) {
    const relativo = `out/${caso}/formulario.xlsx`
    await escribirExcel(directory, relativo, base.data.plantillaCeldas, porEtiqueta)
    return { ok: true, data: { ruta: relativo, formato } }
  }
  if (formato === "pdf" && base.data.plantillaCampos) {
    const relativo = `out/${caso}/formulario.pdf`
    await escribirPdf(directory, relativo, base.data.solicitud, base.data.plantillaCampos, porEtiqueta)
    return { ok: true, data: { ruta: relativo, formato } }
  }
  const relativo = `out/${caso}/valores-portal.md`
  await escribirTexto(directory, relativo, markdownPortal(base.data.solicitud, base.data.etiquetas, porEtiqueta))
  return { ok: true, data: { ruta: relativo, formato, aviso: "formato no soportado" } }
}

async function armar(directory: string, caso: string): Promise<Resultado<Record<string, unknown>>> {
  const formulario = await escribirFormulario(directory, caso)
  if (!formulario.ok) return formulario
  const base = await baseDelCaso(directory, caso)
  if (!base.ok) return base
  const mapeo = mapearEtiquetas(base.data.etiquetas, base.data.solicitud.pais, base.data.glosario, base.data.maestro)
  const hoy = fechaLocal()
  const indice = await leerSoportes(directory)
  if (!indice.ok) return indice
  const carpetaSoportes = path.join(directory, "fixtures", "reto-01", "repositorio", "soportes")
  const checklist = base.data.soportesExigidos.map((tipo) => evaluarSoporte(tipo, indice.data, hoy, carpetaSoportes))
  const bloqueos = checklist.filter((item) => item.estado !== "presente").map((item) => `${item.tipo} ${item.estado}`)
  const listo = bloqueos.length === 0
  const paquete = path.join("out", caso, "paquete")
  await mkdir(salida(directory, paquete), { recursive: true })
  const nombreFormulario = path.posix.basename(formulario.data.ruta)
  await copyFile(salida(directory, formulario.data.ruta), salida(directory, `${paquete}/${nombreFormulario}`))
  const destinos = salida(directory, path.join("out", caso, "paquete", "soportes"))
  await mkdir(destinos, { recursive: true })
  for (const item of checklist) {
    if (!item.archivo) continue
    await copyFile(path.join(carpetaSoportes, item.archivo), path.join(destinos, item.archivo))
  }
  const razon = textoMaestro(base.data.maestro, "razon_social") || "Periferia"
  await escribirTexto(directory, `${paquete}/checklist.md`, markdownChecklist(caso, hoy, checklist, mapeo, listo))
  await escribirTexto(directory, `${paquete}/borrador-correo.md`, markdownCorreo(base.data.solicitud, razon))
  return {
    ok: true,
    data: {
      ruta: `out/${caso}/paquete`,
      listo_para_firma: listo,
      checklist,
      bloqueos,
      faltantes: mapeo.faltantes.map((campo) => campo.etiqueta),
      formulario: formulario.data.ruta,
    },
  }
}

function mapearEtiquetas(
  etiquetas: string[],
  pais: string,
  glosario: Record<string, string>,
  maestro: Record<string, unknown>,
): Mapeo {
  const campos = etiquetas.map((etiqueta) => mapearEtiqueta(etiqueta, pais, glosario, maestro))
  return {
    llenos: campos.filter((campo) => campo.estado === "lleno"),
    faltantes: campos.filter((campo) => campo.estado === "faltante"),
    requiere_confirmacion: campos.filter((campo) => campo.estado === "requiere_confirmacion"),
  }
}

function mapearEtiqueta(
  etiqueta: string,
  pais: string,
  glosario: Record<string, string>,
  maestro: Record<string, unknown>,
): CampoMapeado {
  const equivalente = ID_POR_PAIS[pais] ?? "identificador tributario"
  const hallazgo = resolverClave(etiqueta, glosario)
  if (!hallazgo) {
    return { etiqueta, estado: "faltante", confianza: 0, nota: "No existe en el maestro ni en el glosario." }
  }
  const valor = valorPlano(leerRuta(maestro, hallazgo.clave))
  if (valor === null || valor === "") {
    return {
      etiqueta,
      estado: "faltante",
      confianza: hallazgo.confianza,
      ruta: hallazgo.clave,
      nota: "El glosario apunta a una clave sin valor en el maestro.",
    }
  }
  const esTributario = hallazgo.clave === "nit" || ETIQUETAS_TRIBUTO.has(etiqueta)
  const esNitColombiano = pais === "CO" && etiqueta === "NIT"
  if (esTributario && !esNitColombiano) {
    return {
      etiqueta,
      estado: "requiere_confirmacion",
      confianza: Math.min(hallazgo.confianza, 0.7),
      ruta: hallazgo.clave,
      valor,
      nota: pais === "CO" ? `Etiqueta ambigua. Equivalente en CO: ${equivalente}.` : "identificador extranjero",
      equivalente_pais: equivalente,
    }
  }
  if (hallazgo.confianza < UMBRAL_CONFIANZA || ETIQUETAS_AMBIGUAS.has(etiqueta)) {
    return {
      etiqueta,
      estado: "requiere_confirmacion",
      confianza: Math.min(hallazgo.confianza, 0.7),
      ruta: hallazgo.clave,
      valor,
      nota: `Confianza inferior al umbral ${UMBRAL_CONFIANZA}.`,
      equivalente_pais: esTributario ? equivalente : undefined,
    }
  }
  return { etiqueta, estado: "lleno", confianza: hallazgo.confianza, ruta: hallazgo.clave, valor }
}

function resolverClave(etiqueta: string, glosario: Record<string, string>): { clave: string; confianza: number } | null {
  if (Object.prototype.hasOwnProperty.call(glosario, etiqueta)) return { clave: glosario[etiqueta] ?? "", confianza: 1 }
  const buscada = normalizar(etiqueta)
  for (const [nombre, clave] of Object.entries(glosario)) {
    if (normalizar(nombre) === buscada) return { clave, confianza: 0.92 }
  }
  return null
}

function leerRuta(maestro: Record<string, unknown>, ruta: string): unknown {
  let actual: unknown = maestro
  for (const parte of ruta.split(".")) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual) || !(parte in actual)) return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  return actual
}

function valorPlano(valor: unknown): string | number | boolean | null {
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") return valor
  return null
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
}

function indiceCampos(mapeo: Mapeo): Map<string, CampoMapeado> {
  return new Map([...mapeo.llenos, ...mapeo.faltantes, ...mapeo.requiere_confirmacion].map((campo) => [campo.etiqueta, campo]))
}

async function escribirExcel(
  directory: string,
  relativo: string,
  celdas: Celda[],
  porEtiqueta: Map<string, CampoMapeado>,
): Promise<void> {
  const libro = new ExcelJS.Workbook()
  const hojas = new Map<string, ExcelJS.Worksheet>()
  for (const celda of celdas) {
    let hoja = hojas.get(celda.hoja)
    if (!hoja) {
      hoja = libro.addWorksheet(celda.hoja)
      hojas.set(celda.hoja, hoja)
    }
    hoja.getCell(celda.celda_etiqueta).value = celda.etiqueta
    const campo = porEtiqueta.get(celda.etiqueta)
    hoja.getCell(celda.celda_valor).value = campo?.estado === "faltante" || campo?.valor === undefined ? "" : campo.valor
  }
  const archivo = salida(directory, relativo)
  await mkdir(path.dirname(archivo), { recursive: true })
  await libro.xlsx.writeFile(archivo)
}

async function escribirPdf(
  directory: string,
  relativo: string,
  solicitud: Solicitud,
  campos: CampoPdf[],
  porEtiqueta: Map<string, CampoMapeado>,
): Promise<void> {
  const doc = await PDFDocument.create()
  const fuente = await doc.embedFont(StandardFonts.Helvetica)
  let pagina = doc.addPage([595, 842])
  let y = 800
  const dibujar = (texto: string, tamano: number) => {
    for (const linea of partirLineas(pdfTexto(texto), 90)) {
      if (y < 48) {
        pagina = doc.addPage([595, 842])
        y = 800
      }
      pagina.drawText(linea, { x: 48, y, size: tamano, font: fuente, color: rgb(0.1, 0.16, 0.14) })
      y -= tamano + 6
    }
  }
  dibujar(`Registro de proveedor — ${solicitud.cliente}`, 14)
  y -= 6
  for (const campo of campos) {
    const hallado = porEtiqueta.get(campo.etiqueta)
    const valor = hallado?.estado === "faltante" || hallado?.valor === undefined ? "(faltante)" : String(hallado.valor)
    const marca = campo.obligatorio ? "" : " (opcional)"
    dibujar(`${campo.etiqueta}${marca}: ${valor}`, 11)
  }
  const archivo = salida(directory, relativo)
  await mkdir(path.dirname(archivo), { recursive: true })
  await writeFile(archivo, await doc.save())
}

function markdownPortal(solicitud: Solicitud, etiquetas: string[], porEtiqueta: Map<string, CampoMapeado>): string {
  const lineas = [
    "# Valores para copiar en el portal",
    "",
    "formato no soportado. El agente no ingresa al portal ni usa credenciales.",
    `Cliente: ${solicitud.cliente}`,
    "",
    "| Etiqueta | Valor | Estado |",
    "| --- | --- | --- |",
  ]
  for (const etiqueta of etiquetas) {
    const campo = porEtiqueta.get(etiqueta)
    const valor = campo?.estado === "faltante" || campo?.valor === undefined ? "—" : String(campo.valor).replace(/\|/g, "/")
    lineas.push(`| ${etiqueta} | ${valor} | ${campo?.estado ?? "faltante"} |`)
  }
  lineas.push("")
  return lineas.join("\n")
}

function markdownChecklist(caso: string, hoy: string, items: ItemChecklist[], mapeo: Mapeo, listo: boolean): string {
  const lineas = [
    `# Checklist ${caso}`,
    "",
    `Fecha de ejecución: ${hoy}`,
    `listo_para_firma: ${listo ? "sí" : "no"}`,
    "",
    "## Soportes",
  ]
  for (const item of items) {
    lineas.push(`- ${item.tipo}: ${item.estado} (vigencia ${item.vigencia_hasta ?? "sin vencimiento"})`)
  }
  lineas.push("", "## Campos faltantes")
  if (mapeo.faltantes.length === 0) lineas.push("- Ninguno")
  for (const campo of mapeo.faltantes) lineas.push(`- ${campo.etiqueta}`)
  lineas.push("", "## Campos que requieren confirmación")
  if (mapeo.requiere_confirmacion.length === 0) lineas.push("- Ninguno")
  for (const campo of mapeo.requiere_confirmacion) lineas.push(`- ${campo.etiqueta}: ${campo.nota ?? "confianza baja"}`)
  lineas.push("", "Un campo faltante no bloquea la firma. Un soporte ausente o vencido sí la bloquea.", "")
  return lineas.join("\n")
}

function markdownCorreo(solicitud: Solicitud, razonSocial: string): string {
  return [
    `Para: ${solicitud.de}`,
    `Asunto: Re: ${solicitud.asunto}`,
    "",
    `Estimados ${solicitud.cliente},`,
    "",
    `Adjunto el formulario de registro de ${razonSocial} y los soportes que constan en el checklist.`,
    "Este borrador no incluye datos bancarios.",
    "La firma del representante legal y el envío al cliente quedan pendientes de una persona.",
    "",
    "Quedo atenta,",
    "Analista administrativa",
    "",
  ].join("\n")
}

function markdownEnvio(caso: string): string {
  return [
    "# Envío simulado",
    "",
    `Caso: ${caso}`,
    "No se contactó al cliente ni se firmó el formulario.",
    "Una persona confirmó la acción en el turno anterior.",
    `Paquete: out/${caso}/paquete/`,
    "",
  ].join("\n")
}

async function leerSoportes(directory: string): Promise<Resultado<SoporteMaestro[]>> {
  const json = await leerArchivoJson(path.join(directory, "fixtures", "reto-01", "repositorio", "soportes", "index.json"))
  if (!json.ok) return { ok: false, error: "No pude leer el índice de soportes." }
  if (!Array.isArray(json.data)) return { ok: false, error: "El índice de soportes no es una lista." }
  const soportes: SoporteMaestro[] = []
  for (const item of json.data) {
    if (!item || typeof item !== "object") continue
    const fila = item as Record<string, unknown>
    if (typeof fila.tipo !== "string" || typeof fila.archivo !== "string") continue
    soportes.push({
      tipo: fila.tipo,
      archivo: fila.archivo,
      vigencia_hasta: typeof fila.vigencia_hasta === "string" ? fila.vigencia_hasta : null,
      pais_emisor: typeof fila.pais_emisor === "string" ? fila.pais_emisor : "",
      descripcion: typeof fila.descripcion === "string" ? fila.descripcion : "",
    })
  }
  return { ok: true, data: soportes }
}

function evaluarSoporte(tipo: string, indice: SoporteMaestro[], hoy: string, carpeta: string): ItemChecklist {
  const item = indice.find((soporte) => soporte.tipo === tipo)
  if (!item || !existsSync(path.join(carpeta, item.archivo))) {
    return { tipo, estado: "ausente", vigencia_hasta: item?.vigencia_hasta ?? null, descripcion: item?.descripcion }
  }
  if (item.vigencia_hasta && item.vigencia_hasta < hoy) {
    return {
      tipo,
      estado: "vencido",
      vigencia_hasta: item.vigencia_hasta,
      archivo: item.archivo,
      descripcion: item.descripcion,
    }
  }
  return {
    tipo,
    estado: "presente",
    vigencia_hasta: item.vigencia_hasta,
    archivo: item.archivo,
    descripcion: item.descripcion,
  }
}

async function leerArchivoJson(archivo: string): Promise<Resultado<unknown>> {
  try {
    return interpretarJson(await readFile(archivo, "utf8"))
  } catch {
    return { ok: false, error: "No encuentro el archivo necesario para continuar." }
  }
}

async function escribirTexto(directory: string, relativo: string, contenido: string): Promise<void> {
  const archivo = salida(directory, relativo)
  await mkdir(path.dirname(archivo), { recursive: true })
  await writeFile(archivo, contenido, "utf8")
}

function salida(directory: string, relativo: string): string {
  const raiz = path.resolve(raizEscritura(directory))
  const destino = path.resolve(raiz, relativo)
  const permitido = path.resolve(raiz, "out")
  if (destino !== permitido && !destino.startsWith(permitido + path.sep)) {
    throw new Error("Solo se puede escribir dentro de out/.")
  }
  return destino
}

function textoMaestro(maestro: Record<string, unknown>, clave: string): string {
  const valor = maestro[clave]
  return typeof valor === "string" ? valor : ""
}

function comoSolicitud(valor: unknown): Solicitud | null {
  if (!valor || typeof valor !== "object") return null
  const fila = valor as Record<string, unknown>
  if (typeof fila.pais !== "string" || typeof fila.cliente !== "string" || typeof fila.formato !== "string") return null
  if (typeof fila.de !== "string" || typeof fila.asunto !== "string") return null
  return {
    id: typeof fila.id === "string" ? fila.id : "",
    de: fila.de,
    asunto: fila.asunto,
    fecha: typeof fila.fecha === "string" ? fila.fecha : "",
    pais: fila.pais,
    cliente: fila.cliente,
    formato: fila.formato,
    cuerpo: typeof fila.cuerpo === "string" ? fila.cuerpo : "",
    adjuntos: Array.isArray(fila.adjuntos) ? fila.adjuntos.filter((item): item is string => typeof item === "string") : [],
  }
}

function comoGlosario(valor: unknown): Record<string, string> | null {
  const objeto = comoObjeto(valor)
  if (!objeto) return null
  const glosario: Record<string, string> = {}
  for (const [clave, destino] of Object.entries(objeto)) {
    if (typeof destino === "string") glosario[clave] = destino
  }
  return glosario
}

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null
  return valor as Record<string, unknown>
}

function comoCeldas(valor: unknown): Celda[] | null {
  if (!Array.isArray(valor)) return null
  const celdas: Celda[] = []
  for (const item of valor) {
    if (!item || typeof item !== "object") return null
    const fila = item as Record<string, unknown>
    if (typeof fila.hoja !== "string" || typeof fila.etiqueta !== "string") return null
    if (typeof fila.celda_etiqueta !== "string" || typeof fila.celda_valor !== "string") return null
    celdas.push({
      hoja: fila.hoja,
      etiqueta: fila.etiqueta,
      celda_etiqueta: fila.celda_etiqueta,
      celda_valor: fila.celda_valor,
    })
  }
  return celdas
}

function comoCamposPdf(valor: unknown): CampoPdf[] | null {
  if (!Array.isArray(valor)) return null
  const campos: CampoPdf[] = []
  for (const item of valor) {
    if (!item || typeof item !== "object") return null
    const fila = item as Record<string, unknown>
    if (typeof fila.etiqueta !== "string") return null
    campos.push({ etiqueta: fila.etiqueta, obligatorio: fila.obligatorio === true })
  }
  return campos
}

function comoTextos(valor: unknown): string[] | null {
  if (!Array.isArray(valor) || !valor.every((item) => typeof item === "string")) return null
  return valor
}

function pdfTexto(texto: string): string {
  return texto.normalize("NFC").replace(/[^\u0000-\u00FF]/g, "?")
}

function partirLineas(texto: string, maximo: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean)
  const lineas: string[] = []
  let actual = ""
  for (const palabra of palabras) {
    const candidato = actual ? `${actual} ${palabra}` : palabra
    if (candidato.length > maximo && actual) {
      lineas.push(actual)
      actual = palabra
    } else {
      actual = candidato
    }
  }
  if (actual) lineas.push(actual)
  return lineas.length ? lineas : [""]
}
