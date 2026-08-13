import { ConfigurationClient } from './configuration-client';

export default function ConfigurationPage() {
  return (
    <main
      style={{
        maxWidth: 1180,
        margin: '0 auto',
        padding: 32,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <p style={{ margin: 0, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' }}>
        Event Commerce OS · Control
      </p>
      <h1 style={{ marginBottom: 8 }}>Event setup</h1>
      <p style={{ maxWidth: 760, marginTop: 0 }}>
        Configure an organisation, event, operating locations, catalogue and menu before sales open.
        Orders and payments are intentionally not part of this slice.
      </p>
      <ConfigurationClient />
    </main>
  );
}
