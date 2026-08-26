'use client';

import type { EventConfigurationView, EventRecord } from '@event-commerce/contracts';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import {
  eventControlContextChangedEvent,
  readEventControlContext,
  writeEventControlContext,
} from '../event-context';
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
  organisationId: string,
  body?: Json,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-event-control-request': 'browser',
      'x-organisation-id': organisationId,
    },
    credentials: 'include',
    cache: 'no-store',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function eventLabel(event: EventRecord): string {
  return `${event.name} • ${event.lifecycle}`;
}

function formatScheduleTime(value: string, timezone: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Enter a valid timestamp';
  try {
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(parsed));
  } catch {
    return new Date(parsed).toLocaleString();
  }
}

function durationLabel(startsAt: string, endsAt: string): string {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '—';
  const minutes = Math.round((end - start) / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function EventScheduleClient() {
  const [organisationId, setOrganisationId] = useState('');
  const [configuration, setConfiguration] = useState<EventConfigurationView | null>(null);
  const [eventId, setEventId] = useState('');
  const [timezone, setTimezone] = useState('Africa/Nairobi');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    'Select an event from the authenticated Event Control context.',
  );
  const [statusTone, setStatusTone] = useState<'success' | 'warning' | 'danger'>('warning');

  useEffect(() => {
    const syncContext = () => {
      const context = readEventControlContext();
      const nextOrganisationId = context.organisationId ?? '';
      setOrganisationId(nextOrganisationId);
      setEventId(context.eventId ?? '');
      if (!nextOrganisationId) {
        setConfiguration(null);
        setStatus('Select an organisation and event above to review its schedule.');
        setStatusTone('warning');
      } else if (context.organisationName) {
        setStatus(`Loading ${context.organisationName} schedules…`);
        setStatusTone('warning');
      }
    };

    syncContext();
    window.addEventListener(eventControlContextChangedEvent, syncContext);
    return () => window.removeEventListener(eventControlContextChangedEvent, syncContext);
  }, []);

  useEffect(() => {
    if (!organisationId.trim()) return;
    void loadOrganisation(organisationId);
  }, [organisationId]);

  const activeEvents =
    configuration?.events.filter((event) => event.lifecycle !== 'ARCHIVED') ?? [];
  const selectedEvent = activeEvents.find((event) => event.id === eventId) ?? null;
  const editable = selectedEvent ? canEditEventSchedule(selectedEvent.lifecycle) : false;
  const dirty = Boolean(
    selectedEvent &&
      (timezone !== selectedEvent.timezone ||
        startsAt !== selectedEvent.startsAt ||
        endsAt !== selectedEvent.endsAt),
  );

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
    writeEventControlContext({
      organisationId,
      ...(configuration?.organisation.name
        ? { organisationName: configuration.organisation.name }
        : {}),
      eventId: event.id,
      eventName: event.name,
    });
  }

  function resetSchedule(): void {
    if (!selectedEvent) return;
    setTimezone(selectedEvent.timezone);
    setStartsAt(selectedEvent.startsAt);
    setEndsAt(selectedEvent.endsAt);
    setStatus('Unsaved schedule changes were reset.');
    setStatusTone('success');
  }

  async function loadOrganisation(id: string): Promise<void> {
    const nextOrganisationId = id.trim();
    if (!nextOrganisationId) return;
    setBusy(true);
    setStatusTone('warning');
    setStatus('Loading event schedules…');
    try {
      const view = await api<EventConfigurationView>(
        `/organisations/${nextOrganisationId}/configuration`,
        'GET',
        nextOrganisationId,
      );
      setConfiguration(view);
      const context = readEventControlContext();
      const preferredEventId =
        context.organisationId === nextOrganisationId ? context.eventId : null;
      const previous = view.events.find(
        (event) => event.id === preferredEventId && event.lifecycle !== 'ARCHIVED',
      );
      const nextEvent =
        previous ??
        view.events.find((event) => event.lifecycle === 'DRAFT') ??
        view.events.find((event) => event.lifecycle !== 'ARCHIVED') ??
        null;
      if (nextEvent) {
        setEventId(nextEvent.id);
        setTimezone(nextEvent.timezone);
        setStartsAt(nextEvent.startsAt);
        setEndsAt(nextEvent.endsAt);
        if (preferredEventId !== nextEvent.id) {
          writeEventControlContext({
            organisationId: nextOrganisationId,
            organisationName: view.organisation.name,
            eventId: nextEvent.id,
            eventName: nextEvent.name,
          });
        }
      } else {
        selectEvent(null);
        writeEventControlContext({
          organisationId: nextOrganisationId,
          organisationName: view.organisation.name,
          eventId: null,
          eventName: null,
        });
      }
      setStatus(`Loaded ${view.organisation.name}.`);
      setStatusTone('success');
    } catch (error) {
      setConfiguration(null);
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
    if (!dirty) {
      setStatus('No schedule changes to save.');
      setStatusTone('success');
      return;
    }

    setBusy(true);
    setStatus('Saving schedule…');
    setStatusTone('warning');
    try {
      const schedule = validateEventSchedule({ timezone, startsAt, endsAt });
      await api<EventRecord>(`/events/${selectedEvent.id}`, 'PATCH', organisationId, schedule);
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
    <div className="ec-operations-stack" style={{ marginTop: 18 }} aria-busy={busy}>
      <section className={`ec-banner ec-banner--${statusTone}`} aria-live="polite">
        <strong>{busy ? 'Working…' : 'Schedule status'}</strong> • {status}
      </section>

      {configuration ? (
        <section className="ec-panel">
          <div className="ec-panel-heading">
            <div>
              <p className="ec-eyebrow">Event</p>
              <h2>{configuration.organisation.name}</h2>
              <p>Select the event whose trading window needs to be reviewed.</p>
            </div>
            {selectedEvent ? (
              <span className="ec-status-pill" data-tone={editable ? 'warning' : 'success'}>
                {selectedEvent.lifecycle}
              </span>
            ) : null}
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
            <div className="ec-kpi-grid" style={{ marginTop: 12 }}>
              <ScheduleMetric label="Timezone" value={selectedEvent.timezone} />
              <ScheduleMetric
                label="Current start"
                value={formatScheduleTime(selectedEvent.startsAt, selectedEvent.timezone)}
              />
              <ScheduleMetric
                label="Current end"
                value={formatScheduleTime(selectedEvent.endsAt, selectedEvent.timezone)}
              />
              <ScheduleMetric
                label="Trading duration"
                value={durationLabel(selectedEvent.startsAt, selectedEvent.endsAt)}
              />
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
            <span
              className="ec-status-pill"
              data-tone={!editable ? 'danger' : dirty ? 'warning' : 'success'}
            >
              {!editable ? 'Read only' : dirty ? 'Unsaved changes' : 'Saved schedule'}
            </span>
          </div>

          {!editable ? (
            <div className="ec-banner ec-banner--warning" style={{ marginBottom: 12 }}>
              This event is {selectedEvent.lifecycle}. Schedule editing is disabled here to avoid
              changing a live or closed trading window.
            </div>
          ) : null}

          <div className="ec-kpi-grid" style={{ marginBottom: 12 }}>
            <ScheduleMetric label="Proposed start" value={formatScheduleTime(startsAt, timezone)} />
            <ScheduleMetric label="Proposed end" value={formatScheduleTime(endsAt, timezone)} />
            <ScheduleMetric label="Duration" value={durationLabel(startsAt, endsAt)} />
          </div>

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
            <div className="ec-form-actions">
              <button
                className="ec-button-primary"
                type="submit"
                disabled={!editable || busy || !dirty}
                style={{ padding: '9px 12px' }}
              >
                Save schedule changes
              </button>
              <button
                type="button"
                disabled={!editable || busy || !dirty}
                onClick={resetSchedule}
                style={{ padding: '9px 12px' }}
              >
                Reset changes
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function ScheduleMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ec-kpi">
      <span className="ec-kpi-label">{label}</span>
      <strong className="ec-kpi-value" style={{ fontSize: 16 }}>
        {value}
      </strong>
    </div>
  );
}
