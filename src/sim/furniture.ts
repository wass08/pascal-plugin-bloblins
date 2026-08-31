type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function addNames(values: string[], value: unknown): void {
  const record = asRecord(value)
  if (record == null) return
  for (const key of ['name', 'title', 'label', 'category'] as const) {
    if (typeof record[key] === 'string') values.push(record[key])
  }
  if (Array.isArray(record.tags)) {
    for (const tag of record.tags) if (typeof tag === 'string') values.push(tag)
  }
}

export function furnitureKindOf(node: {
  type: string
  name?: string
  metadata?: unknown
}): 'bed' | 'seat' | 'hearth' | null {
  const values = [node.type]
  if (node.name != null) values.push(node.name)
  addNames(values, node.metadata)

  const rawNode = node as UnknownRecord
  addNames(values, rawNode.asset)
  const metadata = asRecord(node.metadata)
  if (metadata != null) addNames(values, metadata.asset)

  const haystack = values.join(' ').toLowerCase()
  if (['bed', 'mattress', 'crib'].some((term) => haystack.includes(term))) return 'bed'
  if (['sofa', 'couch', 'armchair', 'chair', 'bench', 'stool'].some((term) => haystack.includes(term))) {
    return 'seat'
  }
  if (['fireplace', 'hearth', 'stove'].some((term) => haystack.includes(term))) return 'hearth'
  return null
}
