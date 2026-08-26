'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { EventConfigurationView } from '@event-commerce/contracts';
import { readEventControlContext } from '../event-context';
import { evaluateEventReadiness, type EventReadiness } from './readiness';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

export function ReadinessClient() {
  const [readiness, setReadiness] = useState<EventReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState({ organisationId: '', eventId: '' });

  useEffect(() => {
    const selected = readEventControlContext();
    const organisationId = selected.organisationId ?? '';
    const eventId = selected.eventId ?? '';
    setContext({ organisationId, eventId });

    if (!organisationId || !eventId) {
      setLoading(false);
      return;
    }

    let active = true;
    setError(null);
    void fetch(`${apiBase}/organisations/${organisationId}/configuration`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'x-event-control-request': 'browser' },
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Readiness check failed with ${response.status}`);
        const configuration = (await response.json()) as EventConfigurationView;
        if (active) setReadiness(evaluateEventReadiness(configuration, eventId));
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Unable to load pilot readiness');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <section className="ec-panel" aria-live="polite">
        <strong>Checking event setup…</strong>
        <p>Loading the selected event and evaluating its controlled-pilot configuration.</p>
      </section>
    );
  }

  if (!context.organisationId || !context.eventId) {
    return (
      <section className="ec-panel ec-panel--priority">
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">No event selected</p>
            <h2>Choose the pilot event first</h2>
            <p>
              Pilot readiness follows the event currently selected in Event Control. Create or load
              an event in Setup, then return here.
            </p>
          </div>
        </div>
        <Link className="ec-button-primary" href="/configuration">
          Open event setup
        </Link>
      </section>
    );
  }

  if (error || !readiness) {
    return (
      <section className="ec-banner ec-banner--danger" role="alert">
        <strong>Readiness unavailable.</strong>{' '}
        {error ?? 'Event configuration could not be evaluated.'}
      </section>
    );
  }

  return (
    <div className="ec-operations-stack">
      <section className={`ec-banner ec-banner--${readiness.ready ? 'success' : 'warning'}`}>
        <strong>
          {readiness.ready
            ? 'Configuration preflight passed.'
            : `${readiness.completed} of ${readiness.total} setup checks passed.`}
        </strong>{' '}
        {readiness.ready
          ? 'The event can move into device, payment, offline and reconciliation validation.'
          : 'Resolve the incomplete setup checks before treating the event as a controlled-pilot candidate.'}
      </section>

      <section className="ec-panel">
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">Configuration preflight</p>
            <h2>{readiness.event?.name ?? 'Selected event'}</h2>
            <p>
              This is a product-level preflight, not a live-money approval. Hardware, M-PESA
              sandbox, offline durability, recovery and Event Close evidence remain separate gates.
            </p>
          </div>
          <span className="ec-status-pill" data-tone={readiness.ready ? 'success' : 'warning'}>
            {readiness.ready ? 'Setup ready' : 'Setup incomplete'}
          </span>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {readiness.items.map((item) => (
            <div className="ec-list-row" key={item.key}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  alignItems: 'flex-start',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong>{item.label}</strong>
                    <span
                      className="ec-status-pill"
                      data-tone={item.complete ? 'success' : 'warning'}
                    >
                      {item.complete ? 'Ready' : 'Action needed'}
                    </span>
                  </div>
                  <p style={{ marginBottom: 0 }}>{item.detail}</p>
                </div>
                {!item.complete ? (
                  <Link href={item.href} style={{ whiteSpace: 'nowrap' }}>
                    Fix →
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ec-panel">
        <div className="ec-panel-heading">
          <div>
            <p className="ec-eyebrow">Next controlled-pilot gates</p>
            <h2>What setup readiness does not prove</h2>
          </div>
        </div>
        <div className="ec-card-grid">
          <div className="ec-nav-card" style={{ cursor: 'default' }}>
            <div>
              <strong>Venue & devices</strong>
              <p>Event Edge, LAN, power, supported Android POS devices and restart behaviour.</p>
            </div>
          </div>
          <div className="ec-nav-card" style={{ cursor: 'default' }}>
            <div>
              <strong>Payment resilience</strong>
              <p>M-PESA sandbox delay, duplicate callback, timeout and reconciliation scenarios.</p>
            </div>
          </div>
          <div className="ec-nav-card" style={{ cursor: 'default' }}>
            <div>
              <strong>Offline & close</strong>
              <p>
                Committed-order durability, cloud convergence, stock counts and Event Close
                evidence.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
