CREATE TABLE IF NOT EXISTS edge_pos_devices (
  device_id text PRIMARY KEY CHECK (length(trim(device_id)) > 0),
  credential_sha256 char(64) NOT NULL CHECK (credential_sha256 ~ '^[0-9a-f]{64}$'),
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  event_id text NOT NULL CHECK (length(trim(event_id)) > 0),
  sales_location_id text,
  register_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz,
  revoked_at timestamptz,
  CHECK (sales_location_id IS NULL OR length(trim(sales_location_id)) > 0),
  CHECK (register_id IS NULL OR length(trim(register_id)) > 0),
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS edge_pos_devices_credential_idx
  ON edge_pos_devices(credential_sha256);
CREATE INDEX IF NOT EXISTS edge_pos_devices_event_idx
  ON edge_pos_devices(event_id,status,device_id);

CREATE TABLE IF NOT EXISTS edge_pos_device_audit (
  id bigserial PRIMARY KEY,
  device_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('PROVISIONED','ROTATED','REASSIGNED','REVOKED')),
  credential_version integer NOT NULL CHECK (credential_version > 0),
  event_id text NOT NULL,
  sales_location_id text,
  register_id text,
  actor text NOT NULL CHECK (length(trim(actor)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edge_pos_device_audit_device_idx
  ON edge_pos_device_audit(device_id,created_at DESC,id DESC);

ALTER TABLE edge_payment_attempt_cache
  ADD COLUMN IF NOT EXISTS device_id text;
CREATE INDEX IF NOT EXISTS edge_payment_attempt_cache_device_idx
  ON edge_payment_attempt_cache(device_id,event_id,order_id)
  WHERE device_id IS NOT NULL;