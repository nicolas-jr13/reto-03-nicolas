import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { ejecutarTurno, obtenerSesion } from "./agent/loop"
import { configuracionModelo } from "./llm/factory"
import { directorioProyecto } from "./raiz"
import { paginaHtml } from "./trazas"

export const maxDuration = 300

const directory = directorioProyecto()
const port = Number(process.env.PORT ?? 3000)

function enviar(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  })
  res.end(raw)
}

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_000_000) throw new Error("El mensaje supera el tamaño permitido.")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function rutaPedido(req: IncomingMessage): URL {
  const host = req.headers.host ?? "localhost"
  const encabezado = req.headers["x-forwarded-uri"] || req.headers["x-vercel-original-url"] || req.headers["x-invoke-path"]
  const bruto = req.url || (Array.isArray(encabezado) ? encabezado[0] : encabezado) || "/"
  const url = new URL(bruto, `http://${host}`)
  if (url.pathname === "/src/server.ts" && encabezado) {
    const original = Array.isArray(encabezado) ? encabezado[0] : encabezado
    return new URL(original, `http://${host}`)
  }
  return url
}

async function leerPagina(): Promise<Buffer> {
  const candidatos = [
    paginaHtml,
    new URL("../web/index.html", import.meta.url),
    path.join(directory, "web", "index.html"),
    path.join(process.cwd(), "web", "index.html"),
  ]
  const fallos: string[] = []
  for (const candidato of candidatos) {
    try {
      return await readFile(candidato)
    } catch (error) {
      fallos.push(error instanceof Error ? error.message : "No pude leer la página.")
    }
  }
  throw new Error(fallos[0] ?? "No pude leer la página.")
}

export default async function manejar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = rutaPedido(req)
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const modelo = configuracionModelo()
      enviar(res, 200, { ok: true, provider: modelo.provider, model: modelo.model })
      return
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length))
      enviar(res, 200, await obtenerSesion(directory, id))
      return
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = JSON.parse(await leerCuerpo(req)) as { sessionId?: unknown; message?: unknown; respaldo?: unknown }
      if (typeof body.sessionId !== "string" || typeof body.message !== "string" || !body.message.trim()) {
        enviar(res, 400, { ok: false, error: "Envíe sessionId y message." })
        return
      }
      enviar(res, 200, await ejecutarTurno(directory, body.sessionId, body.message.trim(), body.respaldo))
      return
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/api" || url.pathname === "/api/")) {
      const html = await leerPagina()
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(html)
      return
    }
    enviar(res, 404, { ok: false, error: "Ruta no encontrada." })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No pude completar la solicitud."
    enviar(res, 400, { ok: false, error: message })
  }
}

if (!process.env.VERCEL) {
  createServer(manejar).listen(port, () => {
    console.log(`Agente de registro de proveedor en http://localhost:${port}`)
  })
}
