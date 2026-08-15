CREATE TABLE IF NOT EXISTS payment_actor_permissions (
  event_id text NOT NULL,
  actor_id text NOT NULL,
  permission text NOT NULL CHECK (permission IN ('PAYMENT_MANUAL_CONFIRM')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, actor_id, permission)
);

CREATE TABLE IF NOT EXISTS payment_manual_terminal_confirmations (
  id text PRIMARY KEY,
  payment_attempt_id text NOT NULL REFERENCES payment_attempts(id),
  event_id text NOT NULL,
  order_id text NOT NULL,
  external_provider_id text NOT NULL CHECK (length(trim(external_provider_id)) > 0),
  external_reference text NOT NULL CHECK (length(trim(external_reference)) > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('APPROVED', 'DECLINED')),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_provider_id, external_reference)
);
CREATE INDEX IF NOT EXISTS payment_manual_terminal_payment_idx
  ON payment_manual_terminal_confirmations(payment_attempt_id, created_at);

CREATE TABLE IF NOT EXISTS payment_audit_events (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_audit_events_aggregate_idx
  ON payment_audit_events(aggregate_type, aggregate_id, created_at);
