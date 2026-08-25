'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventConfigurationView } from '@event-commerce/contracts';
import { eventControlContextChangedEvent, readEventControlContext } from '../event-context';
import { posMenusReadyToOpen } from './pos-menu-readiness';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type Publication = {
  salesLocationId: string;
  version: number;
  checksum: string;
};

type PublicationStatus = Publication & {
  publishedAt: string;
  installedEdges: Array<{ edgeId: string; reportedAt: string }>;
};

type LocationStatus = PublicationStatus & { salesLocationName: string };

export function PosMenuPublicationControl() {
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [eventName, setEventName] = useState('');
  const [lifecycle, setLifecycle] = useState<string | null>(null);
  const [publicationStatus, setPublicationStatus] = useState<LocationStatus[]>([]);
  const [activeSalesLocationIds, setActiveSalesLocationIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [openingConfirming, setOpeningConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'warning' | 'danger'>('warning');
  const contextVersion = useRef(0);

  const loadStatus = useCallback(
    async (selectedOrganisationId: string, selectedEventId: string, version: number) => {
      const headers = { 'x-organisation-id': selectedOrganisationId };
      const [configurationResponse, statusResponse] = await Promise.all([
        fetch(`${apiBase}/organisations/${selectedOrganisationId}/configuration`, {
          credentials: 'include',
          headers,
        }),
        fetch(`${apiBase}/events/${selectedEventId}/pos-menu-publication-status`, {
          credentials: 'include',
          headers,
        }),
      ]);
      if (!configurationResponse.ok) {
        throw new Error(`${configurationResponse.status}: ${await configurationResponse.text()}`);
      }
      if (!statusResponse.ok) {
        throw new Error(`${statusResponse.status}: ${await statusResponse.text()}`);
      }
      const configuration = (await configurationResponse.json()) as EventConfigurationView;
      const statuses = (await statusResponse.json()) as PublicationStatus[];
      if (contextVersion.current !== version) return;

      const selected = configuration.events.find((event) => event.id === selectedEventId);
      const locations = new Map(
        configuration.salesLocations.map((location) => [location.id, location.name]),
      );
      setLifecycle(selected?.lifecycle ?? null);
      setActiveSalesLocationIds(
        configuration.salesLocations
          .filter(
            (location) => location.eventId === selectedEventId && location.lifecycle === 'ACTIVE',
          )
          .map((location) => location.id),
      );
      setPublicationStatus(
        statuses.map((status) => ({
          ...status,
          salesLocationName: locations.get(status.salesLocationId) ?? status.salesLocationId,
        })),
      );
    },
    [],
  );

  const syncContext = useCallback(() => {
    const version = ++contextVersion.current;
    const context = readEventControlContext();
    setOrganisationId(context.organisationId ?? '');
    setEventId(context.eventId ?? '');
    setEventName(context.eventName ?? '');
    setLifecycle(null);
    setPublicationStatus([]);
    setActiveSalesLocationIds([]);
    setConfirming(false);
    setOpeningConfirming(false);
    setMessage('');
    if (!context.organisationId || !context.eventId) return;

    void loadStatus(context.organisationId, context.eventId, version).catch(() => {
      if (contextVersion.current !== version) return;
      setLifecycle(null);
      setPublicationStatus([]);
    });
  }, [loadStatus]);

  useEffect(() => {
    syncContext();
    window.addEventListener(eventControlContextChangedEvent, syncContext);
    return () => window.removeEventListener(eventControlContextChangedEvent, syncContext);
  }, [syncContext]);

  const readyToOpen =
    lifecycle === 'DRAFT' && posMenusReadyToOpen(activeSalesLocationIds, publicationStatus);

  async function openForTrading(): Promise<void> {
    if (!organisationId || !eventId || !readyToOpen) return;
    const version = contextVersion.current;
    const selectedOrganisationId = organisationId;
    const selectedEventId = eventId;
    setBusy(true);
    setTone('warning');
    setMessage('Opening event for trading…');
    try {
      const response = await fetch(`${apiBase}/events/${selectedEventId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-organisation-id': selectedOrganisationId,
        },
        body: JSON.stringify({ lifecycle: 'ACTIVE' }),
      });
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      if (contextVersion.current !== version) return;
      setTone('success');
      setMessage(`${eventName || 'Event'} is open for trading.`);
      setOpeningConfirming(false);
      await loadStatus(selectedOrganisationId, selectedEventId, version);
    } catch (error) {
      if (contextVersion.current !== version) return;
      setTone('danger');
      setMessage(error instanceof Error ? error.message : 'Unable to open event for trading');
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    if (!organisationId || !eventId || lifecycle !== 'DRAFT') return;
    const version = contextVersion.current;
    const publicationEventId = eventId;
    const publicationOrganisationId = organisationId;
    setBusy(true);
    setTone('warning');
    setMessage('Publishing immutable POS menu snapshots…');
    try {
      const response = await fetch(
        `${apiBase}/events/${publicationEventId}/pos-menu-publications`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-organisation-id': publicationOrganisationId,
          },
        },
      );
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      const publications = (await response.json()) as Publication[];
      if (contextVersion.current !== version) return;
      const summary = publications
        .map((publication) => `v${publication.version} for ${publication.salesLocationId}`)
        .join(', ');
      setTone('success');
      setMessage(
        `Published ${publications.length} location snapshot${publications.length === 1 ? '' : 's'}${summary ? `: ${summary}` : '.'}`,
      );
      setConfirming(false);
      await loadStatus(publicationOrganisationId, publicationEventId, version);
    } catch (error) {
      if (contextVersion.current !== version) return;
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

      {publicationStatus.length > 0 ? (
        <div className="ec-stack" aria-label="POS menu delivery status">
          {publicationStatus.map((status) => {
            const installed = status.installedEdges.length > 0;
            return (
              <div className="ec-inline-confirm" key={status.salesLocationId}>
                <span>
                  <strong>{status.salesLocationName}</strong> · v{status.version} ·{' '}
                  {installed
                    ? `Installed on ${status.installedEdges.map((edge) => edge.edgeId).join(', ')}`
                    : 'Awaiting Event Edge installation'}
                </span>
                <span className="ec-status-pill" data-tone={installed ? 'success' : 'warning'}>
                  {installed ? 'Installed' : 'Published'}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {lifecycle === 'DRAFT' ? (
        readyToOpen ? (
          openingConfirming ? (
            <div className="ec-inline-confirm" role="group" aria-label="Confirm event opening">
              <span>
                Open <strong>{eventName || 'this event'}</strong> for live trading? Event-scoped
                setup becomes read only after activation.
              </span>
              <button
                className="ec-button-primary"
                type="button"
                disabled={busy}
                onClick={() => void openForTrading()}
              >
                {busy ? 'Opening…' : 'Confirm open for trading'}
              </button>
              <button type="button" disabled={busy} onClick={() => setOpeningConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="ec-banner ec-banner--success">
              <strong>Ready to open.</strong> Every active sales location has its latest POS menu
              installed on Event Edge.{' '}
              <button
                className="ec-button-primary"
                type="button"
                disabled={busy}
                onClick={() => setOpeningConfirming(true)}
              >
                Open event for trading
              </button>
            </div>
          )
        ) : (
          <div className="ec-banner ec-banner--warning">
            <strong>Not ready to open.</strong> Publish the current configuration and install the
            latest POS menu on Event Edge for every active sales location first.
          </div>
        )
      ) : null}

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
        <div
          className={`ec-banner ec-banner--${tone}`}
          aria-live="polite"
          style={{ marginTop: 12 }}
        >
          {message}
        </div>
      ) : null}
    </section>
  );
}
