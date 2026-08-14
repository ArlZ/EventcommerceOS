CREATE TABLE IF NOT EXISTS edge_inventory_event_config (
  event_id text PRIMARY KEY,
  event_end_at timestamptz NOT NULL,
  short_window_minutes integer NOT NULL DEFAULT 10 CHECK (short_window_minutes > 0),
  medium_window_minutes integer NOT NULL DEFAULT 30 CHECK (medium_window_minutes >= short_window_minutes),
  short_weight_basis_points integer NOT NULL DEFAULT 6000 CHECK (short_weight_basis_points BETWEEN 0 AND 10000),
  escalation_minutes integer NOT NULL DEFAULT 5 CHECK (escalation_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edge_inventory_locations (
  event_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, id)
);

CREATE TABLE IF NOT EXISTS edge_inventory_skus (
  event_id text NOT NULL,
  sku_id text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  category text,
  base_unit text NOT NULL CHECK (length(trim(base_unit)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, sku_id)
);

CREATE TABLE IF NOT EXISTS edge_sales_inventory_mapping (
  event_id text NOT NULL,
  sales_location_id text NOT NULL,
  inventory_location_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, sales_location_id),
  FOREIGN KEY (event_id, inventory_location_id)
    REFERENCES edge_inventory_locations(event_id, id)
);

CREATE TABLE IF NOT EXISTS edge_inventory_recipes (
  event_id text NOT NULL,
  sold_sku_id text NOT NULL,
  component_sku_id text NOT NULL,
  quantity_per_sold_unit bigint NOT NULL CHECK (quantity_per_sold_unit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, sold_sku_id, component_sku_id),
  FOREIGN KEY (event_id, sold_sku_id)
    REFERENCES edge_inventory_skus(event_id, sku_id),
  FOREIGN KEY (event_id, component_sku_id)
    REFERENCES edge_inventory_skus(event_id, sku_id)
);

CREATE TABLE IF NOT EXISTS edge_inventory_ledger (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  inventory_location_id text NOT NULL,
  sku_id text NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN (
    'RECEIPT', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE', 'RECIPE_CONSUMPTION',
    'WASTAGE', 'BREAKAGE', 'COMP', 'COUNT_ADJUSTMENT', 'RETURN_TO_WAREHOUSE',
    'SUPPLIER_RETURN', 'REVERSAL'
  )),
  quantity_delta bigint NOT NULL CHECK (quantity_delta <> 0),
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_event_instance_id text,
  actor_id text,
  device_id text,
  reason text,
  occurred_at timestamptz NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reversal_of_ledger_id text REFERENCES edge_inventory_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, inventory_location_id)
    REFERENCES edge_inventory_locations(event_id, id),
  FOREIGN KEY (event_id, sku_id)
    REFERENCES edge_inventory_skus(event_id, sku_id)
);

CREATE INDEX IF NOT EXISTS edge_inventory_ledger_projection_idx
  ON edge_inventory_ledger(event_id, inventory_location_id, sku_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS edge_inventory_ledger_sale_velocity_idx
  ON edge_inventory_ledger(event_id, inventory_location_id, sku_id, movement_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS edge_inventory_ledger_source_event_idx
  ON edge_inventory_ledger(source_event_instance_id)
  WHERE source_event_instance_id IS NOT NULL;

CREATE OR REPLACE VIEW edge_inventory_stock_projection AS
SELECT
  event_id,
  inventory_location_id,
  sku_id,
  SUM(quantity_delta)::bigint AS on_hand
FROM edge_inventory_ledger
GROUP BY event_id, inventory_location_id, sku_id;

CREATE TABLE IF NOT EXISTS edge_stock_transfers (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  source_location_id text NOT NULL,
  destination_location_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('REQUESTED', 'ASSIGNED', 'PICKING', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED')),
  requested_by_actor_id text NOT NULL,
  assigned_actor_id text,
  request_reason text NOT NULL,
  requested_at timestamptz NOT NULL,
  assigned_at timestamptz,
  picking_at timestamptz,
  in_transit_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_location_id <> destination_location_id),
  FOREIGN KEY (event_id, source_location_id)
    REFERENCES edge_inventory_locations(event_id, id),
  FOREIGN KEY (event_id, destination_location_id)
    REFERENCES edge_inventory_locations(event_id, id)
);

CREATE TABLE IF NOT EXISTS edge_stock_transfer_lines (
  transfer_id text NOT NULL REFERENCES edge_stock_transfers(id),
  sku_id text NOT NULL,
  requested_quantity bigint NOT NULL CHECK (requested_quantity > 0),
  dispatched_quantity bigint NOT NULL DEFAULT 0 CHECK (dispatched_quantity >= 0),
  received_quantity bigint NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  PRIMARY KEY (transfer_id, sku_id),
  CHECK (dispatched_quantity <= requested_quantity),
  CHECK (received_quantity <= dispatched_quantity)
);

CREATE TABLE IF NOT EXISTS edge_stock_transfer_history (
  id text PRIMARY KEY,
  transfer_id text NOT NULL REFERENCES edge_stock_transfers(id),
  from_state text,
  to_state text NOT NULL,
  actor_id text NOT NULL,
  reason text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edge_stock_transfer_history_transfer_idx
  ON edge_stock_transfer_history(transfer_id, occurred_at);

CREATE TABLE IF NOT EXISTS edge_stock_counts (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  inventory_location_id text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED')),
  opened_by_actor_id text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_by_actor_id text,
  closed_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, inventory_location_id)
    REFERENCES edge_inventory_locations(event_id, id)
);

CREATE TABLE IF NOT EXISTS edge_stock_count_lines (
  count_id text NOT NULL REFERENCES edge_stock_counts(id),
  sku_id text NOT NULL,
  counted_quantity bigint NOT NULL CHECK (counted_quantity >= 0),
  expected_quantity_at_close bigint,
  adjustment_ledger_id text REFERENCES edge_inventory_ledger(id),
  PRIMARY KEY (count_id, sku_id)
);

CREATE TABLE IF NOT EXISTS edge_inventory_alert_config (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  inventory_location_id text,
  sku_id text NOT NULL,
  absolute_minimum bigint NOT NULL DEFAULT 0 CHECK (absolute_minimum >= 0),
  minutes_cover_threshold numeric(12,4) NOT NULL DEFAULT 15 CHECK (minutes_cover_threshold >= 0),
  target_cover_minutes numeric(12,4) NOT NULL DEFAULT 60 CHECK (target_cover_minutes >= 0),
  source_safety_stock bigint NOT NULL DEFAULT 0 CHECK (source_safety_stock >= 0),
  event_wide_safety_stock bigint NOT NULL DEFAULT 0 CHECK (event_wide_safety_stock >= 0),
  imbalance_ratio numeric(12,4) NOT NULL DEFAULT 2 CHECK (imbalance_ratio >= 1),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (event_id, inventory_location_id, sku_id),
  FOREIGN KEY (event_id, sku_id)
    REFERENCES edge_inventory_skus(event_id, sku_id),
  FOREIGN KEY (event_id, inventory_location_id)
    REFERENCES edge_inventory_locations(event_id, id)
);

CREATE TABLE IF NOT EXISTS edge_inventory_responsibilities (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  inventory_location_id text,
  category text,
  responsible_actor_id text NOT NULL,
  escalation_actor_id text,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, inventory_location_id)
    REFERENCES edge_inventory_locations(event_id, id)
);

CREATE TABLE IF NOT EXISTS edge_inventory_alerts (
  id text PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  alert_type text NOT NULL CHECK (alert_type IN (
    'LOW_STOCK', 'STOCKOUT_RISK', 'CRITICAL_STOCKOUT_RISK',
    'EVENT_WIDE_STOCKOUT_RISK', 'STOCK_IMBALANCE'
  )),
  severity text NOT NULL CHECK (severity IN ('LOW', 'URGENT', 'CRITICAL')),
  state text NOT NULL CHECK (state IN ('OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'RESOLVED')),
  event_id text NOT NULL,
  inventory_location_id text,
  sku_id text NOT NULL,
  available_quantity bigint NOT NULL,
  minutes_of_cover numeric(14,4),
  projected_stockout_at timestamptz,
  suggested_source_location_id text,
  suggested_transfer_quantity bigint CHECK (suggested_transfer_quantity IS NULL OR suggested_transfer_quantity >= 0),
  responsible_actor_id text,
  assigned_actor_id text,
  opened_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  assigned_at timestamptz,
  resolved_at timestamptz,
  escalate_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edge_inventory_alerts_open_idx
  ON edge_inventory_alerts(event_id, severity, opened_at)
  WHERE state <> 'RESOLVED';

CREATE TABLE IF NOT EXISTS edge_inventory_alert_history (
  id text PRIMARY KEY,
  alert_id text NOT NULL REFERENCES edge_inventory_alerts(id),
  from_state text,
  to_state text NOT NULL,
  actor_id text,
  reason text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edge_inventory_notification_outbox (
  id text PRIMARY KEY,
  alert_id text NOT NULL REFERENCES edge_inventory_alerts(id),
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'SMS', 'WHATSAPP')),
  recipient_actor_id text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edge_inventory_notification_pending_idx
  ON edge_inventory_notification_outbox(next_attempt_at)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS edge_inventory_cloud_outbox (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edge_inventory_cloud_outbox_pending_idx
  ON edge_inventory_cloud_outbox(next_attempt_at, created_at)
  WHERE delivered_at IS NULL;
