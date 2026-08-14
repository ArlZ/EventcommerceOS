CREATE UNIQUE INDEX IF NOT EXISTS edge_inventory_ledger_single_reversal_idx
  ON edge_inventory_ledger(reversal_of_ledger_id)
  WHERE reversal_of_ledger_id IS NOT NULL;
