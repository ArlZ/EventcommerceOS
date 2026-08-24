export function canEditEventConfiguration(lifecycle: string | null | undefined): boolean {
  return lifecycle === 'DRAFT';
}
