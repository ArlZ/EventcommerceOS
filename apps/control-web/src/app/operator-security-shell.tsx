'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

const cloudApiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';
const TOKEN_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\.[A-Za-z0-9_-]{32,}$/;

export function OperatorSecurityShell({ children }: { children: ReactNode }) {
  const [credential, setCredential] = useState('');
  const normalized = credential.trim();
  const valid = normalized.length > 0 && TOKEN_PATTERN.test(normalized);
  const cloudOrigin = useMemo(() => {
    try {
      return new URL(cloudApiBase, 'http://localhost').origin;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!valid || !cloudOrigin) return undefined;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const target = new URL(rawUrl, window.location.origin);
      if (target.origin !== cloudOrigin) return nativeFetch(input, init);

      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.set('Authorization', `Bearer ${normalized}`);
      return nativeFetch(input, { ...init, headers });
    };
    return () => {
      window.fetch = nativeFetch;
    };
  }, [cloudOrigin, normalized, valid]);

  return (
    <>
      <aside
        style={{
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          borderBottom: '1px solid #dedede',
          background: valid ? '#eef8f0' : '#fff8e6',
          padding: '10px 18px',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <strong>Operator access</strong>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
          placeholder="Paste operator credential for this session"
          aria-label="Operator credential"
          style={{ minWidth: 320, flex: '1 1 360px', padding: 8 }}
        />
        <span style={{ fontSize: 12 }}>
          {normalized.length === 0
            ? 'Credential required for operational API calls.'
            : valid
              ? 'Credential active in memory only.'
              : 'Credential format is invalid.'}
        </span>
        {normalized ? (
          <button type="button" onClick={() => setCredential('')}>
            Clear
          </button>
        ) : null}
      </aside>
      {children}
    </>
  );
}
