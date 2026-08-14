CREATE TABLE IF NOT EXISTS edge_payment_attempt_cache (
  payment_attempt_id text PRIMARY KEY,
  payment_id text NOT NULL,
  event_id text NOT NULL,
  order_id text NOT NULL,
  provider_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('CREATED','INITIATED','PENDING','SUCCEEDED','FAILED','UNKNOWN')),
  provider_reference text,
  failure_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS edge_payment_attempt_cache_order_idx
  ON edge_payment_attempt_cache(order_id, updated_at);

CREATE INDEX IF NOT EXISTS edge_payment_attempt_cache_unresolved_idx
  ON edge_payment_attempt_cache(status, updated_at)
  WHERE status IN ('PENDING','UNKNOWN');
