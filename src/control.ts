import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { csvField } from "./text"

let cola: Promise<void> = Promise.resolve()

export function encolar<T>(tarea: () => Promise<T>): Promise<T> {
  const ejecucion = cola.then(tarea, tarea)
  cola = ejecucion.then(
    () => undefined,
    () => undefined,
  )
  return ejecucion
}

export async function anexarJsonl(directory: string, relativo: string, registro: unknown): Promise<void> {
  await encolar(async () => {
    const archivo = path.join(directory, relativo)
    await mkdir(path.dirname(archivo), { recursive: true })
    await appendFile(archivo, `${JSON.stringify(registro)}\n`, "utf8")
  })
}

export async function anexarControl(
  directory: string,
  fila: {
    solicitud_id: string
    resultado: "creada" | "bloqueada" | "pendiente" | "idempotente"
    numero_oc: string
    retroactiva: boolean
    bloqueos: string
    confirmaciones: string
    ts: string
  },
): Promise<void> {
  await encolar(async () => {
    const archivo = path.join(directory, "out", "control.csv")
    await mkdir(path.dirname(archivo), { recursive: true })
    const { access } = await import("node:fs/promises")
    let existe = true
    try {
      await access(archivo)
    } catch {
      existe = false
    }
    const linea = [
      fila.solicitud_id,
      fila.resultado,
      fila.numero_oc,
      String(fila.retroactiva),
      fila.bloqueos,
      fila.confirmaciones,
      fila.ts,
    ]
      .map(csvField)
      .join(",")
    const encabezado = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"
    await appendFile(archivo, existe ? `${linea}\n` : `\uFEFF${encabezado}${linea}\n`, "utf8")
  })
}
