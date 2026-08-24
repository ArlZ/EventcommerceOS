from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing expected snippet: {label}")
    return text.replace(old, new, 1)


# Inventory page: frame this as read-only operating guidance, not a Cloud control surface.
path = Path('apps/control-web/src/app/inventory/page.tsx')
text = path.read_text()
text = replace_once(
    text,
    "    detail: 'Use replenishment guidance without bypassing transfer controls.',",
    "    detail: 'Follow the recommended physical move, then record it through venue transfer controls.',",
    'inventory workflow move guidance',
)
text = replace_once(
    text,
    '            Keep the highest stockout risks visible while the team coordinates replenishment.\n',
    '            See what is at risk, what to move, and what is still in transit while the venue keeps selling locally.\n',
    'inventory page description',
)
text = replace_once(
    text,
    '        <span className="ec-status-pill">Cloud view</span>\n',
    '        <span className="ec-status-pill">Read-only guidance</span>\n',
    'inventory page status',
)
path.write_text(text)


# Inventory client: make the physical recommendation primary and diagnostics secondary.
path = Path('apps/control-web/src/app/inventory/inventory-operations-client.tsx')
text = path.read_text()
text = replace_once(
    text,
    "          <strong>Start with the event.</strong> Active stock risks and transfers will appear before\n          the location-by-location ledger projection. If you already selected this event elsewhere\n",
    "          <strong>Start with the event.</strong> Active stock risks and transfers will appear before\n          the location-by-location stock view. If you already selected this event elsewhere\n",
    'inventory empty guidance',
)
text = replace_once(
    text,
    "                  Highest severity and lowest cover appear first. A suggestion is guidance, not an\n                  inventory movement until the transfer workflow records it.\n",
    "                  Highest severity and lowest cover appear first. Recommended moves are guidance\n                  only; stock changes only when the venue transfer workflow records them.\n",
    'inventory risk panel guidance',
)

old_cards = '''            <div className="ec-action-list">
              {activeAlerts.map((alert) => {
                const suggestedTransfer =
                  alert.suggestedTransferQuantityBase &&
                  alert.suggestedTransferQuantityBase !== '0';
                return (
                  <article className="ec-alert-card" data-severity={alert.severity} key={alert.id}>
                    <div className="ec-alert-card-head">
                      <div>
                        <strong>{alert.alertType.replaceAll('_', ' ')}</strong>
                        <div className="ec-alert-meta">
                          {locationLabel(alert.inventoryLocationId)} • {skuLabel(alert.skuId)}
                        </div>
                      </div>
                      <span className="ec-status-pill" data-tone={alertTone(alert.severity)}>
                        {alert.severity}
                      </span>
                    </div>
                    <div className="ec-kpi-grid" style={{ marginTop: 12 }}>
                      <InventoryMetric label="Available" value={alert.availableQuantityBase} />
                      <InventoryMetric
                        label="Minutes of cover"
                        value={alert.minutesOfCover ?? 'Unknown'}
                      />
                    </div>
                    <p>
                      {suggestedTransfer
                        ? `Suggested response: move ${alert.suggestedTransferQuantityBase} from ${locationLabel(alert.suggestedSourceLocationId)}.`
                        : 'No transfer recommendation is currently available.'}
                    </p>
                    <div className="ec-alert-meta">
                      {alert.state} • owner{' '}
                      {alert.assignedActorId ?? alert.responsibleActorId ?? 'unassigned'}
                    </div>
                  </article>
                );
              })}
            </div>
'''
new_cards = '''            <div className="ec-action-list">
              {activeAlerts.map((alert) => {
                const suggestedQuantity =
                  alert.suggestedTransferQuantityBase &&
                  alert.suggestedTransferQuantityBase !== '0'
                    ? alert.suggestedTransferQuantityBase
                    : null;
                const suggestedSource = alert.suggestedSourceLocationId
                  ? locationLabel(alert.suggestedSourceLocationId)
                  : null;
                const ownerId = alert.assignedActorId ?? alert.responsibleActorId;
                return (
                  <article
                    className="ec-alert-card"
                    data-tone={alertTone(alert.severity)}
                    key={alert.id}
                  >
                    <div className="ec-alert-rail" aria-hidden="true" />
                    <div className="ec-alert-card-content">
                      <div className="ec-alert-card-head">
                        <div>
                          <strong className="ec-alert-title">{skuLabel(alert.skuId)}</strong>
                          <div className="ec-alert-meta">
                            {locationLabel(alert.inventoryLocationId)} •{' '}
                            {alert.alertType.replaceAll('_', ' ')}
                          </div>
                        </div>
                        <span
                          className="ec-alert-severity"
                          data-tone={alertTone(alert.severity)}
                        >
                          {alert.severity}
                        </span>
                      </div>
                      <div className="ec-kpi-grid" style={{ marginTop: 12 }}>
                        <InventoryMetric label="Available" value={alert.availableQuantityBase} />
                        <InventoryMetric
                          label="Minutes of cover"
                          value={alert.minutesOfCover ?? 'Unknown'}
                        />
                      </div>
                      <div
                        className={suggestedQuantity ? 'ec-banner ec-banner--warning' : 'ec-banner'}
                        style={{ marginTop: 12 }}
                      >
                        {suggestedQuantity && suggestedSource ? (
                          <>
                            <strong>Recommended move.</strong> Move {suggestedQuantity}{' '}
                            {skuLabel(alert.skuId)} from {suggestedSource} to{' '}
                            {locationLabel(alert.inventoryLocationId)}.
                          </>
                        ) : suggestedQuantity ? (
                          <>
                            <strong>Replenishment quantity identified.</strong> Move{' '}
                            {suggestedQuantity} {skuLabel(alert.skuId)} to{' '}
                            {locationLabel(alert.inventoryLocationId)} once the venue team confirms a
                            safe source location.
                          </>
                        ) : (
                          <>
                            <strong>No transfer recommendation yet.</strong> Coordinate replenishment
                            locally for {skuLabel(alert.skuId)} at{' '}
                            {locationLabel(alert.inventoryLocationId)}; this screen has no safe source
                            recommendation.
                          </>
                        )}
                        <div className="ec-alert-meta" style={{ marginTop: 6 }}>
                          Record any move through the venue transfer workflow. This Cloud screen does
                          not move stock.
                        </div>
                      </div>
                      <details className="ec-context-switcher" style={{ marginTop: 10 }}>
                        <summary>Alert details</summary>
                        <div className="ec-alert-meta" style={{ marginTop: 8 }}>
                          {alert.state} • {ownerId ? `owner ${compactId(ownerId)}` : 'unassigned'}
                        </div>
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>
'''
text = replace_once(text, old_cards, new_cards, 'inventory action cards')

text = replace_once(
    text,
    '                    <small>Owner: {transfer.assignedActorId ?? \'unassigned\'}</small>\n',
    '''                    <small>{transfer.assignedActorId ? 'Assigned' : 'Unassigned'}</small>
                    {transfer.assignedActorId ? (
                      <details className="ec-context-switcher">
                        <summary>Transfer details</summary>
                        <small>Owner ID: {compactId(transfer.assignedActorId)}</small>
                      </details>
                    ) : null}
''',
    'transfer owner details',
)
text = replace_once(
    text,
    '                  <p>Current Cloud projection of the append-only stock ledger.</p>\n',
    '                  <p>Latest stock positions received online; this view can lag venue Edge during outages.</p>\n',
    'stock view description',
)
path.write_text(text)
