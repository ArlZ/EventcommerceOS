'use client';

import type { EventConfigurationView, EventRecord } from '@event-commerce/contracts';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { canEditEventSchedule, validateEventSchedule } from './event-schedule';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type Method = 'GET' | 'PATCH';
type Json = object;

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 10px',
};

const formStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
};

async function api<T>(
  path: string,
  method: Method,
  actorId: string,
  organisationId: string,
  body?: Json,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-actor-id': actorId,
      'x-role': 'ADMIN',
      'x-organisation-id': organisationId,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function eventLabel(event: EventRecord): string {
  return `${event.name} • ${event.lifecycle}`;
}

export function EventScheduleClient() {
  const actorId = useMemo(() => crypto.randomUUID(), []);
  const [organisationId, setOrganisationId] = useState('');
  const [configuration, setConfiguration] = useState<EventConfigurationView | null>(null);
  const [eventId, setEventId] = useState('');
  const [timezone, setTimezone] = useState('Africa/Nairobi');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Load an organisation to review its event schedule.');
  const [statusTone, setStatusTone] = useState<'success' | 'warning' | 'danger'>('warning');

  const activeEvents =
    configuration?.events.filter((event) => event.lifecycle !== 'ARCHIVED') ?? [];
  const selectedEvent = activeEvents.find((event) => event.id === eventId) ?? null;
  const editable = selectedEvent ? canEditEventSchedule(selectedEvent.lifecycle) : false;

  function selectEvent(event: EventRecord | null): void {
    if (!event) {
      setEventId('');
      setTimezone('Africa/Nairobi');
      setStartsAt('');
      setEndsAt('');
      return;
    }
    setEventId(event.id);
    setTimezone(event.timezone);
    setStartsAt(event.startsAt);
    setEndsAt(event.endsAt);
  }

  async function loadOrganisation(id = organisationId): Promise<void> {
    const nextOrganisationId = id.trim();
    if (!nextOrganisationId) return;
    setBusy(true);
    setStatusTone('warning');
    setStatus('Loading event schedules…');
    try {
      const view = await api<EventConfigurationView>(
        `/organisations/${nextOrganisationId}/configuration`,
        'GET',
        actorId,
        nextOrganisationId,
      );
      setOrganisationId(nextOrganisationId);
      setConfiguration(view);
      const previous = view.events.find(
        (event) => event.id === eventId && event.lifecycle !== 'ARCHIVED',
      );
      const nextEvent =
        previous ??
        view.events.find((event) => event.lifecycle === 'DRAFT') ??
        view.events.find((event) => event.lifecycle !== 'ARCHIVED') ??
        null;
      selectEvent(nextEvent);
      setStatus(`Loaded ${view.organisation.name}.`);
      setStatusTone('success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load event schedules');
      setStatusTone('danger');
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedEvent) return;
    if (!editable) {
      setStatus('Schedule editing is restricted to DRAFT events in Event Control.');
      setStatusTone('danger');
      return;
    }

    setBusy(true);
    setStatus('Saving schedule…');
    setStatusTone('warning');
    try {
      const schedule = validateEventSchedule({ timezone, startsAt, endsAt });
      await api<EventRecord>(
        `/events/${selectedEvent.id}`,
        'PATCH',
        actorId,
        organisationId,
        schedule,
      );
      await loadOrganisation(organisationId);
      setStatus('Event schedule updated through the Cloud API.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update the event schedule');
      setStatusTone('danger');
      setBusy(false);
    }
  }

  return (
    <div className="ec-operations-stack" style={{ marginTop: 18 }}>
      <section className={`ec-banner ec-banner--${statusTone}`} aria-live="polite">
        <strong>{busy ? 'Working…' : 'Schedule status'}</strong> • {status}
      </section>

      <section className="ec-panel">
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">Organisation</p>
            <h2>Load event schedules</h2>
            <p>Use the same organisation setup ID used in Event Control.</p>
          </div>
        </div>
        <form
          style={formStyle}
          onSubmit={(event) => {
            event.preventDefault();
            void loadOrganisation();
          }}
        >
          <input
            value={organisationId}
            onChange={(event) => setOrganisationId(event.target.value)}
            placeholder="Organisation ID"
            aria-label="Organisation ID"
            required
            disabled={busy}
            style={fieldStyle}
          />
          <button
            type="submit"
            disabled={busy || !organisationId.trim()}
            style={{ padding: '9px 12px' }}
          >
            Load organisation
          </button>
        </form>
      </section>

      {configuration ? (
        <section className="ec-panel">
          <div className="ec-panel-heading">
            <div>
              <p className="ec-eyebrow">Event</p>
              <h2>{configuration.organisation.name}</h2>
              <p>Select the event whose trading window needs to be reviewed.</p>
            </div>
          </div>

          <div style={formStyle}>
            <label htmlFor="schedule-event-select">
              <strong>Event</strong>
            </label>
            <select
              id="schedule-event-select"
              value={eventId}
              onChange={(event) => {
                const next =
                  activeEvents.find((candidate) => candidate.id === event.target.value) ?? null;
                selectEvent(next);
              }}
              disabled={busy}
              style={fieldStyle}
            >
              <option value="">Select event</option>
              {activeEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {eventLabel(event)}
                </option>
              ))}
            </select>
          </div>

          {selectedEvent ? (
            <div className="ec-list" style={{ marginTop: 12 }}>
              <div className="ec-list-row">
                <strong>{selectedEvent.name}</strong>
                <div className="ec-alert-meta">Lifecycle: {selectedEvent.lifecycle}</div>
                <div className="ec-alert-meta">Timezone: {selectedEvent.timezone}</div>
                <div className="ec-alert-meta">Starts: {selectedEvent.startsAt}</div>
                <div className="ec-alert-meta">Ends: {selectedEvent.endsAt}</div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedEvent ? (
        <section className="ec-panel ec-panel--priority">
          <div className="ec-panel-heading">
            <div>
              <p className="ec-eyebrow">Schedule</p>
              <h2>Edit trading window</h2>
              <p>
                Event Control only permits schedule changes while the event is still DRAFT. Use ISO
                timestamps with an explicit offset.
              </p>
            </div>
            <span className="ec-status-pill" data-tone={editable ? 'warning' : 'danger'}>
              {editable ? 'Editable draft' : 'Read only'}
            </span>
          </div>

          {!editable ? (
            <div className="ec-banner ec-banner--warning" style={{ marginBottom: 12 }}>
              This event is {selectedEvent.lifecycle}. Schedule editing is disabled here to avoid
              changing a live or closed trading window.
            </div>
          ) : null}

          <form style={formStyle} onSubmit={(event) => void saveSchedule(event)}>
            <label>
              <strong>Timezone</strong>
              <input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="Africa/Nairobi"
                required
                disabled={!editable || busy}
                style={fieldStyle}
              />
            </label>
            <label>
              <strong>Start time</strong>
              <input
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                placeholder="2026-08-26T18:00:00+03:00"
                required
                disabled={!editable || busy}
                style={fieldStyle}
              />
            </label>
            <label>
              <strong>End time</strong>
              <input
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                placeholder="2026-08-27T02:00:00+03:00"
                required
                disabled={!editable || busy}
                style={fieldStyle}
              />
            </label>
            <button
              className="ec-button-primary"
              type="submit"
              disabled={!editable || busy}
              style={{ padding: '9px 12px' }}
            >
              Save event schedule
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
