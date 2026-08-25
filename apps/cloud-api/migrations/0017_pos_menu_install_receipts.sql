ALTER TABLE pos_menu_publications
  ADD CONSTRAINT pos_menu_publications_id_org_unique UNIQUE (id, organisation_id);
ALTER TABLE edge_sync_clients
  ADD CONSTRAINT edge_sync_clients_id_org_unique UNIQUE (edge_id, organisation_id);

CREATE TABLE pos_menu_install_receipts (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL,
  edge_id text NOT NULL,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id, edge_id),
  FOREIGN KEY (publication_id, organisation_id)
    REFERENCES pos_menu_publications(id, organisation_id),
  FOREIGN KEY (edge_id, organisation_id)
    REFERENCES edge_sync_clients(edge_id, organisation_id)
);

CREATE INDEX pos_menu_install_receipts_edge_idx
  ON pos_menu_install_receipts(edge_id, reported_at DESC);
CREATE INDEX pos_menu_install_receipts_org_idx
  ON pos_menu_install_receipts(organisation_id, reported_at DESC);

-- Receipts are written and read only through the authenticated NestJS Cloud API.
ALTER TABLE pos_menu_install_receipts ENABLE ROW LEVEL SECURITY;
