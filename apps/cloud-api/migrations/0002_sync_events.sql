CREATE TABLE IF NOT EXISTS sync_processed_events (
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
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_reconciliation_exceptions (
  id text PRIMARY KEY,
  exception_type text NOT NULL,
  event_instance_id text,
  device_id text,
  aggregate_id text,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
