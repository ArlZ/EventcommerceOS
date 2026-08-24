import { randomUUID } from 'node:crypto';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name) {
  const value = required(name);
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const baseUrl = new URL(process.env.EDGE_BASE_URL?.trim() || 'http://127.0.0.1:3002');
if (!['127.0.0.1', 'localhost', '::1'].includes(baseUrl.hostname)) {
  throw new Error('Pilot bootstrap must run locally on the Event Edge host');
}

const adminToken = required('EDGE_LOCAL_ADMIN_TOKEN');
const eventId = required('PILOT_EVENT_ID');
const eventEndAt = required('PILOT_EVENT_END_AT');
const salesLocationId = required('PILOT_SALES_LOCATION_ID');
const inventoryLocationId = required('PILOT_INVENTORY_LOCATION_ID');
const skuId = required('PILOT_SKU_ID');
const operatorActorId = required('PILOT_OPERATOR_ACTOR_ID');
const openingStockBase = positiveInteger('PILOT_OPENING_STOCK_BASE');
const openingOccurredAt = required('PILOT_OPENING_STOCK_OCCURRED_AT');

const headers = {
  authorization: `Bearer ${adminToken}`,
  'content-type': 'application/json',
};

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed with HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

const health = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(5_000) });
if (!health.ok) throw new Error(`Event Edge health failed with HTTP ${health.status}`);

await request('/inventory/configuration/snapshot', {
  method: 'POST',
  body: JSON.stringify({
    eventId,
    eventEndAt,
    sourceActorId: operatorActorId,
    locations: [
      {
        id: inventoryLocationId,
        name: process.env.PILOT_INVENTORY_LOCATION_NAME?.trim() || 'Pilot Store',
        type: 'WAREHOUSE',
      },
    ],
    skus: [
      {
        skuId,
        name: process.env.PILOT_SKU_NAME?.trim() || '500 ml Bottle',
        category: process.env.PILOT_SKU_CATEGORY?.trim() || 'Beverage',
        baseUnit: process.env.PILOT_SKU_BASE_UNIT?.trim() || 'bottle',
      },
    ],
    salesMappings: [{ salesLocationId, inventoryLocationId }],
    recipes: [{ soldSkuId: skuId, componentSkuId: skuId, quantityPerSoldUnit: '1' }],
    alertConfigs: [],
    responsibilities: [],
    permissions: [
      'INVENTORY_MOVE',
      'TRANSFER_MANAGE',
      'COUNT_MANAGE',
      'ALERT_MANAGE',
      'INVENTORY_CONFIGURE',
    ].map((permission) => ({ actorId: operatorActorId, permission })),
  }),
});

const movementIdentity = `pilot-opening:${eventId}:${inventoryLocationId}:${skuId}`;
const opening = await request('/inventory/movements', {
  method: 'POST',
  body: JSON.stringify({
    id: movementIdentity,
    eventId,
    inventoryLocationId,
    skuId,
    movementType: 'RECEIPT',
    quantityDeltaBase: openingStockBase,
    actorId: operatorActorId,
    reason: 'Pilot opening stock',
    occurredAt: openingOccurredAt,
    idempotencyKey: movementIdentity,
  }),
});

const stock = await request(`/inventory/events/${encodeURIComponent(eventId)}/stock`);

console.log(
  JSON.stringify(
    {
      status: 'ready',
      eventId,
      inventoryLocationId,
      skuId,
      openingMovementId: opening?.id ?? movementIdentity,
      configuredOpeningStockBase: openingStockBase,
      stock,
      bootstrapRunId: randomUUID(),
    },
    null,
    2,
  ),
);
