import { InventoryOperationsClient } from './inventory-operations-client';

export default function InventoryPage() {
  return (
    <main className="ec-page">
      <header className="ec-page-header">
        <div>
          <p className="ec-page-kicker">During trading</p>
          <h1 className="ec-page-title">Protect stock availability</h1>
          <p className="ec-page-description">
            Start with the products and locations most likely to run out. Use this control surface to
            coordinate action while the stock ledger remains the source of truth.
          </p>
        </div>
        <span className="ec-status-pill">Cloud view</span>
      </header>
      <div className="ec-callout">
        <strong>Connectivity rule:</strong> this view can lag Event Edge during a network partition.
        Never stop local selling because this dashboard is delayed.
      </div>
      <InventoryOperationsClient />
    </main>
  );
}
