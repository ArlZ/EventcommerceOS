CREATE TABLE security_operator_credentials (
  id uuid PRIMARY KEY,
  organisation_id uuid REFERENCES organisations(id),
  actor_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN','PLATFORM_ADMIN')),
  secret_hash char(64) NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  label text NOT NULL CHECK (length(trim(label)) > 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by_actor_id uuid,
  rotated_from_id uuid REFERENCES security_operator_credentials(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (role = 'ADMIN' AND organisation_id IS NOT NULL)
    OR role = 'PLATFORM_ADMIN'
  ),
  CHECK (expires_at > created_at)
);
CREATE INDEX security_operator_credentials_actor_idx
  ON security_operator_credentials(actor_id, expires_at DESC);
CREATE INDEX security_operator_credentials_org_active_idx
  ON security_operator_credentials(organisation_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE security_device_credentials (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  sales_location_id uuid NOT NULL,
  device_id text NOT NULL CHECK (length(trim(device_id)) > 0),
  secret_hash char(64) NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  label text NOT NULL CHECK (length(trim(label)) > 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by_actor_id uuid NOT NULL,
  rotated_from_id uuid REFERENCES security_device_credentials(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  FOREIGN KEY (sales_location_id, organisation_id)
    REFERENCES sales_locations(id, organisation_id),
  CHECK (expires_at > created_at)
);
CREATE INDEX security_device_credentials_event_active_idx
  ON security_device_credentials(event_id, device_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE security_edge_credentials (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  edge_id text NOT NULL CHECK (length(trim(edge_id)) > 0),
  secret_hash char(64) NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  label text NOT NULL CHECK (length(trim(label)) > 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by_actor_id uuid NOT NULL,
  rotated_from_id uuid REFERENCES security_edge_credentials(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  CHECK (expires_at > created_at)
);
CREATE INDEX security_edge_credentials_event_active_idx
  ON security_edge_credentials(event_id, edge_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE SEQUENCE security_snapshot_version_seq AS bigint START WITH 1;
