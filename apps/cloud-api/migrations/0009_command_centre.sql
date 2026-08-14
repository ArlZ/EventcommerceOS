CREATE INDEX IF NOT EXISTS sync_processed_events_command_centre_event_idx
  ON sync_processed_events ((payload->>'eventId'), aggregate_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS sync_processed_events_command_centre_device_idx
  ON sync_processed_events ((payload->>'eventId'), device_id, occurred_at DESC)
  WHERE aggregate_type = 'ORDER';

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
