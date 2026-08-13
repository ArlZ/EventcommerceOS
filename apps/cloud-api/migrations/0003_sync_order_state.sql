CREATE TABLE IF NOT EXISTS sync_order_state (
  order_id text PRIMARY KEY,
  device_id text NOT NULL,
  last_sequence bigint NOT NULL,
  state text NOT NULL,
  total_minor bigint NOT NULL,
  currency text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
