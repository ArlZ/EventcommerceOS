'use client';

import type { FormEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { EventConfigurationView } from '@event-commerce/contracts';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
type Json = Record<string, unknown>;
type NamedRecord = { id: string; name: string; lifecycle?: string };

async function api<T>(
  path: string,
  method: Method,
  actorId: string,
  organisationId?: string,
  body?: Json,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-actor-id': actorId,
      'x-role': 'ADMIN',
      ...(organisationId ? { 'x-organisation-id': organisationId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 18, background: '#fff' }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{ width: '100%', boxSizing: 'border-box', padding: 9, marginBottom: 8 }}
    />
  );
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      style={{ padding: '8px 11px', marginRight: 6, marginBottom: 6, cursor: 'pointer' }}
    />
  );
}

function ItemActions({
  item,
  onRename,
  onArchive,
}: {
  item: NamedRecord;
  onRename: () => void;
  onArchive: () => void;
}) {
  return (
    <li style={{ marginBottom: 6 }}>
      <strong>{item.name}</strong> {item.lifecycle ? <small>({item.lifecycle})</small> : null}{' '}
      <button type="button" onClick={onRename}>Rename</button>{' '}
      {item.lifecycle !== 'ARCHIVED' ? <button type="button" onClick={onArchive}>Archive</button> : null}
    </li>
  );
}

export function ConfigurationClient() {
  const actorId = useMemo(() => crypto.randomUUID(), []);
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [productId, setProductId] = useState('');
  const [skuId, setSkuId] = useState('');
  const [menuId, setMenuId] = useState('');
  const [menuItemId, setMenuItemId] = useState('');
  const [configuration, setConfiguration] = useState<EventConfigurationView | null>(null);
  const [status, setStatus] = useState('Ready');

  async function refresh(id = organisationId): Promise<void> {
    if (!id) return;
    setStatus('Loading configuration…');
    try {
      const view = await api<EventConfigurationView>(
        `/organisations/${id}/configuration`,
        'GET',
        actorId,
        id,
      );
      setConfiguration(view);
      setStatus('Configuration loaded');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Request failed');
    }
  }

  async function run(operation: () => Promise<void>): Promise<void> {
    setStatus('Saving…');
    try {
      await operation();
      setStatus('Saved');
      if (organisationId) await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Request failed');
    }
  }

  async function rename(path: string, item: NamedRecord): Promise<void> {
    const nextName = window.prompt('New name', item.name)?.trim();
    if (!nextName || nextName === item.name) return;
    await run(async () => {
      await api(path, 'PATCH', actorId, organisationId, { name: nextName });
    });
  }

  async function archive(path: string): Promise<void> {
    await run(async () => {
      await api(path, 'PATCH', actorId, organisationId, { lifecycle: 'ARCHIVED' });
    });
  }

  async function submitOrganisation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus('Creating organisation…');
    try {
      const created = await api<{ id: string }>('/organisations', 'POST', actorId, undefined, {
        name: form.get('name'),
      });
      setOrganisationId(created.id);
      setStatus('Organisation created');
      await refresh(created.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Request failed');
    }
  }

  async function submitEvent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const created = await api<{ id: string }>('/events', 'POST', actorId, organisationId, {
        organisationId,
        name: form.get('name'),
        timezone: form.get('timezone'),
        startsAt: form.get('startsAt'),
        endsAt: form.get('endsAt'),
      });
      setEventId(created.id);
    });
  }

  const currentEventLocations =
    configuration?.salesLocations.filter((location) => location.eventId === eventId) ?? [];
  const currentEventMenus = configuration?.menus.filter((menu) => menu.eventId === eventId) ?? [];

  return (
    <>
      <div style={{ background: '#f4f4f4', padding: 12, borderRadius: 8, margin: '18px 0' }}>
        <strong>{status}</strong>
        <div style={{ fontSize: 12, marginTop: 4 }}>Task 002 actor: {actorId}</div>
        {organisationId ? <div style={{ fontSize: 12 }}>Organisation: {organisationId}</div> : null}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 14,
        }}
      >
        <Panel title="1 · Organisation">
          <form onSubmit={(event) => void submitOrganisation(event)}>
            <Input name="name" placeholder="Festival Operator Ltd" required />
            <Button type="submit">Create organisation</Button>
          </form>
          {configuration ? (
            <ul>
              <ItemActions
                item={configuration.organisation}
                onRename={() => void rename(`/organisations/${configuration.organisation.id}`, configuration.organisation)}
                onArchive={() => void archive(`/organisations/${configuration.organisation.id}`)}
              />
            </ul>
          ) : null}
        </Panel>

        <Panel title="2 · Event">
          <form onSubmit={(event) => void submitEvent(event)}>
            <Input name="name" placeholder="Nairobi Live" required disabled={!organisationId} />
            <Input name="timezone" defaultValue="Africa/Nairobi" required disabled={!organisationId} />
            <Input
              name="startsAt"
              placeholder="2026-09-01T18:00:00+03:00"
              required
              disabled={!organisationId}
            />
            <Input
              name="endsAt"
              placeholder="2026-09-02T02:00:00+03:00"
              required
              disabled={!organisationId}
            />
            <Button type="submit" disabled={!organisationId}>Create event</Button>
          </form>
          <select
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            style={{ width: '100%', padding: 9, marginBottom: 8 }}
          >
            <option value="">Select event</option>
            {configuration?.events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <ul>
            {configuration?.events.map((item) => (
              <ItemActions
                key={item.id}
                item={item}
                onRename={() => void rename(`/events/${item.id}`, item)}
                onArchive={() => void archive(`/events/${item.id}`)}
              />
            ))}
          </ul>
        </Panel>

        <Panel title="3 · Sales locations">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                await api(`/events/${eventId}/sales-locations`, 'POST', actorId, organisationId, {
                  name: form.get('name'),
                  type: 'BAR',
                });
              });
            }}
          >
            <Input name="name" placeholder="Main Stage Bar" required disabled={!eventId} />
            <Button type="submit" disabled={!eventId}>Add bar</Button>
          </form>
          <ul>
            {configuration?.salesLocations.map((item) => (
              <ItemActions
                key={item.id}
                item={item}
                onRename={() => void rename(`/sales-locations/${item.id}`, item)}
                onArchive={() => void archive(`/sales-locations/${item.id}`)}
              />
            ))}
          </ul>
        </Panel>

        <Panel title="4 · Inventory locations">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                await api(`/events/${eventId}/inventory-locations`, 'POST', actorId, organisationId, {
                  name: form.get('name'),
                  type: form.get('type'),
                });
              });
            }}
          >
            <Input name="name" placeholder="Central Warehouse" required disabled={!eventId} />
            <select name="type" disabled={!eventId} style={{ width: '100%', padding: 9, marginBottom: 8 }}>
              <option value="WAREHOUSE">Warehouse</option>
              <option value="BAR_STORAGE">Bar storage</option>
            </select>
            <Button type="submit" disabled={!eventId}>Add inventory location</Button>
          </form>
          <ul>
            {configuration?.inventoryLocations.map((item) => (
              <ItemActions
                key={item.id}
                item={item}
                onRename={() => void rename(`/inventory-locations/${item.id}`, item)}
                onArchive={() => void archive(`/inventory-locations/${item.id}`)}
              />
            ))}
          </ul>
        </Panel>

        <Panel title="5 · Product & SKU">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const created = await api<{ id: string }>('/products', 'POST', actorId, organisationId, {
                  organisationId,
                  name: form.get('name'),
                  category: form.get('category'),
                });
                setProductId(created.id);
              });
            }}
          >
            <Input name="name" placeholder="Tusker" required disabled={!organisationId} />
            <Input name="category" placeholder="Beer" disabled={!organisationId} />
            <Button type="submit" disabled={!organisationId}>Create product</Button>
          </form>
          <select value={productId} onChange={(event) => setProductId(event.target.value)} style={{ width: '100%', padding: 9, marginBottom: 8 }}>
            <option value="">Select product</option>
            {configuration?.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const created = await api<{ id: string }>(`/products/${productId}/skus`, 'POST', actorId, organisationId, {
                  name: form.get('name'),
                  code: form.get('code'),
                  unitName: form.get('unitName'),
                });
                setSkuId(created.id);
              });
            }}
          >
            <Input name="name" placeholder="Tusker 500ml" required disabled={!productId} />
            <Input name="code" placeholder="TUSKER-500" required disabled={!productId} />
            <Input name="unitName" placeholder="500ml bottle" required disabled={!productId} />
            <Button type="submit" disabled={!productId}>Create SKU</Button>
          </form>
          <ul>
            {configuration?.products.map((item) => (
              <ItemActions key={item.id} item={item} onRename={() => void rename(`/products/${item.id}`, item)} onArchive={() => void archive(`/products/${item.id}`)} />
            ))}
            {configuration?.skus.map((item) => (
              <ItemActions key={item.id} item={item} onRename={() => void rename(`/skus/${item.id}`, item)} onArchive={() => void archive(`/skus/${item.id}`)} />
            ))}
          </ul>
        </Panel>

        <Panel title="6 · Menu">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const created = await api<{ id: string }>(`/events/${eventId}/menus`, 'POST', actorId, organisationId, { name: form.get('name') });
                setMenuId(created.id);
              });
            }}
          >
            <Input name="name" placeholder="Event Menu" required disabled={!eventId} />
            <Button type="submit" disabled={!eventId}>Create menu</Button>
          </form>
          <select value={menuId} onChange={(event) => setMenuId(event.target.value)} style={{ width: '100%', padding: 9, marginBottom: 8 }}>
            <option value="">Select menu</option>
            {currentEventMenus.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                await api(`/menus/${menuId}/assignments`, 'POST', actorId, organisationId, { salesLocationId: form.get('salesLocationId') });
              });
            }}
          >
            <select name="salesLocationId" disabled={!menuId} style={{ width: '100%', padding: 9, marginBottom: 8 }}>
              {currentEventLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Button type="submit" disabled={!menuId}>Assign menu to location</Button>
          </form>
          <ul>
            {configuration?.menus.map((item) => (
              <ItemActions key={item.id} item={item} onRename={() => void rename(`/menus/${item.id}`, item)} onArchive={() => void archive(`/menus/${item.id}`)} />
            ))}
          </ul>
        </Panel>

        <Panel title="7 · Menu item & price">
          <select value={skuId} onChange={(event) => setSkuId(event.target.value)} style={{ width: '100%', padding: 9, marginBottom: 8 }}>
            <option value="">Select SKU</option>
            {configuration?.skus.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const created = await api<{ id: string }>(`/menus/${menuId}/items`, 'POST', actorId, organisationId, {
                  skuId,
                  displayName: form.get('displayName'),
                  sortOrder: 10,
                });
                setMenuItemId(created.id);
              });
            }}
          >
            <Input name="displayName" placeholder="Tusker 500ml" required disabled={!menuId || !skuId} />
            <Button type="submit" disabled={!menuId || !skuId}>Add menu item</Button>
          </form>
          <select value={menuItemId} onChange={(event) => setMenuItemId(event.target.value)} style={{ width: '100%', padding: 9, marginBottom: 8 }}>
            <option value="">Select menu item</option>
            {configuration?.menuItems.filter((item) => !menuId || item.menuId === menuId).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
          </select>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const salesLocationId = String(form.get('salesLocationId') ?? '');
              void run(async () => {
                await api(`/menu-items/${menuItemId}/prices`, 'PUT', actorId, organisationId, {
                  salesLocationId: salesLocationId || null,
                  amountMinor: Number(form.get('amountMinor')),
                  currency: form.get('currency'),
                });
              });
            }}
          >
            <Input name="amountMinor" type="number" step="1" min="0" placeholder="25000" required disabled={!menuItemId} />
            <Input name="currency" defaultValue="KES" maxLength={3} required disabled={!menuItemId} />
            <select name="salesLocationId" disabled={!menuItemId} style={{ width: '100%', padding: 9, marginBottom: 8 }}>
              <option value="">Default menu price</option>
              {currentEventLocations.map((item) => <option key={item.id} value={item.id}>{item.name} override</option>)}
            </select>
            <Button type="submit" disabled={!menuItemId}>Set price</Button>
          </form>
          <ul>
            {configuration?.menuItems.map((item) => (
              <ItemActions key={item.id} item={{ id: item.id, name: item.displayName, lifecycle: item.lifecycle }} onRename={() => void rename(`/menu-items/${item.id}`, { id: item.id, name: item.displayName, lifecycle: item.lifecycle })} onArchive={() => void archive(`/menu-items/${item.id}`)} />
            ))}
          </ul>
        </Panel>
      </div>

      {configuration ? (
        <section style={{ marginTop: 24 }}>
          <h2>Current configuration</h2>
          <p>
            {configuration.events.length} events · {configuration.salesLocations.length} sales locations ·{' '}
            {configuration.inventoryLocations.length} inventory locations · {configuration.skus.length} SKUs ·{' '}
            {configuration.menus.length} menus
          </p>
          <pre style={{ background: '#111', color: '#eee', padding: 16, borderRadius: 10, overflowX: 'auto', fontSize: 12 }}>
            {JSON.stringify(configuration, null, 2)}
          </pre>
        </section>
      ) : null}
    </>
  );
}
