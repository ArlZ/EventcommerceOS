CREATE TABLE IF NOT EXISTS sync_device_state (
  device_id text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL,
  last_sequence_seen bigint NOT NULL DEFAULT 0,
  edge_accepted_through_sequence bigint NOT NULL DEFAULT 0,
  edge_backlog_count integer NOT NULL DEFAULT 0,
  last_cloud_delivery_at timestamptz
);
