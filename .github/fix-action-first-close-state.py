from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing expected snippet: {label}")
    return text.replace(old, new, 1)


path = Path("apps/control-web/src/app/event-close/event-close-client.tsx")
text = path.read_text()

text = replace_once(
    text,
    "    (report?.close.sourceChangedSinceLastClose ?? false);\n",
    "    (report?.close.sourceChangedSinceLastClose ?? false);\n  const isOperationallyClosed = report?.close.state === 'OPERATIONALLY_CLOSED';\n",
    "closed state derivation",
)

text = replace_once(
    text,
    "          {report ? (attentionRequired ? 'Resolve before close' : 'Ready to close') : 'Not loaded'}\n",
    "          {report\n            ? isOperationallyClosed\n              ? attentionRequired\n                ? 'Closed — review changes'\n                : 'Closed'\n              : attentionRequired\n                ? 'Resolve before close'\n                : 'Ready to close'\n            : 'Not loaded'}\n",
    "header closed state",
)

old_banner = """              {attentionRequired ? (\n                <div className=\"ec-banner ec-banner--warning\" style={{ marginTop: 14 }}>\n                  <strong>Resolve what you can before closing.</strong> You can still record a\n                  close, but unresolved items will remain visible in the stored evidence. Use the\n                  shortcuts below to investigate before choosing that option.\n                  <div className=\"ec-form-actions\" style={{ marginTop: 10 }}>\n                    {report.unresolvedPayments.length > 0 || reconciliationUnresolved ? (\n                      <Link className=\"ec-panel-link\" href=\"/command-centre\">\n                        Review payments in Live →\n                      </Link>\n                    ) : null}\n                    {report.openTransfers.length > 0 ||\n                    report.unresolvedCriticalAlerts.length > 0 ? (\n                      <Link className=\"ec-panel-link\" href=\"/inventory\">\n                        Review inventory →\n                      </Link>\n                    ) : null}\n                  </div>\n                </div>\n              ) : (\n                <div className=\"ec-banner ec-banner--success\" style={{ marginTop: 14 }}>\n                  <strong>Ready to close.</strong> No unresolved payment, transfer, critical\n                  inventory or financial reconciliation exceptions are currently projected.\n                </div>\n              )}\n"""
new_banner = """              {attentionRequired ? (\n                <div className=\"ec-banner ec-banner--warning\" style={{ marginTop: 14 }}>\n                  <strong>\n                    {isOperationallyClosed\n                      ? 'Review changes after close.'\n                      : 'Resolve what you can before closing.'}\n                  </strong>{' '}\n                  {isOperationallyClosed\n                    ? 'The stored close remains immutable. Reopen before recording a new close revision if source truth needs reconciliation.'\n                    : 'You can still record a close, but unresolved items will remain visible in the stored evidence.'}\n                  <div className=\"ec-form-actions\" style={{ marginTop: 10 }}>\n                    {report.unresolvedPayments.length > 0 || reconciliationUnresolved ? (\n                      <Link className=\"ec-panel-link\" href=\"/command-centre\">\n                        Review payments in Live →\n                      </Link>\n                    ) : null}\n                    {report.openTransfers.length > 0 ||\n                    report.unresolvedCriticalAlerts.length > 0 ? (\n                      <Link className=\"ec-panel-link\" href=\"/inventory\">\n                        Review inventory →\n                      </Link>\n                    ) : null}\n                  </div>\n                </div>\n              ) : (\n                <div className=\"ec-banner ec-banner--success\" style={{ marginTop: 14 }}>\n                  <strong>{isOperationallyClosed ? 'Event is closed.' : 'Ready to close.'}</strong>{' '}\n                  No unresolved payment, transfer, critical inventory or financial reconciliation\n                  exceptions are currently projected.\n                </div>\n              )}\n"""
text = replace_once(text, old_banner, new_banner, "state-aware readiness banner")

old_panel = """            <Panel\n              title={attentionRequired ? 'Close with unresolved items' : 'Record operational close'}\n              description={\n                attentionRequired\n                  ? 'Closing now is allowed, but it will preserve the unresolved items above rather than clearing them.'\n                  : 'No projected blockers remain. Every close or reopen still requires an audit reason.'\n              }\n            >\n"""
new_panel = """            <Panel\n              title={\n                isOperationallyClosed\n                  ? report.close.sourceChangedSinceLastClose\n                    ? 'Reopen to reconcile changes'\n                    : 'Event is operationally closed'\n                  : attentionRequired\n                    ? 'Close with unresolved items'\n                    : 'Record operational close'\n              }\n              description={\n                isOperationallyClosed\n                  ? 'Reopening is an audited state change. Use it when post-close source changes need a new operational close revision.'\n                  : attentionRequired\n                    ? 'Closing now is allowed, but it will preserve the unresolved items above rather than clearing them.'\n                    : 'No projected blockers remain. Every close or reopen still requires an audit reason.'\n              }\n            >\n"""
text = replace_once(text, old_panel, new_panel, "state-aware action panel")

old_warning = """              {attentionRequired ? (\n                <div className=\"ec-banner ec-banner--warning\" style={{ marginBottom: 12 }}>\n                  <strong>Closing will not resolve these items.</strong> The close revision will\n                  preserve their current state so they remain visible for follow-up and audit.\n                </div>\n              ) : null}\n"""
new_warning = """              {attentionRequired ? (\n                <div className=\"ec-banner ec-banner--warning\" style={{ marginBottom: 12 }}>\n                  <strong>\n                    {isOperationallyClosed\n                      ? 'Attention items remain after close.'\n                      : 'Closing will not resolve these items.'}\n                  </strong>{' '}\n                  {isOperationallyClosed\n                    ? 'Reopen only when a new audited operating state is required; the stored close remains unchanged.'\n                    : 'The close revision will preserve their current state so they remain visible for follow-up and audit.'}\n                </div>\n              ) : null}\n"""
text = replace_once(text, old_warning, new_warning, "state-aware warning")

text = replace_once(
    text,
    '                  aria-label="Close reason"\n',
    '                  aria-label="Audit reason"\n',
    "audit reason label",
)

text = replace_once(
    text,
    ") : report.close.state === 'OPERATIONALLY_CLOSED' ? (\n",
    ") : isOperationallyClosed ? (\n",
    "closed action condition",
)

path.write_text(text)
