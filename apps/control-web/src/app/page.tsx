import Link from 'next/link';

const liveOperations = [
  {
    href: '/command-centre',
    title: 'Live event command centre',
    description: 'See exceptions, sales velocity, payment health, stock risk and device status.',
    action: 'Monitor live event',
  },
  {
    href: '/inventory',
    title: 'Inventory operations',
    description: 'Watch stock risk and coordinate replenishment without interrupting selling.',
    action: 'Open inventory',
  },
  {
    href: '/sync-health',
    title: 'Device & sync health',
    description: 'Find offline or delayed devices and understand recovery state at a glance.',
    action: 'Check devices',
  },
];

const eventLifecycle = [
  {
    href: '/configuration',
    title: 'Prepare an event',
    description: 'Set up the event, locations, catalogue, menus and operating configuration.',
    action: 'Open event setup',
  },
  {
    href: '/readiness',
    title: 'Check pilot readiness',
    description: 'Turn the selected event configuration into an explicit preflight before field testing.',
    action: 'Run preflight',
  },
  {
    href: '/event-close',
    title: 'Close & reconcile',
    description: 'Review payment, stock and close evidence before finalising the event.',
    action: 'Open event close',
  },
];

export default function HomePage() {
  return (
    <main className="ec-page">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">Pilot control surface</p>
          <h1 className="ec-page-title">Run the event without losing control.</h1>
          <p className="ec-page-description">
            Keep selling, surface exceptions early and protect payment truth. Start with the job you
            need now.
          </p>
        </div>
        <span className="ec-status-pill" data-tone="warning">
          Controlled pilot
        </span>
      </header>

      <section className="ec-section" aria-labelledby="live-operations-heading">
        <p className="ec-eyebrow">During trading</p>
        <h2 className="ec-section-heading" id="live-operations-heading">
          Live operations
        </h2>
        <TaskCards items={liveOperations} />
      </section>

      <section className="ec-section" aria-labelledby="event-lifecycle-heading">
        <p className="ec-eyebrow">Before & after trading</p>
        <h2 className="ec-section-heading" id="event-lifecycle-heading">
          Event lifecycle
        </h2>
        <TaskCards items={eventLifecycle} />
      </section>

      <section className="ec-section">
        <div className="ec-callout">
          <strong>Operational rule:</strong> Event Control may lag during connectivity loss.
          <br />
          Android POS stays local-first and preserves committed sales independently.
        </div>
      </section>
    </main>
  );
}

function TaskCards({ items }: { items: typeof liveOperations }) {
  return (
    <div className="ec-card-grid">
      {items.map((item) => (
        <Link key={item.href} className="ec-nav-card" href={item.href}>
          <div>
            <strong>{item.title}</strong>
            <p>{item.description}</p>
          </div>
          <div className="ec-nav-card-footer">
            <span>{item.action}</span>
            <span aria-hidden="true">→</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
