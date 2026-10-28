import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

let cola: Promise<void> = Promise.resolve()

function encolar<T>(tarea: () => Promise<T>): Promise<T> {
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
