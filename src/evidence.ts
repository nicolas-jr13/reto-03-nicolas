import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib"
import { leerAprobacionArchivo } from "./fixtures"

function contenidoEvidencia(aprobacion: { de: string; para: string; fecha: string; asunto: string; cuerpo: string }): string {
  return [`De: ${aprobacion.de}`, `Para: ${aprobacion.para}`, `Fecha: ${aprobacion.fecha}`, `Asunto: ${aprobacion.asunto}`, "", aprobacion.cuerpo.trimEnd(), ""].join("\n")
}

export function sha256(contenido: string): string {
  return createHash("sha256").update(contenido, "utf8").digest("hex")
}

function winAnsi(value: string): string {
  return value.replace(/[^\u0000-\u00FF]/g, "?")
}

function partirLineas(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lineas: string[] = []
  for (const parrafo of winAnsi(text).split("\n")) {
    if (!parrafo) {
      lineas.push("")
      continue
    }
    const palabras = parrafo.split(/\s+/)
    let actual = ""
    for (const palabra of palabras) {
      const candidato = actual ? `${actual} ${palabra}` : palabra
      if (font.widthOfTextAtSize(candidato, size) <= maxWidth) {
        actual = candidato
        continue
      }
      if (actual) lineas.push(actual)
      actual = palabra
    }
    if (actual) lineas.push(actual)
  }
  return lineas
}

async function escribirPdf(file: string, text: string): Promise<void> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const size = 11
  const margin = 48
  const maxWidth = 612 - margin * 2
  const lineas = partirLineas(text, font, size, maxWidth)
  let page = doc.addPage()
  let y = 792 - margin
  for (const linea of lineas) {
    if (y < margin) {
      page = doc.addPage()
      y = 792 - margin
    }
    page.drawText(linea, { x: margin, y, size, font })
    y -= 16
  }
  await writeFile(file, await doc.save())
}

export async function generarEvidencia(directory: string, caso: string): Promise<{ ruta: string; ruta_pdf: string; sha256: string }> {
  const aprobacion = await leerAprobacionArchivo(directory, caso)
  if (!aprobacion) {
    throw new Error(`No hay aprobacion.json en ${caso}. No puedo generar la evidencia. Pida el correo del líder.`)
  }
  const cuerpo = contenidoEvidencia(aprobacion)
  const hash = sha256(cuerpo)
  const dir = path.join(directory, "out", caso)
  await mkdir(dir, { recursive: true })
  const ruta = path.join("out", caso, "aprobacion.txt")
  const rutaPdf = path.join("out", caso, "aprobacion.pdf")
  await writeFile(path.join(directory, ruta), `${cuerpo}sha256: ${hash}\n`, "utf8")
  await escribirPdf(path.join(directory, rutaPdf), `${cuerpo}sha256: ${hash}\n`)
  return { ruta: ruta.replaceAll("\\", "/"), ruta_pdf: rutaPdf.replaceAll("\\", "/"), sha256: hash }
}
