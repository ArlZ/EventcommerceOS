CREATE OR REPLACE FUNCTION enforce_event_close_correction_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_action text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('event-close:' || NEW.event_id::text));

  SELECT action
  INTO latest_action
  FROM event_close_actions
  WHERE event_id = NEW.event_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF latest_action = 'OPERATIONALLY_CLOSE' THEN
    RAISE EXCEPTION 'event is operationally closed; reopen before recording a new close correction'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commerce_order_adjustments_close_window
  ON commerce_order_adjustments;
CREATE TRIGGER commerce_order_adjustments_close_window
BEFORE INSERT ON commerce_order_adjustments
FOR EACH ROW EXECUTE FUNCTION enforce_event_close_correction_window();

DROP TRIGGER IF EXISTS event_cash_declarations_close_window
  ON event_cash_declarations;
CREATE TRIGGER event_cash_declarations_close_window
BEFORE INSERT ON event_cash_declarations
FOR EACH ROW EXECUTE FUNCTION enforce_event_close_correction_window();

DROP TRIGGER IF EXISTS event_inventory_unit_cost_close_window
  ON event_inventory_unit_cost_declarations;
CREATE TRIGGER event_inventory_unit_cost_close_window
BEFORE INSERT ON event_inventory_unit_cost_declarations
FOR EACH ROW EXECUTE FUNCTION enforce_event_close_correction_window();
