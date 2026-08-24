'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { readEventControlContext, selectOrganisationContext } from './event-context';

const STORAGE_KEY = 'event-commerce.operator-access-token';
const cloudApiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type SessionState = 'inactive' | 'checking' | 'active' | 'unverified';

type OperatorSessionProfile = {
  actorId: string;
  displayName: string;
  platformAdmin: boolean;
  expiresAt: string;
  memberships: Array<{
    organisationId: string;
    organisationName: string;
    role: 'ADMIN' | 'FINANCE' | 'SUPERVISOR' | 'VIEWER';
  }>;
};

function validToken(value: string): boolean {
  return value.startsWith('ecom_op_') && value.length >= 48 && value.length <= 256;
}

function expiryLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Unknown expiry';
  try {
    return new Intl.DateTimeFormat('en-KE', {
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

export function OperatorSessionControl() {
  const [token, setToken] = useState('');
  const [state, setState] = useState<SessionState>('inactive');
  const [profile, setProfile] = useState<OperatorSessionProfile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fetchReady, setFetchReady] = useState(false);

  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const cloudOrigin = new URL(cloudApiBase, window.location.href).origin;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        input instanceof Request
          ? new URL(input.url, window.location.href)
          : new URL(input, window.location.href);
      if (requestUrl.origin !== cloudOrigin) return originalFetch(input, init);

      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.delete('x-actor-id');
      headers.delete('x-role');

      const accessToken = window.sessionStorage.getItem(STORAGE_KEY) ?? '';
      if (validToken(accessToken)) headers.set('authorization', `Bearer ${accessToken}`);
      else headers.delete('authorization');

      return originalFetch(input, { ...init, headers });
    };

    setFetchReady(true);
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  async function verifyStoredToken(accessToken: string, closeOnSuccess: boolean): Promise<void> {
    if (!validToken(accessToken)) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      setState('inactive');
      setProfile(null);
      return;
    }

    setState('checking');
    setMessage(null);
    try {
      const response = await fetch(`${cloudApiBase}/auth/operator/session`, { cache: 'no-store' });
      if (!response.ok) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        setState('inactive');
        setProfile(null);
        setInvalid(true);
        setMessage('This operator session is expired, revoked or invalid.');
        return;
      }
      const nextProfile = (await response.json()) as OperatorSessionProfile;
      setProfile(nextProfile);
      setState('active');
      setInvalid(false);
      setMessage(null);
      if (closeOnSuccess) setDialogOpen(false);
    } catch {
      setState('unverified');
      setProfile(null);
      setMessage('Cloud API could not verify this session. Protected actions may be unavailable.');
    }
  }

  useEffect(() => {
    if (!fetchReady) return;
    const existing = window.sessionStorage.getItem(STORAGE_KEY) ?? '';
    if (!existing) return;
    void verifyStoredToken(existing, false);
  }, [fetchReady]);

  function save(): void {
    const normalized = token.trim();
    if (!validToken(normalized)) {
      setInvalid(true);
      setMessage('That operator token does not match the expected session format.');
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, normalized);
    setToken('');
    setInvalid(false);
    void verifyStoredToken(normalized, true);
  }

  function clear(): void {
    window.sessionStorage.removeItem(STORAGE_KEY);
    setToken('');
    setInvalid(false);
    setMessage(null);
    setProfile(null);
    setState('inactive');
    setDialogOpen(false);
  }

  function useOrganisation(
    membership: OperatorSessionProfile['memberships'][number],
  ): void {
    selectOrganisationContext(membership.organisationId, membership.organisationName);
    setDialogOpen(false);
    window.location.reload();
  }

  const active = state === 'active';
  const currentOrganisationId = readEventControlContext().organisationId;

  return (
    <>
      <div className="ec-session-mini" aria-label="Operator access">
        <span className="ec-session-dot" data-state={state} aria-hidden="true" />
        <span className="ec-session-copy" title={profile?.displayName}>
          <small>Session</small>
          <strong>
            {state === 'checking'
              ? 'Checking…'
              : active
                ? 'Verified'
                : state === 'unverified'
                  ? 'Unverified'
                  : 'Inactive'}
          </strong>
        </span>
        <button
          type="button"
          className="ec-session-button"
          disabled={state === 'checking'}
          onClick={() => setDialogOpen(true)}
        >
          {active ? 'Manage' : 'Start'}
        </button>
      </div>

      {dialogOpen ? (
        <div
          className="ec-session-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialogOpen(false);
          }}
        >
          <section
            className="ec-session-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operator-session-title"
          >
            <div className="ec-session-dialog-head">
              <div>
                <p>Protected actions</p>
                <h2 id="operator-session-title">
                  {active ? profile?.displayName : 'Start secure session'}
                </h2>
              </div>
              <button
                type="button"
                className="ec-icon-button"
                onClick={() => setDialogOpen(false)}
                aria-label="Close session dialog"
              >
                ×
              </button>
            </div>

            {active && profile ? (
              <>
                <div className="ec-session-verification">
                  <span className="ec-status-pill" data-tone="success">
                    Verified by Cloud API
                  </span>
                  <span>{profile.platformAdmin ? 'Platform administrator' : 'Operator'}</span>
                  <span>Expires {expiryLabel(profile.expiresAt)}</span>
                </div>

                {profile.memberships.length > 0 ? (
                  <div className="ec-session-scopes">
                    <p className="ec-session-dialog-copy">
                      Choose the organisation Event Control should use. Changing scope clears the
                      previously selected event so an event from another organisation cannot be
                      carried across accidentally.
                    </p>
                    {profile.memberships.map((membership) => (
                      <button
                        type="button"
                        className="ec-session-scope"
                        data-active={membership.organisationId === currentOrganisationId}
                        key={membership.organisationId}
                        onClick={() => useOrganisation(membership)}
                      >
                        <span>
                          <strong>{membership.organisationName}</strong>
                          <small>{membership.role}</small>
                        </span>
                        <span>
                          {membership.organisationId === currentOrganisationId ? 'Current' : 'Use'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="ec-session-dialog-copy">
                    {profile.platformAdmin
                      ? 'This platform administrator can select an organisation directly in Event Control.'
                      : 'No active organisation memberships are assigned to this operator.'}
                  </p>
                )}

                <div className="ec-session-dialog-actions">
                  <button type="button" onClick={clear}>
                    End session
                  </button>
                  <button type="button" className="ec-button-primary" onClick={() => setDialogOpen(false)}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="ec-session-dialog-copy">
                  Paste the operator access token issued for this event. The token stays in this
                  browser tab and is attached only to Cloud API requests. Event Control will verify
                  it with Cloud before marking the session active.
                </p>
                <label className="ec-field-label" htmlFor="operator-access-token">
                  Operator access token
                </label>
                <input
                  id="operator-access-token"
                  type="password"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ecom_op_…"
                  value={token}
                  onChange={(event) => {
                    setToken(event.target.value);
                    setInvalid(false);
                    setMessage(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && validToken(token.trim())) save();
                    if (event.key === 'Escape') setDialogOpen(false);
                  }}
                  aria-invalid={invalid}
                  disabled={state === 'checking'}
                />
                {message ? (
                  <div className={invalid ? 'ec-field-error' : 'ec-session-note'}>{message}</div>
                ) : null}
                <div className="ec-session-dialog-actions">
                  {state === 'unverified' ? (
                    <button type="button" onClick={clear}>
                      Clear token
                    </button>
                  ) : (
                    <button type="button" onClick={() => setDialogOpen(false)}>
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    className="ec-button-primary"
                    onClick={save}
                    disabled={state === 'checking' || !validToken(token.trim())}
                  >
                    {state === 'checking' ? 'Verifying…' : 'Authenticate'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
