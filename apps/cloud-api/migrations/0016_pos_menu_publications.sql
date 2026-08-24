CREATE TABLE pos_menu_publications (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  event_id uuid NOT NULL,
  sales_location_id uuid NOT NULL,
  menu_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  checksum char(8) NOT NULL CHECK (checksum ~ '^[0-9a-f]{8}$'),
  snapshot jsonb NOT NULL,
  published_by uuid NOT NULL REFERENCES operator_identities(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organisation_id) REFERENCES events(id, organisation_id),
  FOREIGN KEY (sales_location_id, organisation_id)
    REFERENCES sales_locations(id, organisation_id),
  FOREIGN KEY (menu_id, organisation_id) REFERENCES menus(id, organisation_id),
  UNIQUE (event_id, sales_location_id, version)
);

CREATE INDEX pos_menu_publications_event_latest_idx
  ON pos_menu_publications(event_id, sales_location_id, version DESC);
CREATE INDEX pos_menu_publications_batch_idx
  ON pos_menu_publications(batch_id);

-- The NestJS Cloud API remains the only application boundary. Keep the publication
-- ledger unreachable through Supabase's Data API even if public schema grants change.
ALTER TABLE pos_menu_publications ENABLE ROW LEVEL SECURITY;
