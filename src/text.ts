export function normNombre(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function soloDigitos(value: string): string {
  return value.replace(/\D/g, "")
}

export function nitCoincide(maestro: string, informado: string): boolean {
  const base = soloDigitos(maestro)
  const dato = soloDigitos(informado)
  if (!base || !dato) return false
  if (base === dato) return true
  if (dato.length === base.length + 1 && dato.startsWith(base)) return true
  if (base.length === dato.length + 1 && base.startsWith(dato)) return true
  return false
}

export function fechaCalendario(value: string): string | null {
  const match = value.match(/\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? null
}

export function parseMonto(raw: string): number | null {
  const token = raw.trim().replace(/\s/g, "")
  let normalizado = token
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) normalizado = token.replace(/\./g, "")
  else if (/^\d{1,3}(,\d{3})+$/.test(token)) normalizado = token.replace(/,/g, "")
  else if (token.includes(",") && token.includes(".")) {
    normalizado =
      token.lastIndexOf(",") > token.lastIndexOf(".")
        ? token.replace(/\./g, "").replace(",", ".")
        : token.replace(/,/g, "")
  } else if (token.includes(",")) normalizado = token.replace(",", ".")

  const value = Number(normalizado)
  return Number.isFinite(value) ? value : null
}

export function dinero(valor: number, moneda: string): string {
  const formatted = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(valor)
  return `${moneda} ${formatted}`
}

export function porcentaje(ratio: number): string {
  return `${(ratio * 100).toFixed(2)} %`
}

export function fechaHoyLocal(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function esConfirmacion(text: string): boolean {
  const normalized = text.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  if (!normalized) return false
  if (/^(no|nop|cancela|cancelar|rechazo)\b/.test(normalized)) return false
  return /^(si|confirmo|confirmado|ok|de acuerdo|adelante|procede|autorizo|crear|crea)\b/.test(normalized)
}

export function estaAprobado(cuerpo: string): boolean {
  const texto = cuerpo.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  if (/\b(rechazado|no aprobado|no se aprueba)\b/.test(texto)) return false
  return /\baprobado\b/.test(texto)
}
