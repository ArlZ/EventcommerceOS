CREATE TABLE IF NOT EXISTS edge_sync_clients (
  edge_id text PRIMARY KEY CHECK (length(trim(edge_id)) > 0),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  credential_sha256 char(64) NOT NULL CHECK (credential_sha256 ~ '^[0-9a-f]{64}$'),
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz,
  revoked_at timestamptz,
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS edge_sync_clients_org_idx
  ON edge_sync_clients(organisation_id, status, edge_id);

CREATE TABLE IF NOT EXISTS edge_sync_client_audit (
  id bigserial PRIMARY KEY,
  edge_id text NOT NULL,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  action text NOT NULL CHECK (action IN ('PROVISIONED','ROTATED','REVOKED')),
  credential_version integer NOT NULL CHECK (credential_version > 0),
  actor text NOT NULL CHECK (length(trim(actor)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edge_sync_client_audit_edge_idx
  ON edge_sync_client_audit(edge_id, created_at DESC, id DESC);

ALTER TABLE sync_processed_events
  ADD COLUMN IF NOT EXISTS edge_id text REFERENCES edge_sync_clients(edge_id),
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES organisations(id);
CREATE INDEX IF NOT EXISTS sync_processed_events_edge_idx
  ON sync_processed_events(edge_id, received_at DESC)
  WHERE edge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sync_processed_events_org_device_sequence_idx
  ON sync_processed_events(organisation_id, device_id, sequence)
  WHERE organisation_id IS NOT NULL;

ALTER TABLE sync_device_state
  ADD COLUMN IF NOT EXISTS edge_id text REFERENCES edge_sync_clients(edge_id),
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS device_key text;

UPDATE sync_device_state
SET device_key = COALESCE(organisation_id::text || ':' || device_id, 'legacy:' || device_id)
WHERE device_key IS NULL;

ALTER TABLE sync_device_state
  ALTER COLUMN device_key SET NOT NULL;
ALTER TABLE sync_device_state
  DROP CONSTRAINT IF EXISTS sync_device_state_pkey;
ALTER TABLE sync_device_state
  ADD CONSTRAINT sync_device_state_pkey PRIMARY KEY (device_key);

CREATE UNIQUE INDEX IF NOT EXISTS sync_device_state_org_device_idx
  ON sync_device_state(organisation_id, device_id)
  WHERE organisation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sync_device_state_edge_idx
  ON sync_device_state(edge_id, last_seen_at DESC)
  WHERE edge_id IS NOT NULL;