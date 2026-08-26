'use client';

import type { FormEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { EventConfigurationView } from '@event-commerce/contracts';
import {
  eventControlContextChangedEvent,
  readEventControlContext,
  writeEventControlContext,
} from '../event-context';
import { canEditEventConfiguration } from './event-configuration';
import { priceToMinorUnits } from './pricing';

const apiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
type Json = Record<string, unknown>;
type NamedRecord = { id: string; name: string; lifecycle?: string };

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 10px',
};

const formStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
};

async function api<T>(
  path: string,
  method: Method,
  organisationId?: string,
  body?: Json,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-event-control-request': 'browser',
      ...(organisationId ? { 'x-organisation-id': organisationId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function StepPanel({
  number,
  title,
  description,
  complete,
  children,
}: {
  number: number;
  title: string;
  description: string;
  complete: boolean;
  children: ReactNode;
}) {
  return (
    <section className="ec-panel">
      <div className="ec-panel-heading">
        <div>
          <p className="ec-eyebrow">Step {number}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="ec-status-pill" data-tone={complete ? 'success' : 'warning'}>
          {complete ? 'Ready' : 'Needs setup'}
        </span>
      </div>
      {children}
    </section>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...fieldStyle, ...props.style }} />;
}

function ActionButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} style={{ padding: '9px 12px', ...props.style }} />;
}

function ItemActions({
  item,
  onRename,
  onArchive,
  disabled = false,
}: {
  item: NamedRecord;
  onRename: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const active = item.lifecycle !== 'ARCHIVED';

  async function saveRename(): Promise<void> {
    const nextName = name.trim();
    if (!nextName || nextName === item.name) {
      setName(item.name);
      setEditing(false);
      return;
    }
    await onRename(nextName);
    setEditing(false);
  }

  return (
    <div className="ec-list-row">
      {editing ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
          <Input
            aria-label={`Rename ${item.name}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={disabled}
          />
          <ActionButton type="button" disabled={disabled} onClick={() => void saveRename()}>
            Save
          </ActionButton>
          <ActionButton
            type="button"
            onClick={() => {
              setName(item.name);
              setEditing(false);
            }}
          >
            Cancel
          </ActionButton>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <strong>{item.name}</strong>
            {item.lifecycle ? <div className="ec-alert-meta">{item.lifecycle}</div> : null}
          </div>
          {confirmingArchive ? (
            <div className="ec-inline-confirm" role="group" aria-label={`Archive ${item.name}`}>
              <span>Archive this item?</span>
              <ActionButton
                type="button"
                disabled={disabled}
                onClick={() => {
                  void onArchive().then(() => setConfirmingArchive(false));
                }}
              >
                Confirm archive
              </ActionButton>
              <ActionButton type="button" onClick={() => setConfirmingArchive(false)}>
                Keep active
              </ActionButton>
            </div>
          ) : (
            <div className="ec-alert-actions" style={{ marginTop: 0 }}>
              <ActionButton type="button" disabled={disabled} onClick={() => setEditing(true)}>
                Rename
              </ActionButton>
              {active ? (
                <ActionButton
                  type="button"
                  disabled={disabled}
                  onClick={() => setConfirmingArchive(true)}
                >
                  Archive
                </ActionButton>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ConfigurationClient() {
  const [organisationId, setOrganisationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [productId, setProductId] = useState('');
  const [skuId, setSkuId] = useState('');
  const [menuId, setMenuId] = useState('');
  const [menuItemId, setMenuItemId] = useState('');
  const [configuration, setConfiguration] = useState<EventConfigurationView | null>(null);
  const [status, setStatus] = useState('Start by creating or loading the event organisation.');
  const [contextHydrated, setContextHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusTone, setStatusTone] = useState<'success' | 'warning' | 'danger'>('warning');

  useEffect(() => {
    const syncContext = () => {
      const context = readEventControlContext();
      setOrganisationId(context.organisationId ?? '');
      setEventId(context.eventId ?? '');
      setMenuId('');
      setMenuItemId('');
      setConfiguration(null);
      setStatusTone('warning');
      setStatus(
        context.organisationId
          ? 'Loading the selected organisation…'
          : 'Select an organisation from Event Control.',
      );
      setContextHydrated(true);
    };

    syncContext();
    window.addEventListener(eventControlContextChangedEvent, syncContext);
    return () => window.removeEventListener(eventControlContextChangedEvent, syncContext);
  }, []);

  useEffect(() => {
    if (!contextHydrated || !organisationId.trim()) return;
    void refresh(organisationId);
  }, [contextHydrated, organisationId, eventId]);

  async function refresh(id = organisationId): Promise<void> {
    if (!id) return;
    setBusy(true);
    setStatus('Loading event setup…');
    setStatusTone('warning');
    try {
      const view = await api<EventConfigurationView>(
        `/organisations/${id}/configuration`,
        'GET',
        id,
      );
      setConfiguration(view);
      const currentEvent = view.events.find(
        (item) => item.id === eventId && item.lifecycle !== 'ARCHIVED',
      );
      const nextEvent =
        currentEvent ??
        view.events.find((item) => item.lifecycle === 'DRAFT') ??
        view.events.find((item) => item.lifecycle !== 'ARCHIVED') ??
        null;
      setEventId(nextEvent?.id ?? '');
      const context = readEventControlContext();
      if (
        context.organisationId !== id ||
        context.organisationName !== view.organisation.name ||
        context.eventId !== (nextEvent?.id ?? undefined) ||
        context.eventName !== (nextEvent?.name ?? undefined)
      ) {
        writeEventControlContext({
          organisationId: id,
          organisationName: view.organisation.name,
          eventId: nextEvent?.id ?? null,
          eventName: nextEvent?.name ?? null,
        });
      }
      setStatus(`Loaded ${view.organisation.name}. Continue with the next incomplete step.`);
      setStatusTone('success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load event setup');
      setStatusTone('danger');
    } finally {
      setBusy(false);
    }
  }

  async function run(operation: () => Promise<void>, successMessage = 'Saved'): Promise<void> {
    setBusy(true);
    setStatus('Saving…');
    setStatusTone('warning');
    try {
      await operation();
      if (organisationId) await refresh();
      setStatus(successMessage);
      setStatusTone('success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save this change');
      setStatusTone('danger');
    } finally {
      setBusy(false);
    }
  }

  async function rename(
    path: string,
    nextName: string,
    field: 'name' | 'displayName' = 'name',
  ): Promise<void> {
    await run(async () => {
      await api(path, 'PATCH', organisationId, { [field]: nextName });
    }, 'Name updated');
  }

  async function archive(path: string): Promise<void> {
    await run(async () => {
      await api(path, 'PATCH', organisationId, { lifecycle: 'ARCHIVED' });
    }, 'Item archived');
  }

  async function submitOrganisation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setStatus('Creating organisation…');
    try {
      const created = await api<{ id: string }>('/organisations', 'POST', undefined, {
        name: form.get('name'),
      });
      setOrganisationId(created.id);
      await refresh(created.id);
      setStatus('Organisation created. Now create the event.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create organisation');
      setStatusTone('danger');
    } finally {
      setBusy(false);
    }
  }

  async function submitEvent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const created = await api<{ id: string }>('/events', 'POST', organisationId, {
        organisationId,
        name: form.get('name'),
        timezone: form.get('timezone'),
        startsAt: form.get('startsAt'),
        endsAt: form.get('endsAt'),
      });
      setEventId(created.id);
      writeEventControlContext({
        organisationId,
        organisationName: configuration?.organisation.name ?? null,
        eventId: created.id,
        eventName: String(form.get('name') ?? ''),
      });
    }, 'Event created. Add the places where guests will buy and stock will be held.');
  }

  const activeEvents = configuration?.events.filter((item) => item.lifecycle !== 'ARCHIVED') ?? [];
  const selectedEvent = activeEvents.find((item) => item.id === eventId);
  const eventConfigurationEditable = canEditEventConfiguration(selectedEvent?.lifecycle);
  const eventConfigurationLocked = Boolean(selectedEvent && !eventConfigurationEditable);
  const currentEventLocations =
    configuration?.salesLocations.filter(
      (location) => location.eventId === eventId && location.lifecycle !== 'ARCHIVED',
    ) ?? [];
  const currentEventInventoryLocations =
    configuration?.inventoryLocations.filter(
      (location) => location.eventId === eventId && location.lifecycle !== 'ARCHIVED',
    ) ?? [];
  const activeProducts =
    configuration?.products.filter((item) => item.lifecycle !== 'ARCHIVED') ?? [];
  const activeSkus = configuration?.skus.filter((item) => item.lifecycle !== 'ARCHIVED') ?? [];
  const currentEventMenus =
    configuration?.menus.filter(
      (menu) => menu.eventId === eventId && menu.lifecycle !== 'ARCHIVED',
    ) ?? [];
  const currentMenuItems = menuId
    ? (configuration?.menuItems.filter(
        (item) => item.menuId === menuId && item.lifecycle !== 'ARCHIVED',
      ) ?? [])
    : [];
  const currentMenuAssignments = menuId
    ? (configuration?.menuAssignments.filter(
        (assignment) =>
          assignment.menuId === menuId &&
          currentEventLocations.some((location) => location.id === assignment.salesLocationId),
      ) ?? [])
    : [];
  const currentMenuPrices =
    configuration?.menuItemPrices.filter((price) =>
      currentMenuItems.some((item) => item.id === price.menuItemId),
    ) ?? [];
  const assignedSalesLocationIds = new Set(
    currentMenuAssignments.map((assignment) => assignment.salesLocationId),
  );
  const unassignedEventLocations = currentEventLocations.filter(
    (location) => !assignedSalesLocationIds.has(location.id),
  );
  const allMenuItemsPriced =
    currentMenuItems.length > 0 &&
    currentMenuItems.every((item) => {
      const prices = currentMenuPrices.filter((price) => price.menuItemId === item.id);
      if (prices.some((price) => price.salesLocationId === null)) return true;
      return (
        assignedSalesLocationIds.size > 0 &&
        [...assignedSalesLocationIds].every((locationId) =>
          prices.some((price) => price.salesLocationId === locationId),
        )
      );
    });

  const organisationReady = Boolean(
    configuration && configuration.organisation.lifecycle !== 'ARCHIVED',
  );
  const eventReady = Boolean(selectedEvent && selectedEvent.lifecycle !== 'CLOSED');
  const locationsReady = currentEventLocations.length > 0;
  const inventoryReady = currentEventInventoryLocations.length > 0;
  const catalogueReady = activeSkus.length > 0;
  const menuAssigned = Boolean(menuId) && currentMenuAssignments.length > 0;
  const menuReady = menuAssigned && allMenuItemsPriced;
  const coreSetupReady =
    organisationReady &&
    eventReady &&
    locationsReady &&
    inventoryReady &&
    catalogueReady &&
    menuReady;

  return (
    <div className="ec-operations-stack" style={{ marginTop: 18 }} aria-busy={busy}>
      <section className={`ec-banner ec-banner--${statusTone}`} aria-live="polite">
        <strong>{busy ? 'Working…' : 'Setup status'}</strong> • {status}
      </section>

      {!configuration ? (
        <section className="ec-panel ec-panel--priority">
          <div className="ec-panel-heading">
            <div>
              <h2>Open an organisation</h2>
              <p>
                Select an organisation through the authenticated Event Control context, or create a
                new pilot operator if your account has platform administration rights.
              </p>
            </div>
          </div>
          <div className="ec-control-grid">
            <form style={formStyle} onSubmit={(event) => void submitOrganisation(event)}>
              <Input name="name" placeholder="Organisation name" required disabled={busy} />
              <ActionButton className="ec-button-primary" type="submit" disabled={busy}>
                Create organisation
              </ActionButton>
            </form>

          </div>
        </section>
      ) : null}

      {configuration ? (
        <>
          <section className="ec-context-bar">
            <div>
              <strong>{configuration.organisation.name}</strong>
              {eventId
                ? ` • ${configuration.events.find((item) => item.id === eventId)?.name ?? 'Event selected'}`
                : ''}
            </div>
            <span className="ec-status-pill" data-tone={coreSetupReady ? 'success' : 'warning'}>
              {coreSetupReady ? 'Core setup ready' : 'Setup in progress'}
            </span>
          </section>

          {eventConfigurationLocked ? (
            <section className="ec-banner ec-banner--warning">
              <strong>{selectedEvent?.lifecycle} event setup is read only.</strong> This pilot does
              not publish live Cloud configuration changes to venue Edge or POS devices. Select or
              create a DRAFT event to change locations, menus, assignments, menu items or prices.
              Organisation-level products and sellable units remain available for future event
              setup.
            </section>
          ) : null}

          <section className="ec-kpi-grid" aria-label="Event setup progress">
            <SetupMetric label="Events" value={activeEvents.length} />
            <SetupMetric label="Sales locations" value={currentEventLocations.length} />
            <SetupMetric
              label="Inventory locations"
              value={currentEventInventoryLocations.length}
            />
            <SetupMetric label="SKUs" value={activeSkus.length} />
            <SetupMetric label="Menus" value={currentEventMenus.length} />
          </section>

          <StepPanel
            number={1}
            title="Organisation"
            description="Confirm who owns and operates this event configuration."
            complete={organisationReady}
          >
            <div className="ec-list">
              <ItemActions
                item={configuration.organisation}
                onRename={(name) => rename(`/organisations/${configuration.organisation.id}`, name)}
                onArchive={() => archive(`/organisations/${configuration.organisation.id}`)}
              />
            </div>
          </StepPanel>

          <StepPanel
            number={2}
            title="Event"
            description="Create or select the event that the registers and bars will trade against."
            complete={eventReady}
          >
            <div className="ec-control-grid">
              <form style={formStyle} onSubmit={(event) => void submitEvent(event)}>
                <Input name="name" placeholder="Event name" required disabled={busy} />
                <Input name="timezone" defaultValue="Africa/Nairobi" required disabled={busy} />
                <Input
                  name="startsAt"
                  placeholder="Start time, e.g. 2026-09-01T18:00:00+03:00"
                  required
                  disabled={busy}
                />
                <Input
                  name="endsAt"
                  placeholder="End time, e.g. 2026-09-02T02:00:00+03:00"
                  required
                  disabled={busy}
                />
                <ActionButton className="ec-button-primary" type="submit" disabled={busy}>
                  Create event
                </ActionButton>
              </form>

              <div style={formStyle}>
                <label htmlFor="event-select">
                  <strong>Event to configure</strong>
                </label>
                <select
                  id="event-select"
                  value={eventId}
                  onChange={(event) => {
                    const nextEventId = event.target.value;
                    const nextEvent = activeEvents.find((item) => item.id === nextEventId) ?? null;
                    setEventId(nextEventId);
                    setMenuId('');
                    setMenuItemId('');
                    writeEventControlContext({
                      organisationId,
                      organisationName: configuration.organisation.name,
                      eventId: nextEvent?.id ?? null,
                      eventName: nextEvent?.name ?? null,
                    });
                  }}
                  style={fieldStyle}
                >
                  <option value="">Select event</option>
                  {activeEvents.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <div className="ec-list">
                  {activeEvents.map((item) => (
                    <ItemActions
                      key={item.id}
                      item={item}
                      disabled={item.lifecycle !== 'DRAFT'}
                      onRename={(name) => rename(`/events/${item.id}`, name)}
                      onArchive={() => archive(`/events/${item.id}`)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </StepPanel>

          <StepPanel
            number={3}
            title="Trading & stock locations"
            description="Add guest-facing bars and the places from which stock will be controlled."
            complete={locationsReady && inventoryReady}
          >
            {!eventId ? (
              <div className="ec-banner ec-banner--warning">
                Select an event before adding locations.
              </div>
            ) : null}
            <div className="ec-control-grid" style={{ marginTop: 10 }}>
              <div>
                <h3>Sales locations</h3>
                <form
                  style={formStyle}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void run(async () => {
                      await api(
                        `/events/${eventId}/sales-locations`,
                        'POST', organisationId,
                        {
                          name: form.get('name'),
                          type: 'BAR',
                        },
                      );
                    }, 'Sales location added');
                  }}
                >
                  <Input
                    name="name"
                    placeholder="Main Stage Bar"
                    required
                    disabled={!eventId || !eventConfigurationEditable || busy}
                  />
                  <ActionButton
                    type="submit"
                    disabled={!eventId || !eventConfigurationEditable || busy}
                  >
                    Add sales location
                  </ActionButton>
                </form>
                <div className="ec-list" style={{ marginTop: 10 }}>
                  {currentEventLocations.map((item) => (
                    <ItemActions
                      key={item.id}
                      item={item}
                      disabled={!eventConfigurationEditable}
                      onRename={(name) => rename(`/sales-locations/${item.id}`, name)}
                      onArchive={() => archive(`/sales-locations/${item.id}`)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <h3>Inventory locations</h3>
                <form
                  style={formStyle}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void run(async () => {
                      await api(
                        `/events/${eventId}/inventory-locations`,
                        'POST', organisationId,
                        { name: form.get('name'), type: form.get('type') },
                      );
                    }, 'Inventory location added');
                  }}
                >
                  <Input
                    name="name"
                    placeholder="Central Warehouse"
                    required
                    disabled={!eventId || !eventConfigurationEditable || busy}
                  />
                  <select
                    name="type"
                    disabled={!eventId || !eventConfigurationEditable || busy}
                    style={fieldStyle}
                  >
                    <option value="WAREHOUSE">Warehouse</option>
                    <option value="BAR_STORAGE">Bar storage</option>
                  </select>
                  <ActionButton
                    type="submit"
                    disabled={!eventId || !eventConfigurationEditable || busy}
                  >
                    Add inventory location
                  </ActionButton>
                </form>
                <div className="ec-list" style={{ marginTop: 10 }}>
                  {currentEventInventoryLocations.map((item) => (
                    <ItemActions
                      key={item.id}
                      item={item}
                      disabled={!eventConfigurationEditable}
                      onRename={(name) => rename(`/inventory-locations/${item.id}`, name)}
                      onArchive={() => archive(`/inventory-locations/${item.id}`)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </StepPanel>

          <StepPanel
            number={4}
            title="Products & sellable units"
            description="Create the catalogue the bartender will recognise on the register."
            complete={catalogueReady}
          >
            <div className="ec-control-grid">
              <form
                style={formStyle}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    const created = await api<{ id: string }>(
                      '/products',
                      'POST', organisationId,
                      {
                        organisationId,
                        name: form.get('name'),
                        category: form.get('category'),
                      },
                    );
                    setProductId(created.id);
                  }, 'Product created. Add the sellable unit next.');
                }}
              >
                <h3>Create product</h3>
                <Input name="name" placeholder="Tusker" required disabled={busy} />
                <Input name="category" placeholder="Beer" disabled={busy} />
                <ActionButton type="submit" disabled={busy}>
                  Create product
                </ActionButton>
              </form>

              <form
                style={formStyle}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    const created = await api<{ id: string }>(
                      `/products/${productId}/skus`,
                      'POST', organisationId,
                      {
                        name: form.get('name'),
                        code: form.get('code'),
                        unitName: form.get('unitName'),
                      },
                    );
                    setSkuId(created.id);
                  }, 'Sellable unit created');
                }}
              >
                <h3>Add sellable unit</h3>
                <select
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                  style={fieldStyle}
                >
                  <option value="">Select product</option>
                  {activeProducts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <Input
                  name="name"
                  placeholder="Tusker 500ml"
                  required
                  disabled={!productId || busy}
                />
                <Input
                  name="code"
                  placeholder="TUSKER-500"
                  required
                  disabled={!productId || busy}
                />
                <Input
                  name="unitName"
                  placeholder="500ml bottle"
                  required
                  disabled={!productId || busy}
                />
                <ActionButton type="submit" disabled={!productId || busy}>
                  Add sellable unit
                </ActionButton>
              </form>
            </div>

            <div className="ec-control-grid" style={{ marginTop: 12 }}>
              <div>
                <h3>Products</h3>
                <div className="ec-list">
                  {activeProducts.map((item) => (
                    <ItemActions
                      key={item.id}
                      item={item}
                      onRename={(name) => rename(`/products/${item.id}`, name)}
                      onArchive={() => archive(`/products/${item.id}`)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <h3>Sellable units</h3>
                <div className="ec-list">
                  {activeSkus.map((item) => (
                    <ItemActions
                      key={item.id}
                      item={item}
                      onRename={(name) => rename(`/skus/${item.id}`, name)}
                      onArchive={() => archive(`/skus/${item.id}`)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </StepPanel>

          <StepPanel
            number={5}
            title="Menu & bar assignment"
            description="Create the event menu and choose where it will be available."
            complete={menuAssigned}
          >
            {!eventId ? (
              <div className="ec-banner ec-banner--warning">
                Select an event before creating its menu.
              </div>
            ) : null}
            <div className="ec-control-grid" style={{ marginTop: 10 }}>
              <form
                style={formStyle}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    const created = await api<{ id: string }>(
                      `/events/${eventId}/menus`,
                      'POST', organisationId,
                      { name: form.get('name') },
                    );
                    setMenuId(created.id);
                  }, 'Menu created');
                }}
              >
                <h3>Create menu</h3>
                <Input
                  name="name"
                  placeholder="Event Menu"
                  required
                  disabled={!eventId || !eventConfigurationEditable || busy}
                />
                <ActionButton
                  type="submit"
                  disabled={!eventId || !eventConfigurationEditable || busy}
                >
                  Create menu
                </ActionButton>
                <select
                  value={menuId}
                  onChange={(event) => setMenuId(event.target.value)}
                  style={fieldStyle}
                >
                  <option value="">Select menu</option>
                  {currentEventMenus.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </form>

              <form
                style={formStyle}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    await api(`/menus/${menuId}/assignments`, 'POST', organisationId, {
                      salesLocationId: form.get('salesLocationId'),
                    });
                  }, 'Menu assigned to sales location');
                }}
              >
                <h3>Assign menu</h3>
                <select
                  name="salesLocationId"
                  required
                  disabled={
                    !eventConfigurationEditable ||
                    !menuId ||
                    busy ||
                    unassignedEventLocations.length === 0
                  }
                  style={fieldStyle}
                >
                  <option value="">
                    {unassignedEventLocations.length === 0
                      ? 'All active sales locations already assigned'
                      : 'Select sales location'}
                  </option>
                  {unassignedEventLocations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ActionButton
                  type="submit"
                  disabled={
                    !eventConfigurationEditable ||
                    !menuId ||
                    busy ||
                    unassignedEventLocations.length === 0
                  }
                >
                  Assign menu to location
                </ActionButton>
              </form>
            </div>
            <div className="ec-list" style={{ marginTop: 12 }}>
              {currentEventMenus.map((item) => (
                <ItemActions
                  key={item.id}
                  item={item}
                  disabled={!eventConfigurationEditable}
                  onRename={(name) => rename(`/menus/${item.id}`, name)}
                  onArchive={() => archive(`/menus/${item.id}`)}
                />
              ))}
            </div>
          </StepPanel>

          <StepPanel
            number={6}
            title="Menu items & prices"
            description="Choose what appears on the register and record the price used for trading."
            complete={menuReady}
          >
            <div className="ec-control-grid">
              <form
                style={formStyle}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    const created = await api<{ id: string }>(
                      `/menus/${menuId}/items`,
                      'POST', organisationId,
                      { skuId, displayName: form.get('displayName'), sortOrder: 10 },
                    );
                    setMenuItemId(created.id);
                  }, 'Item added to menu');
                }}
              >
                <h3>Add item to menu</h3>
                <select
                  value={skuId}
                  onChange={(event) => setSkuId(event.target.value)}
                  disabled={!eventConfigurationEditable}
                  style={fieldStyle}
                >
                  <option value="">Select sellable unit</option>
                  {activeSkus.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <Input
                  name="displayName"
                  placeholder="Name shown on register"
                  required
                  disabled={!eventConfigurationEditable || !menuId || !skuId || busy}
                />
                <ActionButton
                  type="submit"
                  disabled={!eventConfigurationEditable || !menuId || !skuId || busy}
                >
                  Add to menu
                </ActionButton>
              </form>

              <form
                style={formStyle}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const salesLocationId = String(form.get('salesLocationId') ?? '');
                  const currency = String(form.get('currency') ?? '')
                    .trim()
                    .toUpperCase();
                  const displayAmount = String(form.get('amount') ?? '').trim();
                  void run(async () => {
                    await api(`/menu-items/${menuItemId}/prices`, 'PUT', organisationId, {
                      salesLocationId: salesLocationId || null,
                      amountMinor: priceToMinorUnits(displayAmount, currency),
                      currency,
                    });
                  }, 'Price saved');
                }}
              >
                <h3>Set price</h3>
                <select
                  value={menuItemId}
                  onChange={(event) => setMenuItemId(event.target.value)}
                  disabled={!eventConfigurationEditable}
                  style={fieldStyle}
                >
                  <option value="">Select menu item</option>
                  {currentMenuItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
                <label>
                  <strong>Price</strong>
                  <Input
                    name="amount"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    placeholder="250"
                    required
                    disabled={!eventConfigurationEditable || !menuItemId || busy}
                  />
                  <small className="ec-alert-meta">
                    Enter the amount guests see. Event Control converts it to integer minor units
                    before saving.
                  </small>
                </label>
                <label>
                  <strong>Currency</strong>
                  <Input
                    name="currency"
                    defaultValue="KES"
                    minLength={3}
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    required
                    disabled={!eventConfigurationEditable || !menuItemId || busy}
                  />
                </label>
                <select
                  name="salesLocationId"
                  disabled={!eventConfigurationEditable || !menuItemId || busy}
                  style={fieldStyle}
                >
                  <option value="">Default menu price</option>
                  {currentEventLocations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} override
                    </option>
                  ))}
                </select>
                <ActionButton
                  type="submit"
                  disabled={!eventConfigurationEditable || !menuItemId || busy}
                >
                  Save price
                </ActionButton>
              </form>
            </div>

            <div className="ec-list" style={{ marginTop: 12 }}>
              {currentMenuItems.map((item) => (
                <ItemActions
                  key={item.id}
                  item={{ id: item.id, name: item.displayName, lifecycle: item.lifecycle }}
                  disabled={!eventConfigurationEditable}
                  onRename={(name) => rename(`/menu-items/${item.id}`, name, 'displayName')}
                  onArchive={() => archive(`/menu-items/${item.id}`)}
                />
              ))}
            </div>
          </StepPanel>

          <section className={`ec-banner ec-banner--${coreSetupReady ? 'success' : 'warning'}`}>
            <strong>
              {coreSetupReady
                ? 'Core event setup is ready for pre-open checks.'
                : 'Setup is not complete yet.'}
            </strong>
            <br />
            Device provisioning, opening stock and the pilot pre-open rehearsal remain separate
            operational gates before trading begins.
          </section>
        </>
      ) : null}
    </div>
  );
}

function SetupMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="ec-kpi">
      <span className="ec-kpi-label">{label}</span>
      <strong className="ec-kpi-value">{value}</strong>
    </div>
  );
}
