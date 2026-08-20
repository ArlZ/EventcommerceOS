-- Event Commerce OS uses the NestJS Cloud API as its public application boundary.
-- These tables live in Supabase's `public` schema for PostgreSQL compatibility,
-- so enable RLS without policies to deny PostgREST anon/authenticated access.
-- The database owner used by the managed pilot bypasses RLS for direct pg access.

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_centre_alert_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_centre_inventory_alert_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_order_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_sync_client_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_sync_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_cash_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_close_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_close_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_inventory_unit_cost_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_alert_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_edge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transfer_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_auth_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_actor_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_manual_terminal_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_device_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_order_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;

ALTER VIEW inventory_stock_projection SET (security_invoker = true);

ALTER FUNCTION enforce_event_close_correction_window()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION enforce_event_close_correction_window() FROM PUBLIC;
