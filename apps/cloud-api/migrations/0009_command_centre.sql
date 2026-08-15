ALTER TABLE sync_order_state
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS sales_location_id text,
  ADD COLUMN IF NOT EXISTS lines jsonb,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

UPDATE sync_order_state state
SET event_id = COALESCE(NULLIF(source.payload->>'eventId', ''), 'legacy:' || source.device_id),
    sales_location_id = NULLIF(source.payload->>'salesLocationId', ''),
    lines = CASE
      WHEN jsonb_typeof(source.payload->'lines') = 'array'
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(source.payload->'lines') line
         WHERE jsonb_typeof(line) <> 'object'
            OR coalesce(line->>'skuId', '') = ''
            OR coalesce(line->>'quantity', '') !~ '^[1-9][0-9]*$'
            OR length(coalesce(line->>'quantity', '')) > 16
            OR coalesce(line->>'unitPriceMinor', '') !~ '^[0-9]+$'
            OR length(coalesce(line->>'unitPriceMinor', '')) > 16
       )
      THEN source.payload->'lines'
      ELSE '[]'::jsonb
    END,
    occurred_at = source.occurred_at
FROM sync_processed_events source
WHERE source.aggregate_type = 'ORDER'
  AND source.aggregate_id = state.order_id
  AND source.device_id = state.device_id
  AND source.sequence = state.last_sequence
  AND (state.event_id IS NULL OR state.lines IS NULL OR state.occurred_at IS NULL);

ALTER TABLE sync_order_state
  ALTER COLUMN event_id SET NOT NULL,
  ALTER COLUMN lines SET NOT NULL,
  ALTER COLUMN occurred_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS sync_order_state_command_centre_event_idx
  ON sync_order_state(event_id, state, occurred_at DESC);

CREATE INDEX IF NOT EXISTS sync_order_state_command_centre_device_idx
  ON sync_order_state(event_id, device_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS payments_event_created_idx
  ON payments(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS command_centre_inventory_alert_control (
  alert_id text PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('ACKNOWLEDGED', 'ASSIGNED')),
  acknowledged_by_actor_id uuid,
  assigned_actor_id uuid,
  updated_by_actor_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  CHECK (state <> 'ASSIGNED' OR assigned_actor_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS command_centre_inventory_alert_control_event_idx
  ON command_centre_inventory_alert_control(event_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS command_centre_alert_audit (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  alert_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('ACKNOWLEDGE', 'ASSIGN')),
  actor_id uuid NOT NULL,
  assigned_actor_id uuid,
  previous_state text NOT NULL,
  resulting_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id)
);

CREATE INDEX IF NOT EXISTS command_centre_alert_audit_event_idx
  ON command_centre_alert_audit(event_id, created_at DESC);
