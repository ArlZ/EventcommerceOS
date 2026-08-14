CREATE TABLE IF NOT EXISTS human_users (
  id uuid PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(trim(email)) AND position('@' in email) > 1),
  password_salt bytea NOT NULL CHECK (octet_length(password_salt) >= 16),
  password_hash bytea NOT NULL CHECK (octet_length(password_hash) >= 32),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  platform_role text CHECK (platform_role IS NULL OR platform_role = 'PLATFORM_ADMIN'),
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  UNIQUE (email),
  CHECK ((status = 'ACTIVE' AND disabled_at IS NULL) OR status = 'DISABLED')
);

CREATE TABLE IF NOT EXISTS human_organisation_memberships (
  user_id uuid NOT NULL REFERENCES human_users(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  role text NOT NULL CHECK (role IN ('ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, organisation_id),
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR status = 'REVOKED')
);
CREATE INDEX IF NOT EXISTS human_memberships_org_idx
  ON human_organisation_memberships(organisation_id, status, user_id);

CREATE TABLE IF NOT EXISTS human_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES human_users(id) ON DELETE CASCADE,
  organisation_id uuid REFERENCES organisations(id),
  role text NOT NULL CHECK (role IN ('ADMIN','PLATFORM_ADMIN')),
  token_sha256 char(64) NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  user_auth_version integer NOT NULL CHECK (user_auth_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((role = 'PLATFORM_ADMIN') OR organisation_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS human_sessions_user_active_idx
  ON human_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS human_auth_audit (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES human_users(id),
  organisation_id uuid REFERENCES organisations(id),
  action text NOT NULL CHECK (action IN (
    'USER_PROVISIONED','PASSWORD_ROTATED','USER_DISABLED','USER_ENABLED',
    'MEMBERSHIP_GRANTED','MEMBERSHIP_REVOKED','SESSION_ISSUED','SESSION_REVOKED'
  )),
  actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS human_auth_audit_user_idx
  ON human_auth_audit(user_id, created_at DESC, id DESC);
