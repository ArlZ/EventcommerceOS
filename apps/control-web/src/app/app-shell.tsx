'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { OperatorSessionControl } from './operator-session-control';

type IconName = 'home' | 'pulse' | 'box' | 'device' | 'setup' | 'calendar' | 'close' | 'search';

type NavigationItem = {
  href: string;
  label: string;
  icon: IconName;
  description: string;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const navigation: NavigationGroup[] = [
  {
    label: 'Operate',
    items: [
      { href: '/', label: 'Overview', icon: 'home', description: 'Event Control home' },
      {
        href: '/command-centre',
        label: 'Live operations',
        icon: 'pulse',
        description: 'Live command centre',
      },
      { href: '/inventory', label: 'Inventory', icon: 'box', description: 'Stock and transfers' },
      { href: '/sync-health', label: 'Devices', icon: 'device', description: 'Register sync health' },
    ],
  },
  {
    label: 'Event',
    items: [
      { href: '/configuration', label: 'Setup', icon: 'setup', description: 'Event configuration' },
      { href: '/event-schedule', label: 'Schedule', icon: 'calendar', description: 'Dates and lifecycle' },
      { href: '/event-close', label: 'Close & reconcile', icon: 'close', description: 'Event close controls' },
    ],
  },
];

const allNavigationItems = navigation.flatMap((group) => group.items);

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'home') {
    return (
      <svg {...common}>
        <path d="M3 11 12 4l9 7" />
        <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
      </svg>
    );
  }
  if (name === 'pulse') {
    return (
      <svg {...common}>
        <path d="M3 12h4l2 7 4-14 2 7h6" />
      </svg>
    );
  }
  if (name === 'box') {
    return (
      <svg {...common}>
        <path d="m21 8-9-5-9 5 9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8M12 13v8" />
      </svg>
    );
  }
  if (name === 'device') {
    return (
      <svg {...common}>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M10 18h4" />
      </svg>
    );
  }
  if (name === 'setup') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  }
  if (name === 'calendar') {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </svg>
    );
  }
  if (name === 'close') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function itemIsActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState('');

  const currentItem =
    allNavigationItems.find((item) => itemIsActive(pathname, item.href)) ?? allNavigationItems[0];

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return allNavigationItems;
    return allNavigationItems.filter((item) =>
      `${item.label} ${item.description}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function navigate(href: string): void {
    setCommandOpen(false);
    setQuery('');
    router.push(href);
  }

  return (
    <div className="ec-shell">
      <aside className="ec-sidebar">
        <Link className="ec-brand" href="/" aria-label="Event Commerce OS home">
          <span className="ec-brand-mark" aria-hidden="true">
            EC
          </span>
          <span className="ec-brand-copy">
            <strong>Event Control</strong>
            <span>Event Commerce OS</span>
          </span>
        </Link>

        <nav className="ec-sidebar-nav" aria-label="Event Control navigation">
          {navigation.map((group) => (
            <div className="ec-nav-group" key={group.label}>
              <div className="ec-nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active = itemIsActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="ec-nav-item"
                    data-active={active}
                    aria-current={active ? 'page' : undefined}
                    title={item.label}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="ec-sidebar-foot">
          <div className="ec-profile-avatar" aria-hidden="true">
            EC
          </div>
          <div className="ec-profile-copy">
            <strong>Event Control</strong>
            <span>Operations console</span>
          </div>
        </div>
      </aside>

      <div className="ec-main">
        <header className="ec-commandbar">
          <div className="ec-commandbar-title">
            <span>Event Control</span>
            <strong>{currentItem?.label ?? 'Overview'}</strong>
          </div>
          <div className="ec-commandbar-actions">
            <button
              type="button"
              className="ec-command-trigger"
              onClick={() => setCommandOpen(true)}
              aria-label="Search or run command"
            >
              <Icon name="search" />
              <span>Search or navigate</span>
              <kbd>Ctrl K</kbd>
            </button>
            <OperatorSessionControl />
          </div>
        </header>
        <div className="ec-content">{children}</div>
      </div>

      {commandOpen ? (
        <div
          className="ec-command-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCommandOpen(false);
          }}
        >
          <section className="ec-command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="ec-command-input-wrap">
              <Icon name="search" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Event Control…"
                aria-label="Search Event Control"
              />
              <kbd>Esc</kbd>
            </div>
            <div className="ec-command-results">
              <div className="ec-command-group-label">Navigate</div>
              {filteredItems.length === 0 ? (
                <div className="ec-command-empty">No matching destination.</div>
              ) : (
                filteredItems.map((item) => (
                  <button
                    type="button"
                    className="ec-command-result"
                    key={item.href}
                    onClick={() => navigate(item.href)}
                  >
                    <Icon name={item.icon} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
