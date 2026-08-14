export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 760, margin: '48px auto', padding: 24 }}>
      <h1>Event Commerce OS — Event Control</h1>
      <p>Run live operations, event configuration, inventory and device synchronization from one control surface.</p>
      <p>
        <a href="/command-centre">Open Live Event Command Centre</a>
      </p>
      <p>
        <a href="/configuration">Open Event Setup</a>
      </p>
      <p>
        <a href="/inventory">Open Inventory Operations</a>
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
