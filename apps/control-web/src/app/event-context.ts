export type EventControlContext = {
  organisationId?: string | null;
  organisationName?: string | null;
  eventId?: string | null;
  eventName?: string | null;
};

const storageKey = 'event-commerce.command-centre-context';
export const eventControlContextChangedEvent = 'event-commerce:event-control-context-changed';

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function readEventControlContext(): EventControlContext {
  if (typeof window === 'undefined') return {};
  const stored = window.sessionStorage.getItem(storageKey);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as Partial<EventControlContext>;
    const organisationId = stringField(parsed.organisationId);
    const organisationName = stringField(parsed.organisationName);
    const eventId = stringField(parsed.eventId);
    const eventName = stringField(parsed.eventName);
    return {
      ...(organisationId ? { organisationId } : {}),
      ...(organisationName ? { organisationName } : {}),
      ...(eventId ? { eventId } : {}),
      ...(eventName ? { eventName } : {}),
    };
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return {};
  }
}

export function writeEventControlContext(next: EventControlContext): void {
  if (typeof window === 'undefined') return;
  const merged = { ...readEventControlContext(), ...next };
  const organisationId = stringField(merged.organisationId);
  const organisationName = stringField(merged.organisationName);
  const eventId = stringField(merged.eventId);
  const eventName = stringField(merged.eventName);
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      ...(organisationId ? { organisationId } : {}),
      ...(organisationName ? { organisationName } : {}),
      ...(eventId ? { eventId } : {}),
      ...(eventName ? { eventName } : {}),
    }),
  );
  window.dispatchEvent(new Event(eventControlContextChangedEvent));
}
