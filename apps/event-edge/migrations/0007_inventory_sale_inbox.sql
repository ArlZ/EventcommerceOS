CREATE TABLE IF NOT EXISTS edge_inventory_sale_inbox (
  source_event_instance_id text PRIMARY KEY
    REFERENCES edge_processed_device_events(event_instance_id) ON DELETE CASCADE,
  envelope jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('APPLIED', 'EXCEPTION')),
  last_error text
);

CREATE INDEX IF NOT EXISTS edge_inventory_sale_inbox_pending_idx
  ON edge_inventory_sale_inbox(next_attempt_at, received_at)
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION edge_queue_inventory_sale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'ORDER_CLOSED_CASH' THEN
    INSERT INTO edge_inventory_sale_inbox(
      source_event_instance_id, envelope, received_at, next_attempt_at
    ) VALUES (
      NEW.event_instance_id, NEW.envelope, NEW.received_at, NEW.received_at
    ) ON CONFLICT (source_event_instance_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS edge_inventory_sale_inbox_trigger ON edge_processed_device_events;
CREATE TRIGGER edge_inventory_sale_inbox_trigger
AFTER INSERT ON edge_processed_device_events
FOR EACH ROW EXECUTE FUNCTION edge_queue_inventory_sale();

INSERT INTO edge_inventory_sale_inbox(
  source_event_instance_id, envelope, received_at, next_attempt_at
)
SELECT event_instance_id, envelope, received_at, received_at
FROM edge_processed_device_events
WHERE event_type = 'ORDER_CLOSED_CASH'
ON CONFLICT (source_event_instance_id) DO NOTHING;
