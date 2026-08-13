export type EntityId = string & { readonly __entityId: unique symbol };

export function asEntityId(value: string): EntityId {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error('Entity identifiers must not be empty');
  return normalized as EntityId;
}

export * from './money';
