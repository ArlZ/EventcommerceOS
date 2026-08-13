export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 760, margin: '48px auto', padding: 24 }}>
      <h1>Event Commerce OS — Event Control</h1>
      <p>Event configuration and device synchronization health are available.</p>
      <p>
        <a href="/configuration">Open Event Setup</a>
      </p>
      <p>
        <a href="/sync-health">Open Device Sync Health</a>
      </p>
      <p>
        Health endpoint: <code>/api/health</code>
      </p>
    </main>
  );
}
