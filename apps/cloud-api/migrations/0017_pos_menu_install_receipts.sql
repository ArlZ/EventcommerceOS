CREATE TABLE pos_menu_install_receipts (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES pos_menu_publications(id),
  edge_id text NOT NULL REFERENCES edge_sync_clients(edge_id),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id, edge_id)
);

CREATE INDEX pos_menu_install_receipts_edge_idx
  ON pos_menu_install_receipts(edge_id, reported_at DESC);
CREATE INDEX pos_menu_install_receipts_org_idx
  ON pos_menu_install_receipts(organisation_id, reported_at DESC);

-- Receipts are written and read only through the authenticated NestJS Cloud API.
ALTER TABLE pos_menu_install_receipts ENABLE ROW LEVEL SECURITY;
