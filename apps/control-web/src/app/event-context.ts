export type EventControlContext = {
  organisationId?: string;
  eventId?: string;
};

const storageKey = 'event-commerce.command-centre-context';

export function readEventControlContext(): EventControlContext {
  if (typeof window === 'undefined') return {};
  const stored = window.sessionStorage.getItem(storageKey);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as Partial<EventControlContext>;
    return {
      ...(typeof parsed.organisationId === 'string'
        ? { organisationId: parsed.organisationId }
        : {}),
      ...(typeof parsed.eventId === 'string' ? { eventId: parsed.eventId } : {}),
    };
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return {};
  }
}

export function writeEventControlContext(next: EventControlContext): void {
  if (typeof window === 'undefined') return;
  const current = readEventControlContext();
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      ...current,
      ...next,
    }),
  );
}
