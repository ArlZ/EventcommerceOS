'use client';

import { useLayoutEffect, useState } from 'react';

const STORAGE_KEY = 'event-commerce.operator-access-token';
const cloudApiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

function validToken(value: string): boolean {
  return value.startsWith('ecom_op_') && value.length >= 48 && value.length <= 256;
}

export function OperatorSessionControl() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useLayoutEffect(() => {
    const existing = window.sessionStorage.getItem(STORAGE_KEY) ?? '';
    setSaved(validToken(existing));

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

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  function save(): void {
    const normalized = token.trim();
    if (!validToken(normalized)) {
      setInvalid(true);
      setSaved(false);
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, normalized);
    setToken('');
    setInvalid(false);
    setSaved(true);
    setDialogOpen(false);
  }

  function clear(): void {
    window.sessionStorage.removeItem(STORAGE_KEY);
    setToken('');
    setInvalid(false);
    setSaved(false);
  }

  return (
    <>
      <div className="ec-session-mini" aria-label="Operator access">
        <span className="ec-session-dot" data-active={saved} aria-hidden="true" />
        <span className="ec-session-copy">
          <small>Session</small>
          <strong>{saved ? 'Secure' : 'Inactive'}</strong>
        </span>
        {saved ? (
          <button type="button" className="ec-session-button" onClick={clear}>
            End
          </button>
        ) : (
          <button type="button" className="ec-session-button" onClick={() => setDialogOpen(true)}>
            Start
          </button>
        )}
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
                <h2 id="operator-session-title">Start secure session</h2>
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
            <p className="ec-session-dialog-copy">
              Paste the operator access token issued for this event. The token stays in this browser
              tab and is attached only to Cloud API requests.
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
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && validToken(token.trim())) save();
                if (event.key === 'Escape') setDialogOpen(false);
              }}
              aria-invalid={invalid}
            />
            {invalid ? (
              <div className="ec-field-error">That operator token is not valid.</div>
            ) : null}
            <div className="ec-session-dialog-actions">
              <button type="button" onClick={() => setDialogOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="ec-button-primary"
                onClick={save}
                disabled={!validToken(token.trim())}
              >
                Authenticate
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
