CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  order_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (event_id, order_id, id)
);

CREATE INDEX IF NOT EXISTS payments_event_order_idx
  ON payments(event_id, order_id, created_at);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(id),
  client_attempt_id text NOT NULL,
  provider text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  masked_payer_reference text,
  initiation_idempotency_key text NOT NULL UNIQUE,
  dispatch_started_at timestamptz,
  provider_request_id text,
  provider_receipt_reference text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (payment_id, client_attempt_id),
  UNIQUE (provider, provider_request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_provider_receipt_unique
  ON payment_attempts(provider, provider_receipt_reference)
  WHERE provider_receipt_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_attempt_state (
  attempt_id text PRIMARY KEY REFERENCES payment_attempts(id),
  state text NOT NULL CHECK (
    state IN ('INITIATED','PENDING','SUCCESS','FAILED','EXPIRED','UNKNOWN','REVERSED')
  ),
  reconciliation_required boolean NOT NULL DEFAULT false,
  next_query_at timestamptz,
  query_attempts integer NOT NULL DEFAULT 0 CHECK (query_attempts >= 0),
  reconciliation_claimed_until timestamptz,
  reconciliation_claimed_by text,
  last_provider_error_code text,
  terminal_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS payment_attempt_state_reconciliation_idx
  ON payment_attempt_state(next_query_at, updated_at)
  WHERE reconciliation_required = true;

CREATE TABLE IF NOT EXISTS payment_attempt_transitions (
  id text PRIMARY KEY,
  attempt_id text NOT NULL REFERENCES payment_attempts(id),
  from_state text,
  to_state text NOT NULL CHECK (
    to_state IN ('INITIATED','PENDING','SUCCESS','FAILED','EXPIRED','UNKNOWN','REVERSED')
  ),
  source text NOT NULL,
  source_id text NOT NULL,
  reason_code text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (attempt_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS payment_attempt_transitions_attempt_idx
  ON payment_attempt_transitions(attempt_id, occurred_at, created_at);

CREATE TABLE IF NOT EXISTS payment_provider_observations (
  id text PRIMARY KEY,
  provider text NOT NULL,
  observation_key text NOT NULL,
  provider_request_id text,
  provider_receipt_reference text,
  attempt_id text REFERENCES payment_attempts(id),
  observation_type text NOT NULL,
  normalized_outcome text NOT NULL,
  verification_strength text NOT NULL CHECK (
    verification_strength IN ('CRYPTOGRAPHIC','CORRELATION_ONLY','NONE')
  ),
  payload_hash text NOT NULL,
  sanitized_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, observation_key)
);

CREATE INDEX IF NOT EXISTS payment_provider_observations_request_idx
  ON payment_provider_observations(provider, provider_request_id, received_at);

CREATE TABLE IF NOT EXISTS payment_reconciliation_exceptions (
  id text PRIMARY KEY,
  attempt_id text REFERENCES payment_attempts(id),
  provider text NOT NULL,
  exception_type text NOT NULL,
  sanitized_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolution_reason text
);

CREATE INDEX IF NOT EXISTS payment_reconciliation_exceptions_open_idx
  ON payment_reconciliation_exceptions(attempt_id, created_at)
  WHERE resolved_at IS NULL;
