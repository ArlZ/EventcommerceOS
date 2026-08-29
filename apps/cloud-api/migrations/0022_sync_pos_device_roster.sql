CREATE TABLE IF NOT EXISTS sync_pos_device_roster (
  device_id text PRIMARY KEY CHECK (length(trim(device_id)) > 0),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  edge_id text NOT NULL REFERENCES edge_sync_clients(edge_id),
  event_id uuid NOT NULL,
  sales_location_id uuid,
  register_id text,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  source_updated_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  FOREIGN KEY (sales_location_id, organisation_id)
    REFERENCES sales_locations(id, organisation_id),
  CHECK (register_id IS NULL OR length(trim(register_id)) > 0)
);

CREATE INDEX IF NOT EXISTS sync_pos_device_roster_org_status_idx
  ON sync_pos_device_roster(organisation_id, status, device_id);

CREATE INDEX IF NOT EXISTS sync_pos_device_roster_event_status_idx
  ON sync_pos_device_roster(event_id, status, sales_location_id, device_id);

ALTER TABLE sync_pos_device_roster ENABLE ROW LEVEL SECURITY;
