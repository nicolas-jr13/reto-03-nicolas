import { z } from "zod"

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const description = schema.description
  const base = convertir(schema)
  if (description && typeof base.description !== "string") base.description = description
  return base
}

function convertir(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return convertir(schema.unwrap())
  if (schema instanceof z.ZodDefault) return convertir(schema.removeDefault())
  if (schema instanceof z.ZodEffects) return convertir(schema.innerType())
  if (schema instanceof z.ZodString) return limpiar({ type: "string", description: schema.description })
  if (schema instanceof z.ZodNumber) return limpiar({ type: "number", description: schema.description })
  if (schema instanceof z.ZodBoolean) return limpiar({ type: "boolean", description: schema.description })
  if (schema instanceof z.ZodEnum) return limpiar({ type: "string", enum: schema.options, description: schema.description })
  if (schema instanceof z.ZodArray) {
    return limpiar({ type: "array", items: convertir(schema.element), description: schema.description })
  }
  if (schema instanceof z.ZodUnion) {
    return limpiar({ anyOf: schema.options.map((opcion) => convertir(opcion)), description: schema.description })
  }
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, value] of Object.entries(schema.shape) as [string, z.ZodTypeAny][]) {
      properties[key] = zodToJsonSchema(value)
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) required.push(key)
    }
    return limpiar({
      type: "object",
      properties,
      required,
      additionalProperties: false,
      description: schema.description,
    })
  }
  return { type: "object", additionalProperties: true }
}

function limpiar(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([, value]) => value !== undefined))
}
