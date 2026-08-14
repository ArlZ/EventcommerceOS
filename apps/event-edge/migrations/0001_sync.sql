CREATE TABLE IF NOT EXISTS edge_processed_device_events (
  event_instance_id text PRIMARY KEY,
  event_id text NOT NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_version integer NOT NULL,
  device_id text NOT NULL,
  sequence bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  envelope jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, sequence)
);

CREATE TABLE IF NOT EXISTS edge_device_watermarks (
  device_id text PRIMARY KEY,
  accepted_through_sequence bigint NOT NULL DEFAULT 0,
  highest_sequence_seen bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_cloud_delivery_at timestamptz
);

CREATE TABLE IF NOT EXISTS edge_cloud_outbox (
  event_instance_id text PRIMARY KEY REFERENCES edge_processed_device_events(event_instance_id),
  device_id text NOT NULL,
  sequence bigint NOT NULL,
  envelope jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS edge_cloud_outbox_due_idx
  ON edge_cloud_outbox (next_attempt_at, sequence)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS edge_reconciliation_exceptions (
  id text PRIMARY KEY,
  exception_type text NOT NULL,
  device_id text,
  sequence bigint,
  event_instance_id text,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
