export function fixedClock(isoTimestamp: string): () => Date {
  const value = new Date(isoTimestamp);
  if (Number.isNaN(value.getTime())) throw new Error('Invalid fixed clock timestamp');
  return () => new Date(value.getTime());
}
