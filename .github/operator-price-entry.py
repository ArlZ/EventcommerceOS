from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing expected snippet: {label}")
    return text.replace(old, new, 1)


path = Path('apps/control-web/src/app/configuration/configuration-client.tsx')
text = path.read_text()

text = replace_once(
    text,
    "import { readEventControlContext, writeEventControlContext } from '../event-context';\n",
    "import { readEventControlContext, writeEventControlContext } from '../event-context';\nimport { priceToMinorUnits } from './pricing';\n",
    'pricing helper import',
)

old_submit = '''                  const form = new FormData(event.currentTarget);
                  const salesLocationId = String(form.get('salesLocationId') ?? '');
                  void run(async () => {
                    await api(`/menu-items/${menuItemId}/prices`, 'PUT', actorId, organisationId, {
                      salesLocationId: salesLocationId || null,
                      amountMinor: Number(form.get('amountMinor')),
                      currency: form.get('currency'),
                    });
                  }, 'Price saved');
'''
new_submit = '''                  const form = new FormData(event.currentTarget);
                  const salesLocationId = String(form.get('salesLocationId') ?? '');
                  const currency = String(form.get('currency') ?? '').trim().toUpperCase();
                  const displayAmount = String(form.get('amount') ?? '').trim();
                  void run(async () => {
                    await api(`/menu-items/${menuItemId}/prices`, 'PUT', actorId, organisationId, {
                      salesLocationId: salesLocationId || null,
                      amountMinor: priceToMinorUnits(displayAmount, currency),
                      currency,
                    });
                  }, 'Price saved');
'''
text = replace_once(text, old_submit, new_submit, 'price submit conversion')

old_inputs = '''                <Input
                  name="amountMinor"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="Price in minor units, e.g. 25000"
                  required
                  disabled={!menuItemId || busy}
                />
                <Input
                  name="currency"
                  defaultValue="KES"
                  maxLength={3}
                  required
                  disabled={!menuItemId || busy}
                />
'''
new_inputs = '''                <label>
                  <strong>Price</strong>
                  <Input
                    name="amount"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    placeholder="250"
                    required
                    disabled={!menuItemId || busy}
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
                    disabled={!menuItemId || busy}
                  />
                </label>
'''
text = replace_once(text, old_inputs, new_inputs, 'operator price fields')

path.write_text(text)
