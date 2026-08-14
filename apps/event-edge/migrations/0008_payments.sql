CREATE TABLE IF NOT EXISTS edge_payment_attempts (
  attempt_id text PRIMARY KEY,
  payment_id text NOT NULL,
  event_id text NOT NULL,
  order_id text NOT NULL,
  client_attempt_id text NOT NULL,
  initiation_idempotency_key text NOT NULL UNIQUE,
  provider text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  masked_payer_reference text,
  state text NOT NULL CHECK (
    state IN ('INITIATED','PENDING','SUCCESS','FAILED','EXPIRED','UNKNOWN','REVERSED')
  ),
  provider_request_id text,
  provider_receipt_reference text,
  reconciliation_required boolean NOT NULL DEFAULT true,
  cloud_seen boolean NOT NULL DEFAULT false,
  relay_status text NOT NULL CHECK (relay_status IN ('PENDING','ACKNOWLEDGED','UNAVAILABLE')),
  last_relay_error text,
  next_refresh_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (payment_id, client_attempt_id)
);

CREATE INDEX IF NOT EXISTS edge_payment_attempts_refresh_idx
  ON edge_payment_attempts(next_refresh_at, updated_at)
  WHERE reconciliation_required = true OR cloud_seen = false;
