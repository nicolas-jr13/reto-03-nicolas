import { z } from "zod"

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap())
  if (schema instanceof z.ZodString) return limpiar({ type: "string", description: schema.description })
  if (schema instanceof z.ZodNumber) return limpiar({ type: "number", description: schema.description })
  if (schema instanceof z.ZodBoolean) return limpiar({ type: "boolean", description: schema.description })
  if (schema instanceof z.ZodEnum) return limpiar({ type: "string", enum: schema.options, description: schema.description })
  if (schema instanceof z.ZodUnknown) return limpiar({ type: "object", additionalProperties: true, description: schema.description })
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, value] of Object.entries(schema.shape) as [string, z.ZodTypeAny][]) {
      properties[key] = zodToJsonSchema(value)
      if (!(value instanceof z.ZodOptional)) required.push(key)
    }
    return { type: "object", properties, required, additionalProperties: false }
  }
  return { type: "object", additionalProperties: true }
}

function limpiar(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([, value]) => value !== undefined))
}
