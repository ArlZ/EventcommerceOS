CREATE INDEX pos_menu_publications_org_idx
  ON pos_menu_publications(organisation_id);
CREATE INDEX pos_menu_publications_event_org_idx
  ON pos_menu_publications(event_id, organisation_id);
CREATE INDEX pos_menu_publications_sales_location_org_idx
  ON pos_menu_publications(sales_location_id, organisation_id);
CREATE INDEX pos_menu_publications_menu_org_idx
  ON pos_menu_publications(menu_id, organisation_id);
CREATE INDEX pos_menu_publications_published_by_idx
  ON pos_menu_publications(published_by);
