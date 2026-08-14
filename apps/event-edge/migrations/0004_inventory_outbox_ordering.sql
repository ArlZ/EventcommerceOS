ALTER TABLE edge_inventory_cloud_outbox
  ALTER COLUMN created_at SET DEFAULT clock_timestamp();
