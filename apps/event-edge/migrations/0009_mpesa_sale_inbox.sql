CREATE OR REPLACE FUNCTION edge_queue_inventory_sale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type IN ('ORDER_CLOSED_CASH', 'ORDER_CLOSED_MPESA') THEN
    INSERT INTO edge_inventory_sale_inbox(
      source_event_instance_id, envelope, received_at, next_attempt_at
    ) VALUES (
      NEW.event_instance_id, NEW.envelope, NEW.received_at, NEW.received_at
    ) ON CONFLICT (source_event_instance_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO edge_inventory_sale_inbox(
  source_event_instance_id, envelope, received_at, next_attempt_at
)
SELECT event_instance_id, envelope, received_at, received_at
FROM edge_processed_device_events
WHERE event_type IN ('ORDER_CLOSED_CASH', 'ORDER_CLOSED_MPESA')
ON CONFLICT (source_event_instance_id) DO NOTHING;
