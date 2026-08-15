'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'event-commerce.operator-access-token';
const cloudApiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

function validToken(value: string): boolean {
  return value.startsWith('ecom_op_') && value.length >= 48 && value.length <= 256;
}

export function OperatorSessionControl() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = window.sessionStorage.getItem(STORAGE_KEY) ?? '';
    setToken(existing);
    setSaved(validToken(existing));

    const originalFetch = window.fetch.bind(window);
    const cloudOrigin = new URL(cloudApiBase, window.location.href).origin;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        input instanceof Request ? new URL(input.url, window.location.href) : new URL(input, window.location.href);
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
      setSaved(false);
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, normalized);
    setToken(normalized);
    setSaved(true);
  }

  function clear(): void {
    window.sessionStorage.removeItem(STORAGE_KEY);
    setToken('');
    setSaved(false);
  }

  return (
    <aside
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '10px 14px',
        background: '#fff8dc',
        borderBottom: '1px solid #e5d79a',
        fontFamily: 'sans-serif',
      }}
    >
      <strong style={{ whiteSpace: 'nowrap' }}>Operator session</strong>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-label="Operator access token"
        placeholder="Paste ecom_op_… access token"
        value={token}
        onChange={(event) => {
          setToken(event.target.value);
          setSaved(false);
        }}
        style={{ flex: 1, minWidth: 220, padding: 7 }}
      />
      <button type="button" onClick={save} disabled={!validToken(token.trim())}>
        Use session
      </button>
      <button type="button" onClick={clear} disabled={!token && !saved}>
        Clear
      </button>
      <span style={{ fontSize: 12 }}>{saved ? 'Session active for this browser tab' : 'No active session'}</span>
    </aside>
  );
}
