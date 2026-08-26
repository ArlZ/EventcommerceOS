'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  eventControlContextChangedEvent,
  readEventControlContext,
  writeEventControlContext,
} from './event-context';

type ContextEvent = {
  id: string;
  name: string;
  lifecycle: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  startsAt: string;
  endsAt: string;
};

type ContextOrganisation = {
  id: string;
  name: string;
  role: 'ADMIN' | 'FINANCE' | 'SUPERVISOR' | 'VIEWER' | 'PLATFORM_ADMIN';
  events: ContextEvent[];
};

type OperatorControlContext = { organisations: ContextOrganisation[] };

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

export function OperatorContextSwitcher() {
  const [context, setContext] = useState<OperatorControlContext | null>(null);
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const selected = readEventControlContext();
    setOrganisationId(selected.organisationId ?? '');
    setEventId(selected.eventId ?? '');

    let active = true;
    void fetch(`${apiBase}/operator-auth/context`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'x-event-control-request': 'browser' },
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Context lookup failed with ${response.status}`);
        const payload = (await response.json()) as OperatorControlContext;
        if (!active) return;
        setContext(payload);
        setError(null);

        const storedOrganisation = payload.organisations.find(
          (organisation) => organisation.id === selected.organisationId,
        );
        const fallbackOrganisation = storedOrganisation ?? payload.organisations[0];
        if (!fallbackOrganisation) return;
        const storedEvent = fallbackOrganisation.events.find(
          (event) => event.id === selected.eventId,
        );
        const fallbackEvent = storedEvent ?? fallbackOrganisation.events[0];
        setOrganisationId(fallbackOrganisation.id);
        setEventId(fallbackEvent?.id ?? '');
        writeEventControlContext({
          organisationId: fallbackOrganisation.id,
          organisationName: fallbackOrganisation.name,
          eventId: fallbackEvent?.id ?? null,
          eventName: fallbackEvent?.name ?? null,
        });
      })
      .catch(() => {
        if (active) setError('Context unavailable');
      });

    const sync = () => {
      const next = readEventControlContext();
      setOrganisationId(next.organisationId ?? '');
      setEventId(next.eventId ?? '');
    };
    window.addEventListener(eventControlContextChangedEvent, sync);
    return () => {
      active = false;
      window.removeEventListener(eventControlContextChangedEvent, sync);
    };
  }, []);

  const selectedOrganisation = useMemo(
    () => context?.organisations.find((organisation) => organisation.id === organisationId) ?? null,
    [context, organisationId],
  );

  if (error) return <span className="ec-context-subtle">{error}</span>;
  if (!context) return <span className="ec-context-subtle">Loading event context…</span>;
  if (context.organisations.length === 0) {
    return <span className="ec-context-subtle">No assigned organisations</span>;
  }

  return (
    <div
      className="ec-context-loader ec-context-loader--embedded"
      style={{ gridTemplateColumns: 'minmax(150px, 1fr) minmax(170px, 1fr)' }}
    >
      <select
        aria-label="Organisation"
        value={organisationId}
        onChange={(change) => {
          const organisation = context.organisations.find(
            (candidate) => candidate.id === change.target.value,
          );
          if (!organisation) return;
          const event = organisation.events[0];
          setOrganisationId(organisation.id);
          setEventId(event?.id ?? '');
          writeEventControlContext({
            organisationId: organisation.id,
            organisationName: organisation.name,
            eventId: event?.id ?? null,
            eventName: event?.name ?? null,
          });
        }}
      >
        {context.organisations.map((organisation) => (
          <option key={organisation.id} value={organisation.id}>
            {organisation.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Event"
        value={eventId}
        disabled={!selectedOrganisation || selectedOrganisation.events.length === 0}
        onChange={(change) => {
          const event = selectedOrganisation?.events.find(
            (candidate) => candidate.id === change.target.value,
          );
          if (!selectedOrganisation || !event) return;
          setEventId(event.id);
          writeEventControlContext({
            organisationId: selectedOrganisation.id,
            organisationName: selectedOrganisation.name,
            eventId: event.id,
            eventName: event.name,
          });
        }}
      >
        {selectedOrganisation?.events.length ? null : <option value="">No events</option>}
        {selectedOrganisation?.events.map((event) => (
          <option key={event.id} value={event.id}>
            {event.name} · {event.lifecycle.toLowerCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
