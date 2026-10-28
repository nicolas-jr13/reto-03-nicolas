import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { glosarioCampos } from "./trazas"

function conGlosario(candidato: string): boolean {
  return existsSync(path.join(candidato, "fixtures", "reto-01", "glosario-campos.json"))
}

export function directorioProyecto(): string {
  const aqui = path.dirname(fileURLToPath(import.meta.url))
  const porTraza = path.resolve(path.dirname(fileURLToPath(glosarioCampos)), "../..")
  const candidatos = [porTraza, process.cwd(), path.resolve(aqui, ".."), path.resolve(aqui, "../..")]
  for (const candidato of candidatos) {
    if (conGlosario(candidato)) return candidato
  }
  return process.cwd()
}

export function raizEscritura(proyecto: string): string {
  if (process.env.VERCEL) return "/tmp/reto-01"
  return proyecto
}
