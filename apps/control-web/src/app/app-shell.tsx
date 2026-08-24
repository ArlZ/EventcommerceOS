import Link from 'next/link';
import type { ReactNode } from 'react';
import { OperatorSessionControl } from './operator-session-control';

const navigation = [
  { href: '/command-centre', label: 'Live' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/sync-health', label: 'Devices' },
  { href: '/configuration', label: 'Setup' },
  { href: '/event-schedule', label: 'Schedule' },
  { href: '/event-close', label: 'Close' },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="ec-shell">
      <header className="ec-topbar">
        <Link className="ec-brand" href="/" aria-label="Event Commerce OS home">
          <span className="ec-brand-mark" aria-hidden="true">
            EC
          </span>
          <span className="ec-brand-copy">
            <strong>Event Commerce OS</strong>
            <span>Event Control</span>
          </span>
        </Link>
        <nav className="ec-nav" aria-label="Event Control">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <OperatorSessionControl />
      <div className="ec-content">{children}</div>
    </div>
  );
}
