from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing expected snippet: {label}")
    return text.replace(old, new, 1)


path = Path('apps/control-web/src/app/configuration/configuration-client.tsx')
text = path.read_text()

text = replace_once(
    text,
    "import { readEventControlContext, writeEventControlContext } from '../event-context';\nimport { priceToMinorUnits } from './pricing';\n",
    "import { readEventControlContext, writeEventControlContext } from '../event-context';\nimport { canEditEventConfiguration } from './event-configuration';\nimport { priceToMinorUnits } from './pricing';\n",
    'configuration lifecycle import',
)

text = replace_once(
    text,
    """function ItemActions({
  item,
  onRename,
  onArchive,
}: {
  item: NamedRecord;
  onRename: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
""",
    """function ItemActions({
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
""",
    'item actions disabled prop',
)

text = replace_once(
    text,
    """          <Input
            aria-label={`Rename ${item.name}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <ActionButton type="button" onClick={() => void saveRename()}>
""",
    """          <Input
            aria-label={`Rename ${item.name}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={disabled}
          />
          <ActionButton type="button" disabled={disabled} onClick={() => void saveRename()}>
""",
    'rename controls disabled',
)

text = replace_once(
    text,
    """              <ActionButton
                type="button"
                onClick={() => {
                  void onArchive().then(() => setConfirmingArchive(false));
                }}
              >
""",
    """              <ActionButton
                type="button"
                disabled={disabled}
                onClick={() => {
                  void onArchive().then(() => setConfirmingArchive(false));
                }}
              >
""",
    'archive confirmation disabled',
)

text = replace_once(
    text,
    """              <ActionButton type="button" onClick={() => setEditing(true)}>
                Rename
              </ActionButton>
              {active ? (
                <ActionButton type="button" onClick={() => setConfirmingArchive(true)}>
                  Archive
                </ActionButton>
""",
    """              <ActionButton type="button" disabled={disabled} onClick={() => setEditing(true)}>
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
""",
    'item action buttons disabled',
)

text = replace_once(
    text,
    """  const activeEvents = configuration?.events.filter((item) => item.lifecycle !== 'ARCHIVED') ?? [];
  const selectedEvent = activeEvents.find((item) => item.id === eventId);
  const currentEventLocations =
""",
    """  const activeEvents = configuration?.events.filter((item) => item.lifecycle !== 'ARCHIVED') ?? [];
  const selectedEvent = activeEvents.find((item) => item.id === eventId);
  const eventConfigurationEditable = canEditEventConfiguration(selectedEvent?.lifecycle);
  const eventConfigurationLocked = Boolean(selectedEvent && !eventConfigurationEditable);
  const currentEventLocations =
""",
    'selected event configuration guard',
)

text = replace_once(
    text,
    """          </section>

          <section className="ec-kpi-grid" aria-label="Event setup progress">
""",
    """          </section>

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
""",
    'live event read-only warning',
)

text = replace_once(
    text,
    """                    <ItemActions
                      key={item.id}
                      item={item}
                      onRename={(name) => rename(`/events/${item.id}`, name)}
                      onArchive={() => archive(`/events/${item.id}`)}
                    />
""",
    """                    <ItemActions
                      key={item.id}
                      item={item}
                      disabled={item.lifecycle !== 'DRAFT'}
                      onRename={(name) => rename(`/events/${item.id}`, name)}
                      onArchive={() => archive(`/events/${item.id}`)}
                    />
""",
    'event actions lifecycle lock',
)

text = text.replace(
    'disabled={!eventId || busy}',
    'disabled={!eventId || !eventConfigurationEditable || busy}',
)

text = replace_once(
    text,
    """                    <ItemActions
                      key={item.id}
                      item={item}
                      onRename={(name) => rename(`/sales-locations/${item.id}`, name)}
""",
    """                    <ItemActions
                      key={item.id}
                      item={item}
                      disabled={!eventConfigurationEditable}
                      onRename={(name) => rename(`/sales-locations/${item.id}`, name)}
""",
    'sales location actions lock',
)

text = replace_once(
    text,
    """                    <ItemActions
                      key={item.id}
                      item={item}
                      onRename={(name) => rename(`/inventory-locations/${item.id}`, name)}
""",
    """                    <ItemActions
                      key={item.id}
                      item={item}
                      disabled={!eventConfigurationEditable}
                      onRename={(name) => rename(`/inventory-locations/${item.id}`, name)}
""",
    'inventory location actions lock',
)

text = text.replace(
    'disabled={!menuId || busy || unassignedEventLocations.length === 0}',
    'disabled={!eventConfigurationEditable || !menuId || busy || unassignedEventLocations.length === 0}',
)

text = replace_once(
    text,
    """                <ItemActions
                  key={item.id}
                  item={item}
                  onRename={(name) => rename(`/menus/${item.id}`, name)}
""",
    """                <ItemActions
                  key={item.id}
                  item={item}
                  disabled={!eventConfigurationEditable}
                  onRename={(name) => rename(`/menus/${item.id}`, name)}
""",
    'menu actions lock',
)

text = replace_once(
    text,
    """                <select
                  value={skuId}
                  onChange={(event) => setSkuId(event.target.value)}
                  style={fieldStyle}
                >
""",
    """                <select
                  value={skuId}
                  onChange={(event) => setSkuId(event.target.value)}
                  disabled={!eventConfigurationEditable}
                  style={fieldStyle}
                >
""",
    'menu item sku selection lock',
)

text = text.replace(
    'disabled={!menuId || !skuId || busy}',
    'disabled={!eventConfigurationEditable || !menuId || !skuId || busy}',
)

text = replace_once(
    text,
    """                <select
                  value={menuItemId}
                  onChange={(event) => setMenuItemId(event.target.value)}
                  style={fieldStyle}
                >
""",
    """                <select
                  value={menuItemId}
                  onChange={(event) => setMenuItemId(event.target.value)}
                  disabled={!eventConfigurationEditable}
                  style={fieldStyle}
                >
""",
    'price menu item selection lock',
)

text = text.replace(
    'disabled={!menuItemId || busy}',
    'disabled={!eventConfigurationEditable || !menuItemId || busy}',
)

text = replace_once(
    text,
    """                <ItemActions
                  key={item.id}
                  item={{ id: item.id, name: item.displayName, lifecycle: item.lifecycle }}
                  onRename={(name) => rename(`/menu-items/${item.id}`, name, 'displayName')}
""",
    """                <ItemActions
                  key={item.id}
                  item={{ id: item.id, name: item.displayName, lifecycle: item.lifecycle }}
                  disabled={!eventConfigurationEditable}
                  onRename={(name) => rename(`/menu-items/${item.id}`, name, 'displayName')}
""",
    'menu item actions lock',
)

path.write_text(text)
