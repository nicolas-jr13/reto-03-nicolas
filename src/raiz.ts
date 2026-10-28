import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export function directorioProyecto(): string {
  const aqui = path.dirname(fileURLToPath(import.meta.url))
  const candidatos = [process.cwd(), path.resolve(aqui, ".."), path.resolve(aqui, "../..")]
  for (const candidato of candidatos) {
    if (existsSync(path.join(candidato, "fixtures", "reto-01", "glosario-campos.json"))) return candidato
  }
  return process.cwd()
}

export function raizEscritura(proyecto: string): string {
  if (process.env.VERCEL) return "/tmp/reto-01"
  return proyecto
}
