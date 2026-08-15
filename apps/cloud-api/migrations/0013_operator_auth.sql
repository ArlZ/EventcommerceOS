CREATE TABLE IF NOT EXISTS operator_identities (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  email text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  platform_role text CHECK (platform_role IS NULL OR platform_role = 'PLATFORM_ADMIN'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS operator_identities_email_unique_idx
  ON operator_identities(lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS operator_memberships (
  actor_id uuid NOT NULL REFERENCES operator_identities(id),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  role text NOT NULL CHECK (role IN ('ADMIN','FINANCE','SUPERVISOR','VIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (actor_id, organisation_id),
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS operator_memberships_org_idx
  ON operator_memberships(organisation_id, status, role, actor_id);

CREATE TABLE IF NOT EXISTS operator_sessions (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES operator_identities(id),
  token_sha256 char(64) NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS operator_sessions_actor_idx
  ON operator_sessions(actor_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS operator_auth_audit (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  organisation_id uuid,
  action text NOT NULL CHECK (action IN (
    'IDENTITY_CREATED','IDENTITY_REVOKED','MEMBERSHIP_GRANTED','MEMBERSHIP_REVOKED',
    'SESSION_CREATED','SESSION_REVOKED'
  )),
  target_actor_id uuid,
  session_id uuid,
  role text,
  performed_by text NOT NULL CHECK (length(trim(performed_by)) > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (actor_id) REFERENCES operator_identities(id),
  FOREIGN KEY (target_actor_id) REFERENCES operator_identities(id),
  FOREIGN KEY (organisation_id) REFERENCES organisations(id)
);
CREATE INDEX IF NOT EXISTS operator_auth_audit_created_idx
  ON operator_auth_audit(created_at DESC, id DESC);
