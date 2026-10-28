import { createHash } from "node:crypto"
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import ExcelJS from "exceljs"
import { zodToJsonSchema } from "./src/llm/json-schema"
import { listarHerramientas, runTool } from "./src/tools/registry"
import { fechaLocal, interpretarJson, listarCasos } from "./src/tools/proveedor"
import type { CampoMapeado, ItemChecklist } from "./src/tools/proveedor"
import type { ToolContext } from "./src/types"

const directory = import.meta.dir

type ToolBody<T> = { ok: true; data: T } | { ok: false; error: string }

type Lectura = {
  pais: string
  cliente: string
  formato: string
  campos: string[]
  soportes: string[]
}

type Mapeo = {
  llenos: CampoMapeado[]
  faltantes: CampoMapeado[]
  requiere_confirmacion: CampoMapeado[]
}

type Formulario = { ruta: string; formato: string; aviso?: string }

type Paquete = {
  ruta: string
  listo_para_firma: boolean
  checklist: ItemChecklist[]
  bloqueos: string[]
  faltantes: string[]
}

function parse<T>(raw: string): ToolBody<T> {
  return JSON.parse(raw) as ToolBody<T>
}

function exigirOk<T>(raw: string, etiqueta: string): T {
  const body = parse<T>(raw)
  if (!body.ok) throw new Error(`${etiqueta}: ${body.error}`)
  return body.data
}

function huella(dir: string): string {
  const hash = createHash("sha256")
  const archivos: string[] = []
  const recorrer = (actual: string) => {
    for (const nombre of readdirSync(actual).sort()) {
      const absoluto = path.join(actual, nombre)
      if (statSync(absoluto).isDirectory()) recorrer(absoluto)
      else archivos.push(absoluto)
    }
  }
  recorrer(dir)
  for (const archivo of archivos) {
    hash.update(path.relative(dir, archivo).replaceAll("\\", "/"))
    hash.update(readFileSync(archivo))
  }
  return hash.digest("hex")
}

function cuerpoDe(archivo: string): string {
  const raw = readFileSync(archivo, "utf8")
  return raw.replace(/^---[\s\S]*?---\s*/, "").trim()
}

async function main(): Promise<void> {
  const fixtures = path.join(directory, "fixtures")
  const antes = huella(fixtures)
  rmSync(path.join(directory, "out"), { recursive: true, force: true })

  const prompt = readFileSync(path.join(directory, "agent", "prompt.md"), "utf8").trim()
  const conocimiento = readFileSync(path.join(directory, "src", "knowledge", "registro-proveedor.md"), "utf8").trim()
  if (cuerpoDe(path.join(directory, "modulo", "agent.md")) !== prompt) {
    throw new Error("modulo/agent.md no coincide con agent/prompt.md.")
  }
  if (cuerpoDe(path.join(directory, "modulo", "skill", "registro-proveedor", "SKILL.md")) !== conocimiento) {
    throw new Error("La skill del módulo no coincide con el conocimiento del agente.")
  }
  const esquema = zodToJsonSchema(listarHerramientas().find((tool) => tool.name === "proveedor_mapear_campos")!.parameters)
  if (esquema.type !== "object" || !esquema.properties) throw new Error("El esquema de mapear_campos no quedó como objeto.")

  const corrupto = interpretarJson("{")
  if (corrupto.ok || /at\s+\w+/.test(corrupto.error)) throw new Error("Un JSON corrupto debía fallar con un mensaje claro.")

  const ctx: ToolContext = { directory, sessionId: "demo", confirmacionExplicita: false }
  const ctxOk: ToolContext = { directory, sessionId: "demo", confirmacionExplicita: true }
  const invalido = parse<unknown>(await runTool("proveedor_leer_solicitud", { caso: "../maestro" }, ctx))
  if (invalido.ok) throw new Error("Un caso con ruta relativa no debía leerse.")
  const ausente = parse<unknown>(await runTool("proveedor_leer_solicitud", { caso: "no-existe" }, ctx))
  if (ausente.ok || !ausente.error.includes("No existe")) throw new Error("Un caso ausente debía avisar sin traza.")

  const hoy = fechaLocal()
  for (const caso of await listarCasos(directory)) {
    const lectura = exigirOk<Lectura>(await runTool("proveedor_leer_solicitud", { caso }, ctx), caso)
    const mapeo = exigirOk<Mapeo>(await runTool("proveedor_mapear_campos", { caso, campos: lectura.campos }, ctx), caso)
    const formulario = exigirOk<Formulario>(
      await runTool("proveedor_generar_formulario", { caso, mapeo }, ctx),
      caso,
    )
    const paquete = exigirOk<Paquete>(await runTool("proveedor_armar_paquete", { caso }, ctx), caso)
    await revisarCaso(caso, lectura, mapeo, formulario, paquete, hoy)
    console.log(
      `${caso} | ${lectura.formato} | llenos ${mapeo.llenos.length} | faltantes ${mapeo.faltantes.length} | confirmar ${mapeo.requiere_confirmacion.length} | listo_para_firma ${paquete.listo_para_firma}`,
    )
  }

  const bloqueado = parse<unknown>(await runTool("proveedor_simular_envio", { caso: "co-industrias-delta", confirmado: false }, ctx))
  if (bloqueado.ok || bloqueado.error !== "requiere confirmación explícita") {
    throw new Error("El envío sin confirmación debía rechazarse.")
  }
  const simulado = exigirOk<{ ruta: string }>(
    await runTool("proveedor_simular_envio", { caso: "co-industrias-delta", confirmado: true }, ctxOk),
    "envio",
  )
  if (!readFileSync(path.join(directory, simulado.ruta), "utf8").includes("Envío simulado")) {
    throw new Error("No quedó el archivo de envío simulado.")
  }
  if (huella(fixtures) !== antes) throw new Error("Los fixtures cambiaron durante la demo.")
  console.log("[PASS] Validación completada.")
}

async function revisarCaso(
  caso: string,
  lectura: Lectura,
  mapeo: Mapeo,
  formulario: Formulario,
  paquete: Paquete,
  hoy: string,
): void {
  const etiquetas = new Set([...mapeo.llenos, ...mapeo.faltantes, ...mapeo.requiere_confirmacion].map((campo) => campo.etiqueta))
  if (etiquetas.size !== lectura.campos.length) throw new Error(`${caso}: un campo quedó sin estado o duplicado.`)
  if (mapeo.faltantes.some((campo) => campo.valor !== undefined)) throw new Error(`${caso}: un faltante trae un valor inventado.`)
  const bloqueaPorFaltante = paquete.bloqueos.some((item) => item.startsWith("faltante"))
  if (bloqueaPorFaltante) throw new Error(`${caso}: un campo faltante no debe bloquear la firma.`)
  const esperado = paquete.bloqueos.length === 0
  if (paquete.listo_para_firma !== esperado) throw new Error(`${caso}: listo_para_firma no coincide con los bloqueos.`)
  const correo = readFileSync(path.join(directory, "out", caso, "paquete", "borrador-correo.md"), "utf8")
  if (/03100012345|COLOCOBM|Bancolombia/.test(correo)) throw new Error(`${caso}: el borrador incluye datos bancarios.`)
  const checklist = readFileSync(path.join(directory, "out", caso, "paquete", "checklist.md"), "utf8")
  if (!checklist.includes(hoy)) throw new Error(`${caso}: el checklist no trae la fecha de ejecución.`)

  if (caso === "co-industrias-delta") {
    if (mapeo.faltantes.length || mapeo.requiere_confirmacion.length) throw new Error("Colombia debía llenarse desde el maestro.")
    if (formulario.formato !== "xlsx") throw new Error("Industrias Delta debía salir en Excel.")
  }
  if (caso === "ec-corp-andina" || caso === "pa-logistica-istmo") {
    const ruc = mapeo.requiere_confirmacion.find((campo) => campo.etiqueta === "RUC")
    if (!ruc || ruc.valor !== "900123456" || !ruc.nota?.includes("identificador extranjero")) {
      throw new Error(`${caso}: el RUC debía proponer el NIT y pedir confirmación.`)
    }
  }
  if (caso === "ec-corp-andina") {
    if (!mapeo.faltantes.some((campo) => campo.etiqueta === "Número de contribuyente especial")) {
      throw new Error("El contribuyente especial debía quedar faltante.")
    }
    if (!paquete.bloqueos.includes("certificado_cumplimiento_tributario ausente")) {
      throw new Error("El soporte tributario ausente debía bloquear la firma.")
    }
    if (formulario.formato !== "pdf") throw new Error("Corp Andina debía salir en PDF.")
  }
  if (caso === "hn-agroexport-sula") {
    const rtn = mapeo.requiere_confirmacion.find((campo) => campo.etiqueta === "RTN")
    if (!rtn || rtn.valor !== "900123456" || !rtn.nota?.includes("identificador extranjero")) {
      throw new Error("El RTN debía proponer el NIT y pedir confirmación.")
    }
    if (!mapeo.faltantes.some((campo) => campo.etiqueta === "Referencias comerciales")) {
      throw new Error("Las referencias comerciales debían quedar faltantes.")
    }
  }
  if (caso === "pa-logistica-istmo") {
    if (formulario.aviso !== "formato no soportado") throw new Error("El portal debía declararse no soportado.")
    const portal = readFileSync(path.join(directory, formulario.ruta), "utf8")
    if (!portal.includes("formato no soportado") || !portal.includes("900123456")) {
      throw new Error("El listado del portal no quedó listo para copiar.")
    }
  }
  if (caso === "co-industrias-delta" || caso === "hn-agroexport-sula") await revisarExcel(caso)
}

async function revisarExcel(caso: string): Promise<void> {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(path.join(directory, "out", caso, "formulario.xlsx"))
  if (caso === "co-industrias-delta") {
    const datos = libro.getWorksheet("Datos Proveedor")
    const banco = libro.getWorksheet("Datos Bancarios")
    if (datos?.getCell("C3").value !== "Periferia IT Group S.A.S.") throw new Error("La razón social no quedó en C3.")
    if (datos?.getCell("C4").value !== "900123456") throw new Error("El NIT no quedó en C4.")
    if (banco?.getCell("C5").value !== "03100012345") throw new Error("La cuenta no quedó en la hoja bancaria.")
  }
  if (caso === "hn-agroexport-sula") {
    const hoja = libro.getWorksheet("Registro")
    if (hoja?.getCell("B3").value !== "900123456") throw new Error("El RTN propuesto no quedó en B3.")
    if (hoja?.getCell("B12").value) throw new Error("Las referencias comerciales no debían inventarse.")
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
