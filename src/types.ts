export type ToolContext = {
  directory: string
  sessionId: string
  confirmacionExplicita: boolean
}

export function toolOk(data: unknown): string {
  return JSON.stringify({ ok: true, data })
}

export function toolError(error: string): string {
  return JSON.stringify({ ok: false, error })
}
