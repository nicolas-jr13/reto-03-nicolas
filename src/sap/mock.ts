import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { encolar } from "../control"
import { leerMaestros } from "../fixtures"
import { fechaHoyLocal, nitCoincide } from "../text"
import type { OrdenCompra } from "../types"
import type { SapAdapter } from "./adapter"

const INICIO = 4_500_000_001

type FilaOrden = {
  numero_oc: string
  fecha: string
  solicitud_id: string
  orden: OrdenCompra
}

export class SapMock implements SapAdapter {
  constructor(private readonly directory: string) {}

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const maestros = await leerMaestros(this.directory)
    const proveedor = maestros.proveedores.find((item) => nitCoincide(item.nit, nit))
    if (!proveedor) return null
    return { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo }
  }

  async buscarOrdenPorReferencia(solicitudId: string): Promise<{ numero_oc: string; fecha?: string } | null> {
    const filas = await this.leer()
    const encontrada = filas.find((fila) => fila.solicitud_id === solicitudId || fila.orden.referencia.solicitud_id === solicitudId)
    if (!encontrada) return null
    return { numero_oc: encontrada.numero_oc, fecha: encontrada.fecha }
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    return encolar(async () => {
      const filas = await this.leer()
      const previa = filas.find((fila) => fila.solicitud_id === orden.referencia.solicitud_id)
      if (previa) return { numero_oc: previa.numero_oc, fecha: previa.fecha }
      const maximo = filas.reduce((max, fila) => Math.max(max, Number(fila.numero_oc) || 0), INICIO - 1)
      const numero = String(maximo + 1)
      const fecha = fechaHoyLocal()
      const fila: FilaOrden = { numero_oc: numero, fecha, solicitud_id: orden.referencia.solicitud_id, orden }
      const archivo = path.join(this.directory, "out", "sap", "ordenes.jsonl")
      await mkdir(path.dirname(archivo), { recursive: true })
      await appendFile(archivo, `${JSON.stringify(fila)}\n`, "utf8")
      return { numero_oc: numero, fecha }
    })
  }

  private async leer(): Promise<FilaOrden[]> {
    const archivo = path.join(this.directory, "out", "sap", "ordenes.jsonl")
    let raw = ""
    try {
      raw = await readFile(archivo, "utf8")
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []
      throw error
    }
    const filas: FilaOrden[] = []
    for (const linea of raw.split("\n")) {
      if (!linea.trim()) continue
      try {
        filas.push(JSON.parse(linea) as FilaOrden)
      } catch {
        continue
      }
    }
    return filas
  }
}
