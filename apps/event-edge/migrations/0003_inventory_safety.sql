ALTER TABLE edge_stock_transfers
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS edge_stock_transfers_idempotency_idx
  ON edge_stock_transfers(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS edge_inventory_actor_permissions (
  event_id text NOT NULL,
  actor_id text NOT NULL,
  permission text NOT NULL CHECK (permission IN (
    'INVENTORY_MOVE', 'TRANSFER_MANAGE', 'COUNT_MANAGE', 'ALERT_MANAGE', 'INVENTORY_CONFIGURE'
  )),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, actor_id, permission)
);

CREATE TABLE IF NOT EXISTS edge_inventory_exceptions (
  id text PRIMARY KEY,
  exception_type text NOT NULL,
  event_id text,
  sales_location_id text,
  source_event_instance_id text,
  details jsonb NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS edge_inventory_exception_source_type_idx
  ON edge_inventory_exceptions(source_event_instance_id, exception_type)
  WHERE source_event_instance_id IS NOT NULL AND resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS edge_stock_transfer_receipts (
  idempotency_key text PRIMARY KEY,
  transfer_id text NOT NULL REFERENCES edge_stock_transfers(id),
  actor_id text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE edge_inventory_alerts
  DROP CONSTRAINT IF EXISTS edge_inventory_alerts_dedupe_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS edge_inventory_alerts_active_dedupe_idx
  ON edge_inventory_alerts(dedupe_key)
  WHERE state <> 'RESOLVED';
