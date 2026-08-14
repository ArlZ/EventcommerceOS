CREATE OR REPLACE FUNCTION edge_queue_inventory_alert_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  emitted_at timestamptz := clock_timestamp();
  outbox_id text := 'alert:' || md5(NEW.id || emitted_at::text || txid_current()::text || random()::text);
BEGIN
  INSERT INTO edge_inventory_cloud_outbox(
    id, event_type, aggregate_type, aggregate_id, payload, created_at
  ) VALUES (
    outbox_id,
    'INVENTORY_ALERT_UPSERTED',
    'INVENTORY_ALERT',
    NEW.id,
    jsonb_build_object(
      'id', NEW.id,
      'alertType', NEW.alert_type,
      'severity', NEW.severity,
      'state', NEW.state,
      'eventId', NEW.event_id,
      'inventoryLocationId', NEW.inventory_location_id,
      'skuId', NEW.sku_id,
      'availableQuantityBase', NEW.available_quantity::text,
      'minutesOfCover', NEW.minutes_of_cover,
      'suggestedSourceLocationId', NEW.suggested_source_location_id,
      'suggestedTransferQuantityBase', CASE
        WHEN NEW.suggested_transfer_quantity IS NULL THEN NULL
        ELSE NEW.suggested_transfer_quantity::text
      END,
      'responsibleActorId', NEW.responsible_actor_id,
      'assignedActorId', NEW.assigned_actor_id,
      'openedAt', NEW.opened_at,
      'escalateAt', NEW.escalate_at,
      'sourceUpdatedAt', emitted_at
    ),
    emitted_at
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS edge_inventory_alert_cloud_outbox_trigger ON edge_inventory_alerts;
CREATE TRIGGER edge_inventory_alert_cloud_outbox_trigger
AFTER INSERT OR UPDATE ON edge_inventory_alerts
FOR EACH ROW EXECUTE FUNCTION edge_queue_inventory_alert_change();
