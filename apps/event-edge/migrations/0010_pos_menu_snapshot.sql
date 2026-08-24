CREATE TABLE IF NOT EXISTS edge_pos_menu_snapshots (
  event_id text NOT NULL,
  sales_location_id text NOT NULL,
  menu_id text NOT NULL CHECK (length(trim(menu_id)) > 0),
  version bigint NOT NULL CHECK (version > 0),
  activated_at_epoch_ms bigint NOT NULL CHECK (activated_at_epoch_ms > 0),
  source_actor text NOT NULL CHECK (length(trim(source_actor)) > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  checksum char(8) NOT NULL CHECK (checksum ~ '^[0-9a-f]{8}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, sales_location_id),
  FOREIGN KEY (event_id, sales_location_id)
    REFERENCES edge_sales_inventory_mapping(event_id, sales_location_id)
);
CREATE INDEX IF NOT EXISTS edge_pos_menu_snapshots_menu_idx
  ON edge_pos_menu_snapshots(event_id, menu_id, version DESC);
