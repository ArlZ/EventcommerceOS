export type EventControlContext = {
  organisationId?: string;
  organisationName?: string;
  eventId?: string;
  eventName?: string;
};

const storageKey = 'event-commerce.command-centre-context';

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
  const current = readEventControlContext();
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      ...current,
      ...next,
    }),
  );
}

export function selectOrganisationContext(organisationId: string, organisationName: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      organisationId,
      organisationName,
    }),
  );
}
