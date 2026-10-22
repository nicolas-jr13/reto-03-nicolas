import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { ejecutarTurno, obtenerSesion } from "./agent/loop"
import { configuracionModelo } from "./llm/openai"

const directory = path.resolve(import.meta.dir, "..")
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const modelo = configuracionModelo()
      enviar(res, 200, {
        ok: true,
        provider: modelo.provider,
        model: modelo.model,
      })
      return
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length))
      const sesion = await obtenerSesion(directory, id)
      enviar(res, 200, sesion)
      return
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const raw = await leerCuerpo(req)
      const body = JSON.parse(raw) as { sessionId?: unknown; message?: unknown }
      if (typeof body.sessionId !== "string" || typeof body.message !== "string" || !body.message.trim()) {
        enviar(res, 400, { ok: false, error: "Envíe sessionId y message." })
        return
      }
      const turno = await ejecutarTurno(directory, body.sessionId, body.message.trim())
      enviar(res, 200, turno)
      return
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(path.join(directory, "web", "index.html"))
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(html)
      return
    }
    enviar(res, 404, { ok: false, error: "Ruta no encontrada." })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado."
    enviar(res, 400, { ok: false, error: message })
  }
})

server.listen(port, () => {
  console.log(`Agente de órdenes de compra en http://localhost:${port}`)
})
