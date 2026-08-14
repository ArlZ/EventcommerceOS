CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  order_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(id),
  provider_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('CREATED','INITIATED','PENDING','SUCCEEDED','FAILED','UNKNOWN')),
  provider_reference text,
  failure_code text,
  request_fingerprint text NOT NULL,
  initiated_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_attempts_payment_idx ON payment_attempts(payment_id, created_at);
CREATE INDEX IF NOT EXISTS payment_attempts_unknown_idx ON payment_attempts(status, updated_at) WHERE status = 'UNKNOWN';

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id bigserial PRIMARY KEY,
  provider_id text NOT NULL,
  provider_event_key text NOT NULL,
  payment_attempt_id text REFERENCES payment_attempts(id),
  event_kind text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, provider_event_key)
);

CREATE TABLE IF NOT EXISTS payment_reconciliation_jobs (
  payment_attempt_id text PRIMARY KEY REFERENCES payment_attempts(id),
  status text NOT NULL CHECK (status IN ('PENDING','RUNNING','RESOLVED','MANUAL_REVIEW')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_refunds (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(id),
  provider_id text NOT NULL,
  source_provider_reference text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  reason text NOT NULL,
  requesting_actor_id text NOT NULL,
  approving_actor_id text,
  provider_reference text,
  failure_code text,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','UNKNOWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_refunds_payment_idx ON payment_refunds(payment_id, created_at);

CREATE TABLE IF NOT EXISTS payment_reversals (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(id),
  provider_id text NOT NULL,
  source_provider_reference text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  reason text NOT NULL,
  requesting_actor_id text NOT NULL,
  provider_reference text,
  failure_code text,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','UNKNOWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_reversals_payment_idx ON payment_reversals(payment_id, created_at);
