CREATE TABLE edge_security_snapshot_state (
  event_id text PRIMARY KEY,
  organisation_id text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  generated_at timestamptz NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE edge_security_operator_credentials (
  credential_id uuid PRIMARY KEY,
  event_id text NOT NULL REFERENCES edge_security_snapshot_state(event_id) ON DELETE CASCADE,
  organisation_id text NOT NULL,
  actor_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN','PLATFORM_ADMIN')),
  secret_hash char(64) NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX edge_security_operator_event_idx
  ON edge_security_operator_credentials(event_id, actor_id, expires_at);

CREATE TABLE edge_security_device_credentials (
  credential_id uuid PRIMARY KEY,
  event_id text NOT NULL REFERENCES edge_security_snapshot_state(event_id) ON DELETE CASCADE,
  organisation_id text NOT NULL,
  sales_location_id text NOT NULL,
  device_id text NOT NULL,
  secret_hash char(64) NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX edge_security_device_event_idx
  ON edge_security_device_credentials(event_id, device_id, expires_at);
