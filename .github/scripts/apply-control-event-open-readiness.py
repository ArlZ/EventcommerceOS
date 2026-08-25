from pathlib import Path

path = Path('apps/control-web/src/app/configuration/pos-menu-publication-control.tsx')
text = path.read_text()

old = "import { eventControlContextChangedEvent, readEventControlContext } from '../event-context';\n"
new = old + "import { posMenusReadyToOpen } from './pos-menu-readiness';\n"
if old not in text:
    raise SystemExit('import marker not found')
text = text.replace(old, new, 1)

old = "  const [publicationStatus, setPublicationStatus] = useState<LocationStatus[]>([]);\n  const [confirming, setConfirming] = useState(false);\n"
new = "  const [publicationStatus, setPublicationStatus] = useState<LocationStatus[]>([]);\n  const [activeSalesLocationIds, setActiveSalesLocationIds] = useState<string[]>([]);\n  const [confirming, setConfirming] = useState(false);\n  const [openingConfirming, setOpeningConfirming] = useState(false);\n"
if old not in text:
    raise SystemExit('state marker not found')
text = text.replace(old, new, 1)

old = "      setLifecycle(selected?.lifecycle ?? null);\n      setPublicationStatus(\n"
new = "      setLifecycle(selected?.lifecycle ?? null);\n      setActiveSalesLocationIds(\n        configuration.salesLocations\n          .filter(\n            (location) =>\n              location.eventId === selectedEventId && location.lifecycle === 'ACTIVE',\n          )\n          .map((location) => location.id),\n      );\n      setPublicationStatus(\n"
if old not in text:
    raise SystemExit('load status marker not found')
text = text.replace(old, new, 1)

old = "    setLifecycle(null);\n    setPublicationStatus([]);\n    setConfirming(false);\n"
new = "    setLifecycle(null);\n    setPublicationStatus([]);\n    setActiveSalesLocationIds([]);\n    setConfirming(false);\n    setOpeningConfirming(false);\n"
if old not in text:
    raise SystemExit('context reset marker not found')
text = text.replace(old, new, 1)

old = "  async function publish(): Promise<void> {\n"
new = "  const readyToOpen =\n    lifecycle === 'DRAFT' && posMenusReadyToOpen(activeSalesLocationIds, publicationStatus);\n\n  async function openForTrading(): Promise<void> {\n    if (!organisationId || !eventId || !readyToOpen) return;\n    const version = contextVersion.current;\n    const selectedOrganisationId = organisationId;\n    const selectedEventId = eventId;\n    setBusy(true);\n    setTone('warning');\n    setMessage('Opening event for trading…');\n    try {\n      const response = await fetch(`${apiBase}/events/${selectedEventId}`, {\n        method: 'PATCH',\n        credentials: 'include',\n        headers: {\n          'content-type': 'application/json',\n          'x-organisation-id': selectedOrganisationId,\n        },\n        body: JSON.stringify({ lifecycle: 'ACTIVE' }),\n      });\n      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);\n      if (contextVersion.current !== version) return;\n      setTone('success');\n      setMessage(`${eventName || 'Event'} is open for trading.`);\n      setOpeningConfirming(false);\n      await loadStatus(selectedOrganisationId, selectedEventId, version);\n    } catch (error) {\n      if (contextVersion.current !== version) return;\n      setTone('danger');\n      setMessage(error instanceof Error ? error.message : 'Unable to open event for trading');\n    } finally {\n      setBusy(false);\n    }\n  }\n\n  async function publish(): Promise<void> {\n"
if old not in text:
    raise SystemExit('publish marker not found')
text = text.replace(old, new, 1)

old = "      {lifecycle !== 'DRAFT' ? (\n"
readiness = '''      {lifecycle === 'DRAFT' ? (\n        readyToOpen ? (\n          openingConfirming ? (\n            <div className="ec-inline-confirm" role="group" aria-label="Confirm event opening">\n              <span>\n                Open <strong>{eventName || 'this event'}</strong> for live trading? Event-scoped\n                setup becomes read only after activation.\n              </span>\n              <button\n                className="ec-button-primary"\n                type="button"\n                disabled={busy}\n                onClick={() => void openForTrading()}\n              >\n                {busy ? 'Opening…' : 'Confirm open for trading'}\n              </button>\n              <button type="button" disabled={busy} onClick={() => setOpeningConfirming(false)}>\n                Cancel\n              </button>\n            </div>\n          ) : (\n            <div className="ec-banner ec-banner--success">\n              <strong>Ready to open.</strong> Every active sales location has its latest POS menu\n              installed on Event Edge.{' '}\n              <button\n                className="ec-button-primary"\n                type="button"\n                disabled={busy}\n                onClick={() => setOpeningConfirming(true)}\n              >\n                Open event for trading\n              </button>\n            </div>\n          )\n        ) : (\n          <div className="ec-banner ec-banner--warning">\n            <strong>Not ready to open.</strong> Publish the current configuration and install the\n            latest POS menu on Event Edge for every active sales location first.\n          </div>\n        )\n      ) : null}\n\n      {lifecycle !== 'DRAFT' ? (\n'''
if old not in text:
    raise SystemExit('lifecycle UI marker not found')
text = text.replace(old, readiness, 1)

path.write_text(text)
