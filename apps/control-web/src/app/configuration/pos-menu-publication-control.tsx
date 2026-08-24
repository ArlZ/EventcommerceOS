'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EventConfigurationView } from '@event-commerce/contracts';
import {
  eventControlContextChangedEvent,
  readEventControlContext,
} from '../event-context';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type Publication = {
  salesLocationId: string;
  version: number;
  checksum: string;
};

export function PosMenuPublicationControl() {
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [eventName, setEventName] = useState('');
  const [lifecycle, setLifecycle] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'warning' | 'danger'>('warning');

  const syncContext = useCallback(() => {
    const context = readEventControlContext();
    setOrganisationId(context.organisationId ?? '');
    setEventId(context.eventId ?? '');
    setEventName(context.eventName ?? '');
    setLifecycle(null);
    setConfirming(false);
    setMessage('');
    if (!context.organisationId || !context.eventId) return;

    void fetch(`${apiBase}/organisations/${context.organisationId}/configuration`, {
      credentials: 'include',
      headers: { 'x-organisation-id': context.organisationId },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        return (await response.json()) as EventConfigurationView;
      })
      .then((view) => {
        const selected = view.events.find((event) => event.id === context.eventId);
        setLifecycle(selected?.lifecycle ?? null);
      })
      .catch(() => setLifecycle(null));
  }, []);

  useEffect(() => {
    syncContext();
    window.addEventListener(eventControlContextChangedEvent, syncContext);
    return () => window.removeEventListener(eventControlContextChangedEvent, syncContext);
  }, [syncContext]);

  async function publish(): Promise<void> {
    if (!organisationId || !eventId || lifecycle !== 'DRAFT') return;
    setBusy(true);
    setTone('warning');
    setMessage('Publishing immutable POS menu snapshots…');
    try {
      const response = await fetch(`${apiBase}/events/${eventId}/pos-menu-publications`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-organisation-id': organisationId,
        },
      });
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      const publications = (await response.json()) as Publication[];
      const summary = publications
        .map((publication) => `v${publication.version} for ${publication.salesLocationId}`)
        .join(', ');
      setTone('success');
      setMessage(
        `Published ${publications.length} location snapshot${publications.length === 1 ? '' : 's'}${summary ? `: ${summary}` : '.'}`,
      );
      setConfirming(false);
    } catch (error) {
      setTone('danger');
      setMessage(error instanceof Error ? error.message : 'Unable to publish POS menus');
    } finally {
      setBusy(false);
    }
  }

  if (!organisationId || !eventId) return null;

  return (
    <section className="ec-panel ec-panel--priority" aria-busy={busy}>
      <div className="ec-panel-heading">
        <div>
          <p className="ec-eyebrow">Pre-open delivery</p>
          <h2>Publish menus to Event Edge</h2>
          <p>
            Freeze the current DRAFT configuration into immutable, versioned POS menu snapshots for
            every active sales location. Event Edge must still pull and locally install the
            publication before registers can trade from it.
          </p>
        </div>
        <span className="ec-status-pill" data-tone={lifecycle === 'DRAFT' ? 'warning' : 'neutral'}>
          {lifecycle ?? 'Unavailable'}
        </span>
      </div>

      {lifecycle !== 'DRAFT' ? (
        <div className="ec-banner ec-banner--warning">
          Publication is available only while the selected event is DRAFT. ACTIVE and later event
          setup remains read only.
        </div>
      ) : confirming ? (
        <div className="ec-inline-confirm" role="group" aria-label="Confirm POS menu publication">
          <span>
            Publish the current configuration for <strong>{eventName || 'this event'}</strong>? This
            creates a new immutable version for every active sales location.
          </span>
          <button
            className="ec-button-primary"
            type="button"
            disabled={busy}
            onClick={() => void publish()}
          >
            {busy ? 'Publishing…' : 'Confirm publication'}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="ec-alert-actions">
          <button
            className="ec-button-primary"
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Publish POS menus
          </button>
        </div>
      )}

      {message ? (
        <div className={`ec-banner ec-banner--${tone}`} aria-live="polite" style={{ marginTop: 12 }}>
          {message}
        </div>
      ) : null}
    </section>
  );
}
