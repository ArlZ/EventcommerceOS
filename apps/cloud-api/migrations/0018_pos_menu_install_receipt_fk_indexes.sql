CREATE INDEX pos_menu_install_receipts_publication_org_idx
  ON pos_menu_install_receipts(publication_id, organisation_id);
CREATE INDEX pos_menu_install_receipts_edge_org_idx
  ON pos_menu_install_receipts(edge_id, organisation_id);
