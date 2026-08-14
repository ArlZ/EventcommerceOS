CREATE TABLE IF NOT EXISTS inventory_edge_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  inventory_location_id text NOT NULL,
  sku_id text NOT NULL,
  movement_type text NOT NULL,
  quantity_delta bigint NOT NULL CHECK (quantity_delta <> 0),
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_event_instance_id text,
  actor_id text,
  device_id text,
  reason text,
  occurred_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  reversal_of_ledger_id text,
  edge_event_id text NOT NULL REFERENCES inventory_edge_events(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_ledger_projection_idx
  ON inventory_ledger(event_id, inventory_location_id, sku_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_idempotency_idx
  ON inventory_ledger(idempotency_key);

CREATE OR REPLACE VIEW inventory_stock_projection AS
SELECT event_id, inventory_location_id, sku_id, SUM(quantity_delta)::bigint AS on_hand
FROM inventory_ledger
GROUP BY event_id, inventory_location_id, sku_id;

CREATE TABLE IF NOT EXISTS inventory_transfer_projection (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  source_location_id text NOT NULL,
  destination_location_id text NOT NULL,
  state text NOT NULL,
  requested_by_actor_id text,
  assigned_actor_id text,
  lines jsonb NOT NULL,
  source_updated_at timestamptz NOT NULL,
  edge_event_id text NOT NULL REFERENCES inventory_edge_events(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_transfer_projection_event_idx
  ON inventory_transfer_projection(event_id, source_updated_at DESC);

CREATE TABLE IF NOT EXISTS inventory_alert_projection (
  id text PRIMARY KEY,
  alert_type text NOT NULL,
  severity text NOT NULL,
  state text NOT NULL,
  event_id text NOT NULL,
  inventory_location_id text,
  sku_id text NOT NULL,
  available_quantity bigint NOT NULL,
  minutes_of_cover numeric(14,4),
  suggested_source_location_id text,
  suggested_transfer_quantity bigint,
  responsible_actor_id text,
  assigned_actor_id text,
  opened_at timestamptz NOT NULL,
  escalate_at timestamptz,
  edge_event_id text NOT NULL REFERENCES inventory_edge_events(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_alert_projection_event_idx
  ON inventory_alert_projection(event_id, severity, state, opened_at DESC);

CREATE TABLE IF NOT EXISTS inventory_count_projection (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  inventory_location_id text NOT NULL,
  state text NOT NULL,
  payload jsonb NOT NULL,
  edge_event_id text NOT NULL REFERENCES inventory_edge_events(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_reconciliation_exceptions (
  id uuid PRIMARY KEY,
  exception_type text NOT NULL,
  edge_event_id text,
  details jsonb NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
