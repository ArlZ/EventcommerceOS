ALTER TABLE inventory_alert_projection
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz NOT NULL DEFAULT now();
