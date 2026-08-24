ALTER TABLE operator_identities
  ADD COLUMN IF NOT EXISTS supabase_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS operator_identities_supabase_user_unique_idx
  ON operator_identities(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS operator_login_challenges (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES operator_identities(id),
  supabase_user_id uuid NOT NULL,
  email text NOT NULL CHECK (length(trim(email)) > 3),
  challenge_sha256 char(64) NOT NULL UNIQUE CHECK (challenge_sha256 ~ '^[0-9a-f]{64}$'),
  remember_device boolean NOT NULL DEFAULT false,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS operator_login_challenges_actor_idx
  ON operator_login_challenges(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operator_login_challenges_active_idx
  ON operator_login_challenges(expires_at, completed_at)
  WHERE completed_at IS NULL;

ALTER TABLE operator_login_challenges ENABLE ROW LEVEL SECURITY;
