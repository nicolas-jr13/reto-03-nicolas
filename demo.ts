import { existsSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { leerMaestros, leerPaquete } from "./src/fixtures"
import { runTool } from "./src/tools/registry"
import type { OrdenCompra, ToolContext, Validacion } from "./src/types"
import { validarPaquete } from "./src/validate"

const directory = import.meta.dir

type ToolBody<T> = { ok: true; data: T } | { ok: false; error: string }

type PaqueteData = Awaited<ReturnType<typeof leerPaquete>>
type PayloadData = { orden: OrdenCompra; trazabilidad: string; evidencia: { sha256: string; ruta: string; ruta_pdf: string } }
type CrearData = { numero_oc: string; fecha: string; idempotente: boolean; retroactiva?: boolean }

const esperados: Record<string, { apta: boolean; bloqueos: string[]; confirmaciones: string[]; retroactiva: boolean }> = {
  "sol-001": { apta: true, bloqueos: [], confirmaciones: [], retroactiva: false },
  "sol-002": { apta: false, bloqueos: ["RC1"], confirmaciones: [], retroactiva: false },
  "sol-003": { apta: false, bloqueos: ["RC2"], confirmaciones: [], retroactiva: false },
  "sol-004": { apta: true, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false },
  "sol-005": { apta: true, bloqueos: [], confirmaciones: ["RC8"], retroactiva: true },
  "sol-006": { apta: true, bloqueos: [], confirmaciones: ["RC6"], retroactiva: false },
}

function parse<T>(raw: string): ToolBody<T> {
  return JSON.parse(raw) as ToolBody<T>
}

function exigirOk<T>(raw: string, etiqueta: string): T {
  const body = parse<T>(raw)
  if (!body.ok) throw new Error(`${etiqueta}: ${body.error}`)
  return body.data
}

function exigirError(raw: string, etiqueta: string): string {
  const body = parse<unknown>(raw)
  if (body.ok) throw new Error(`${etiqueta}: se esperaba rechazo y la herramienta creó o devolvió datos.`)
  return body.error
}

function mismos(etiqueta: string, esperado: string[], items: { codigo: string }[]): void {
  const got = items.map((item) => item.codigo).sort().join(",")
  const want = [...esperado].sort().join(",")
  if (got !== want) throw new Error(`${etiqueta}: se esperaba [${want}] y llegó [${got}].`)
}

function imprimir(validacion: Validacion): void {
  const bloqueos = validacion.bloqueos.map((item) => `${item.codigo} ${item.detalle}`).join(" || ") || "—"
  const confirmaciones = validacion.confirmaciones.map((item) => `${item.codigo} ${item.detalle}`).join(" || ") || "—"
  console.log(`  apta: ${validacion.apta}`)
  console.log(`  bloqueos: ${bloqueos}`)
  console.log(`  confirmaciones: ${confirmaciones}`)
  console.log(`  retroactiva: ${validacion.retroactiva}`)
}

async function leerYValidar(caso: string, ctx: ToolContext): Promise<{ paquete: PaqueteData; validacion: Validacion }> {
  const paquete = exigirOk<PaqueteData>(await runTool("oc_leer_paquete", { caso }, ctx), `${caso} leer`)
  const validacion = exigirOk<Validacion>(await runTool("oc_validar", { caso, paquete }, ctx), `${caso} validar`)
  const esperado = esperados[caso]
  if (!esperado) throw new Error(`Caso sin expectativa: ${caso}`)
  if (validacion.apta !== esperado.apta) throw new Error(`${caso}: apta debía ser ${esperado.apta}.`)
  mismos(`${caso} bloqueos`, esperado.bloqueos, validacion.bloqueos)
  mismos(`${caso} confirmaciones`, esperado.confirmaciones, validacion.confirmaciones)
  if (validacion.retroactiva !== esperado.retroactiva) throw new Error(`${caso}: retroactiva debía ser ${esperado.retroactiva}.`)
  return { paquete, validacion }
}

async function main(): Promise<void> {
  rmSync(path.join(directory, "out"), { recursive: true, force: true })
  const base: ToolContext = { directory, sessionId: "demo", confirmedByUser: false }
  console.log("demo.ts — seis casos, sin modelo\n")

  console.log("sol-001")
  const primero = await leerYValidar("sol-001", base)
  const evidencia = exigirOk<{ sha256: string; ruta: string; ruta_pdf: string }>(
    await runTool("oc_generar_evidencia", { caso: "sol-001" }, base),
    "sol-001 evidencia",
  )
  if (!/^[a-f0-9]{64}$/.test(evidencia.sha256)) throw new Error("sha256 inválido.")
  const construido = exigirOk<PayloadData>(
    await runTool("oc_construir_payload", { caso: "sol-001", paquete: primero.paquete, derivados: primero.validacion.derivados }, base),
    "sol-001 payload",
  )
  if ((construido.orden.posiciones[0]?.descripcion.length ?? 0) > 40) throw new Error("La descripción supera 40 caracteres.")
  if (construido.orden.referencia.cotizacion_ref !== "COT-TS-2026-0451") {
    throw new Error(`Referencia de cotización inesperada: ${construido.orden.referencia.cotizacion_ref}`)
  }
  const creada = exigirOk<CrearData>(
    await runTool("oc_crear", { caso: "sol-001", payload: construido.orden, confirmado: false }, base),
    "sol-001 crear",
  )
  if (creada.numero_oc !== "4500000001" || creada.idempotente) throw new Error(`OC inicial inesperada: ${creada.numero_oc}`)
  console.log(`  oc: ${creada.numero_oc}`)
  imprimir(primero.validacion)

  console.log("\nsol-001 (segunda vez, idempotencia)")
  const repetida = exigirOk<CrearData>(
    await runTool("oc_crear", { caso: "sol-001", payload: construido.orden, confirmado: false }, base),
    "sol-001 idempotente",
  )
  if (!repetida.idempotente || repetida.numero_oc !== creada.numero_oc) {
    throw new Error("La segunda ejecución de sol-001 creó otra OC.")
  }
  console.log(`  oc: ${repetida.numero_oc}`)
  console.log("  idempotente: true")

  for (const caso of ["sol-002", "sol-003"] as const) {
    console.log(`\n${caso}`)
    const resultado = await leerYValidar(caso, base)
    imprimir(resultado.validacion)
    const error = exigirError(await runTool("oc_crear", { caso, payload: { intento: true } }, base), `${caso} crear`)
    console.log(`  oc: no creada`)
    console.log(`  motivo: ${error}`)
  }

  const numeros: Record<string, string> = { "sol-001": creada.numero_oc }
  for (const caso of ["sol-004", "sol-005", "sol-006"] as const) {
    console.log(`\n${caso}`)
    const resultado = await leerYValidar(caso, base)
    imprimir(resultado.validacion)
    const payload = exigirOk<PayloadData>(
      await runTool("oc_construir_payload", { caso, paquete: resultado.paquete, derivados: resultado.validacion.derivados }, base),
      `${caso} payload`,
    )
    const pendiente = exigirError(
      await runTool("oc_crear", { caso, payload: payload.orden, confirmado: false }, base),
      `${caso} sin confirmar`,
    )
    console.log(`  sin confirmación: ${pendiente}`)
    const confirmada = exigirOk<CrearData>(
      await runTool("oc_crear", { caso, payload: payload.orden, confirmado: true }, { ...base, confirmedByUser: true }),
      `${caso} confirmada`,
    )
    if (confirmada.idempotente) throw new Error(`${caso} no debía ser idempotente en la primera creación.`)
    numeros[caso] = confirmada.numero_oc
    console.log(`  confirmación explícita: sí`)
    console.log(`  oc: ${confirmada.numero_oc}`)
    if (caso === "sol-005" && confirmada.retroactiva !== true) throw new Error("sol-005 debía quedar retroactiva.")
    if (caso === "sol-006") {
      if (resultado.validacion.derivados.indicador_iva !== "C1" || resultado.validacion.derivados.condiciones_pago !== "Z030") {
        throw new Error("sol-006 no derivó IVA C1 y condición Z030.")
      }
      console.log("  derivados: IVA C1, condición Z030")
    }
  }

  const ordenes = readFileSync(path.join(directory, "out", "sap", "ordenes.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((linea) => JSON.parse(linea) as { numero_oc: string; solicitud_id: string })
  if (ordenes.length !== 4) throw new Error(`Se esperaban 4 OC y hay ${ordenes.length}.`)
  const control = readFileSync(path.join(directory, "out", "control.csv"), "utf8")
  if (!control.includes("SOL-2026-005") || !control.includes("true")) throw new Error("El log de control no marca la OC retroactiva.")
  const txt = path.join(directory, "out", "sol-001", "aprobacion.txt")
  const pdf = path.join(directory, "out", "sol-001", "aprobacion.pdf")
  if (!existsSync(txt) || !readFileSync(txt, "utf8").includes("sha256:")) throw new Error("Falta la evidencia txt.")
  if (!existsSync(pdf) || statSync(pdf).size < 200) throw new Error("Falta la evidencia pdf.")

  await comprobarReglasFueraDeFixture()
  console.log("\nResultado: los seis casos cumplen O1–O4.")
  console.log(`OC creadas: ${ordenes.map((fila) => `${fila.solicitud_id}=${fila.numero_oc}`).join(", ")}`)
}

async function comprobarReglasFueraDeFixture(): Promise<void> {
  const paquete = await leerPaquete(directory, "sol-001")
  const maestros = await leerMaestros(directory)
  const subarea = structuredClone(paquete)
  subarea.solicitud.subarea = "Marketing"
  if (!validarPaquete(subarea, maestros).bloqueos.some((item) => item.codigo === "RC4")) throw new Error("RC4 no bloqueó la subárea.")

  const cuadre = structuredClone(paquete)
  cuadre.solicitud.valor_total = 10
  if (!validarPaquete(cuadre, maestros).bloqueos.some((item) => item.codigo === "RC10")) throw new Error("RC10 no bloqueó el descuadre.")

  const tope = structuredClone(paquete)
  tope.solicitud.cantidad = 1
  tope.solicitud.valor_unitario = 60_000_000
  tope.solicitud.valor_total = 60_000_000
  if (!validarPaquete(tope, maestros).bloqueos.some((item) => item.codigo === "RC3")) throw new Error("RC3 no bloqueó el tope.")

  const fecha = structuredClone(paquete)
  if (!fecha.aprobacion) throw new Error("sol-001 no tiene aprobación.")
  fecha.aprobacion.fecha = "2026-08-01"
  const validacionFecha = validarPaquete(fecha, maestros)
  if (!validacionFecha.apta || !validacionFecha.confirmaciones.some((item) => item.codigo === "RC9")) {
    throw new Error("RC9 no pidió confirmación.")
  }

  const inactivo = structuredClone(paquete)
  inactivo.solicitud.proveedor_nit = "901777888"
  inactivo.solicitud.proveedor_nombre = "Consultores Ágiles S.A.S."
  if (!validarPaquete(inactivo, maestros).bloqueos.some((item) => item.codigo === "RC1")) throw new Error("RC1 no bloqueó al proveedor inactivo.")
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
