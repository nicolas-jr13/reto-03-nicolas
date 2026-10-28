import type { LlmAdapter } from "./adapter"
import { configuracionAnthropic, crearAdaptadorAnthropic } from "./anthropic"
import { configuracionModelo as configuracionOpenAi, crearAdaptador as crearAdaptadorOpenAi, estimarTokens } from "./openai"

export { estimarTokens }

export function configuracionModelo(): { provider: string; model: string } {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const anthropic = configuracionAnthropic()
    return { provider: anthropic.provider, model: anthropic.model }
  }
  const openai = configuracionOpenAi()
  return { provider: openai.provider, model: openai.model }
}

export function crearAdaptador(): LlmAdapter {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return crearAdaptadorAnthropic()
  return crearAdaptadorOpenAi()
}
