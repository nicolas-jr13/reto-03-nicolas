export type LlmToolCall = { id: string; name: string; arguments: string }

export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  toolCalls?: LlmToolCall[]
  toolCallId?: string
}

export type LlmTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LlmAdapter {
  readonly provider: string
  readonly model: string
  enviar(mensajes: LlmMessage[], herramientas: LlmTool[]): Promise<LlmMessage>
}
