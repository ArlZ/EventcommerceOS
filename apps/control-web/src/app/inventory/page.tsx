import { InventoryOperationsClient } from './inventory-operations-client';

export default function InventoryPage() {
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <h1>Inventory Operations</h1>
      <p>
        Critical stock risk first. This view is read-only and may lag Event Edge during connectivity
        loss.
      </p>
      <InventoryOperationsClient />
    </main>
  );
}
