from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing expected snippet: {label}")
    return text.replace(old, new, 1)


path = Path("apps/control-web/src/app/event-close/event-close-client.tsx")
text = path.read_text()

text = replace_once(
    text,
    "import { useEffect, useMemo, useState, type ReactNode } from 'react';\n",
    "import Link from 'next/link';\nimport { useEffect, useMemo, useState, type ReactNode } from 'react';\n",
    "next link import",
)

text = replace_once(
    text,
    "              ? 'Review required'\n              : 'No projected exceptions'\n",
    "              ? 'Resolve before close'\n              : 'Ready to close'\n",
    "header readiness language",
)

text = replace_once(
    text,
    '              description="Read these signals before changing the event\'s operational state."\n',
    '              description="Start with what still needs action, then decide whether to close now or resolve it first."\n',
    "close readiness description",
)

summary_marker = """              </div>\n\n              {report.close.sourceChangedSinceLastClose ? (\n"""
summary_replacement = """              </div>\n\n              {attentionRequired ? (\n                <div className=\"ec-banner ec-banner--warning\" style={{ marginTop: 14 }}>\n                  <strong>Resolve what you can before closing.</strong> You can still record a close,\n                  but unresolved items will remain visible in the stored evidence. Use the shortcuts\n                  below to investigate before choosing that option.\n                  <div className=\"ec-form-actions\" style={{ marginTop: 10 }}>\n                    {report.unresolvedPayments.length > 0 || reconciliationUnresolved ? (\n                      <Link className=\"ec-panel-link\" href=\"/command-centre\">\n                        Review payments in Live →\n                      </Link>\n                    ) : null}\n                    {report.openTransfers.length > 0 ||\n                    report.unresolvedCriticalAlerts.length > 0 ? (\n                      <Link className=\"ec-panel-link\" href=\"/inventory\">\n                        Review inventory →\n                      </Link>\n                    ) : null}\n                  </div>\n                </div>\n              ) : (\n                <div className=\"ec-banner ec-banner--success\" style={{ marginTop: 14 }}>\n                  <strong>Ready to close.</strong> No unresolved payment, transfer, critical inventory\n                  or financial reconciliation exceptions are currently projected.\n                </div>\n              )}\n\n              {report.close.sourceChangedSinceLastClose ? (\n"""
text = replace_once(text, summary_marker, summary_replacement, "readiness action banner")

text = replace_once(
    text,
    "                  value={reconciliationUnresolved ? 'UNRESOLVED' : 'CONCLUSIVE'}\n",
    "                  value={reconciliationUnresolved ? 'Needs review' : 'Conclusive'}\n",
    "reconciliation metric language",
)

text = replace_once(
    text,
    '                  title="Open / unreceived transfers"\n',
    '                  title="Transfers not received"\n',
    "transfer card title",
)

text = replace_once(
    text,
    '                  title="Unresolved critical alerts"\n',
    '                  title="Critical inventory alerts"\n',
    "critical alert card title",
)

old_state_panel = """            <Panel\n              title=\"Record operational state\"\n              description=\"Every close or reopen needs an audit reason. Uncertainty remains visible in the stored revision.\"\n            >\n"""
new_state_panel = """            <Panel\n              title={attentionRequired ? 'Close with unresolved items' : 'Record operational close'}\n              description={\n                attentionRequired\n                  ? 'Closing now is allowed, but it will preserve the unresolved items above rather than clearing them.'\n                  : 'No projected blockers remain. Every close or reopen still requires an audit reason.'\n              }\n            >\n"""
text = replace_once(text, old_state_panel, new_state_panel, "close action panel heading")

text = replace_once(
    text,
    "                  Review items remain. Recording an operational close will snapshot them as they\n                  are; it will not mark them resolved.\n",
    "                  <strong>Closing will not resolve these items.</strong> The close revision will\n                  preserve their current state so they remain visible for follow-up and audit.\n",
    "close warning consequence",
)

old_confirm_title = """                        {pendingAction === 'close'\n                          ? 'Confirm operational close'\n                          : 'Confirm audited reopen'}\n"""
new_confirm_title = """                        {pendingAction === 'close'\n                          ? attentionRequired\n                            ? 'Confirm close with unresolved items'\n                            : 'Confirm operational close'\n                          : 'Confirm audited reopen'}\n"""
text = replace_once(text, old_confirm_title, new_confirm_title, "confirm title")

old_confirm_detail = """                        {pendingAction === 'close'\n                          ? 'This records an immutable close revision using the current reconciliation state.'\n                          : 'This reopens operations with the audit reason entered above.'}\n"""
new_confirm_detail = """                        {pendingAction === 'close'\n                          ? attentionRequired\n                            ? 'This records the current state without marking unresolved payments, transfers, alerts or reconciliation items as resolved.'\n                            : 'This records an immutable close revision using the current reconciliation state.'\n                          : 'This reopens operations with the audit reason entered above.'}\n"""
text = replace_once(text, old_confirm_detail, new_confirm_detail, "confirm consequence detail")

text = replace_once(
    text,
    "                    Record operational close\n",
    "                    {attentionRequired ? 'Record close with unresolved items' : 'Record operational close'}\n",
    "primary close button label",
)

path.write_text(text)
