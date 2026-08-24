from pathlib import Path

path = Path('apps/control-web/src/app/event-close/event-close-client.tsx')
text = path.read_text()
old = '              description="Start with what still needs action, then decide whether to close now or resolve it first."\n'
new = """              description={
                isOperationallyClosed
                  ? 'Review what changed after the stored close before deciding whether an audited reopen is needed.'
                  : 'Start with what still needs action, then decide whether to close now or resolve it first.'
              }
"""
if old not in text:
    raise SystemExit('Missing close readiness description')
path.write_text(text.replace(old, new, 1))
