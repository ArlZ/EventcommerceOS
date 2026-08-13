export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 760, margin: '48px auto', padding: 24 }}>
      <h1>Event Commerce OS — Event Control</h1>
      <p>Event configuration is available for the Task 002 administrative workflow.</p>
      <p>
        <a href="/configuration">Open Event Setup</a>
      </p>
      <p>
        Health endpoint: <code>/api/health</code>
      </p>
    </main>
  );
}
