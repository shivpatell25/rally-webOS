export interface JsonRecord {
  [key: string]: unknown
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : undefined
}
