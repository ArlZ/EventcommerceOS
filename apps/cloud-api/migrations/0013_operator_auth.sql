CREATE TABLE IF NOT EXISTS operator_accounts (
  actor_id uuid PRIMARY KEY,
  organisation_id uuid REFERENCES organisations(id),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  role text NOT NULL CHECK (role IN ('OPERATOR','SUPERVISOR','ADMIN','PLATFORM_ADMIN')),
  credential_sha256 char(64) NOT NULL CHECK (credential_sha256 ~ '^[0-9a-f]{64}$'),
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  session_version integer NOT NULL DEFAULT 1 CHECK (session_version > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz,
  revoked_at timestamptz,
  CHECK (
    (role = 'PLATFORM_ADMIN' AND organisation_id IS NULL) OR
    (role <> 'PLATFORM_ADMIN' AND organisation_id IS NOT NULL)
  ),
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS operator_accounts_credential_idx
  ON operator_accounts(credential_sha256);
CREATE INDEX IF NOT EXISTS operator_accounts_org_idx
  ON operator_accounts(organisation_id,status,role,actor_id);

CREATE TABLE IF NOT EXISTS operator_account_audit (
  id bigserial PRIMARY KEY,
  actor_id uuid NOT NULL,
  organisation_id uuid,
  action text NOT NULL CHECK (action IN (
    'PROVISIONED','ROTATED','REVOKED','SESSIONS_REVOKED','PERMISSION_GRANTED','PERMISSION_REVOKED'
  )),
  role text NOT NULL CHECK (role IN ('OPERATOR','SUPERVISOR','ADMIN','PLATFORM_ADMIN')),
  credential_version integer NOT NULL CHECK (credential_version > 0),
  session_version integer NOT NULL CHECK (session_version > 0),
  event_id text,
  permission text,
  performed_by text NOT NULL CHECK (length(trim(performed_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operator_account_audit_actor_idx
  ON operator_account_audit(actor_id,created_at DESC,id DESC);

ALTER TABLE payment_actor_permissions
  DROP CONSTRAINT IF EXISTS payment_actor_permissions_permission_check;
ALTER TABLE payment_actor_permissions
  ADD CONSTRAINT payment_actor_permissions_permission_check
  CHECK (permission IN (
    'PAYMENT_MANUAL_CONFIRM','PAYMENT_REFUND','PAYMENT_VIEW'
  ));
