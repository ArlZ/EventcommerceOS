ALTER TABLE sync_order_state
  ADD COLUMN IF NOT EXISTS close_method text,
  ADD COLUMN IF NOT EXISTS cashier_id text;

ALTER TABLE sync_order_state
  DROP CONSTRAINT IF EXISTS sync_order_state_close_method_check;
ALTER TABLE sync_order_state
  ADD CONSTRAINT sync_order_state_close_method_check
  CHECK (close_method IS NULL OR close_method IN ('CASH','PROVIDER','UNKNOWN'));

UPDATE sync_order_state state
SET close_method = CASE source.event_type
      WHEN 'ORDER_CLOSED_CASH' THEN 'CASH'
      WHEN 'ORDER_CLOSED_PROVIDER' THEN 'PROVIDER'
      ELSE 'UNKNOWN'
    END,
    cashier_id = NULLIF(source.payload->>'cashierId', '')
FROM sync_processed_events source
WHERE state.state = 'CLOSED'
  AND source.aggregate_type = 'ORDER'
  AND source.aggregate_id = state.order_id
  AND source.device_id = state.device_id
  AND source.sequence = state.last_sequence
  AND (state.close_method IS NULL OR state.cashier_id IS NULL);

CREATE INDEX IF NOT EXISTS sync_order_state_close_drilldown_idx
  ON sync_order_state(event_id, close_method, sales_location_id, device_id, cashier_id, currency)
  WHERE state = 'CLOSED';

CREATE TABLE IF NOT EXISTS commerce_order_adjustments (
  id text PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  order_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('DISCOUNT','COMP','VOID','CASH_REFUND')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  actor_id uuid NOT NULL,
  device_id text,
  cashier_id text,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS commerce_order_adjustments_event_idx
  ON commerce_order_adjustments(event_id, created_at, order_id);

CREATE TABLE IF NOT EXISTS event_cash_declarations (
  id text PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  sales_location_id uuid NOT NULL,
  device_id text,
  cashier_id text,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  declared_minor bigint NOT NULL CHECK (declared_minor >= 0),
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  idempotency_key text NOT NULL UNIQUE,
  declared_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  FOREIGN KEY (sales_location_id, organisation_id) REFERENCES sales_locations(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS event_cash_declarations_event_scope_idx
  ON event_cash_declarations(
    event_id, sales_location_id, device_id, cashier_id, currency, declared_at DESC
  );

CREATE TABLE IF NOT EXISTS event_inventory_unit_cost_declarations (
  id text PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  sku_id uuid NOT NULL,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  idempotency_key text NOT NULL UNIQUE,
  declared_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  FOREIGN KEY (sku_id, organisation_id) REFERENCES skus(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS event_inventory_unit_cost_event_sku_idx
  ON event_inventory_unit_cost_declarations(event_id, sku_id, declared_at DESC);

CREATE TABLE IF NOT EXISTS event_close_reports (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  source_version_token text NOT NULL,
  report_json jsonb NOT NULL,
  report_sha256 char(64) NOT NULL,
  created_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  UNIQUE (event_id, revision)
);
CREATE INDEX IF NOT EXISTS event_close_reports_event_created_idx
  ON event_close_reports(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS event_close_actions (
  id text PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('OPERATIONALLY_CLOSE','REOPEN')),
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  report_id uuid REFERENCES event_close_reports(id),
  close_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  CHECK (
    (action = 'OPERATIONALLY_CLOSE' AND report_id IS NOT NULL AND close_revision IS NOT NULL)
    OR (action = 'REOPEN' AND report_id IS NULL AND close_revision IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS event_close_actions_event_created_idx
  ON event_close_actions(event_id, created_at DESC, id DESC);
