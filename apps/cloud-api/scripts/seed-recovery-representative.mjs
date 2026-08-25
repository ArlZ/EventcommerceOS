import pg from 'pg';

const { Client } = pg;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MIN_ORDER_COUNT = 100;
const MAX_ORDER_COUNT = 10_000;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function orderCount() {
  const raw = process.env.RECOVERY_FIXTURE_ORDER_COUNT?.trim() || '250';
  if (!/^\d+$/.test(raw))
    throw new Error('RECOVERY_FIXTURE_ORDER_COUNT must be an integer');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < MIN_ORDER_COUNT || value > MAX_ORDER_COUNT) {
    throw new Error(
      `RECOVERY_FIXTURE_ORDER_COUNT must be between ${MIN_ORDER_COUNT} and ${MAX_ORDER_COUNT}`,
    );
  }
  return value;
}

function parseLocalDatabaseUrl(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `representative recovery fixture is local-only; refusing database host ${url.hostname}`,
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must include a database name');
  return { url, database };
}

function fixedIds() {
  return {
    organisationId: '11111111-1111-4111-8111-111111111111',
    eventId: '22222222-2222-4222-8222-222222222222',
    salesLocationId: '33333333-3333-4333-8333-333333333333',
    productId: '44444444-4444-4444-8444-444444444444',
    skuId: '55555555-5555-4555-8555-555555555555',
    inventoryLocationId: '66666666-6666-4666-8666-666666666666',
    operatorId: '77777777-7777-4777-8777-777777777777',
    closeReportId: '88888888-8888-4888-8888-888888888888',
    edgeId: 'edge-recovery-fixture-001',
  };
}

async function assertDisposableEmpty(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*) FROM public.organisations) AS organisations,
      (SELECT count(*) FROM public.events) AS events,
      (SELECT count(*) FROM public.sync_order_state) AS orders,
      (SELECT count(*) FROM public.payments) AS payments,
      (SELECT count(*) FROM public.inventory_ledger) AS inventory_ledger,
      (SELECT count(*) FROM public.event_close_reports) AS close_reports,
      (SELECT count(*) FROM public.edge_sync_clients) AS edge_clients,
      (SELECT count(*) FROM public.operator_identities) AS operators
  `);
  const counts = result.rows[0] ?? {};
  const populated = Object.entries(counts).filter(
    ([, value]) => BigInt(value ?? 0) > 0n,
  );
  if (populated.length > 0) {
    throw new Error(
      `representative recovery fixture requires an empty disposable database; found data in ${populated
        .map(([name]) => name)
        .join(', ')}`,
    );
  }
}

async function seed(client, count, ids) {
  await client.query(
    `INSERT INTO public.organisations (id, name, lifecycle)
     VALUES ($1, 'Recovery Drill Organisation', 'ACTIVE')`,
    [ids.organisationId],
  );

  await client.query(
    `INSERT INTO public.events
       (id, organisation_id, name, timezone, lifecycle, starts_at, ends_at)
     VALUES
       ($1, $2, 'Representative Recovery Event', 'Africa/Nairobi', 'CLOSED',
        now() - interval '8 hours', now() - interval '1 hour')`,
    [ids.eventId, ids.organisationId],
  );

  await client.query(
    `INSERT INTO public.sales_locations
       (id, organisation_id, event_id, name, type, lifecycle)
     VALUES ($1, $2, $3, 'Main Recovery Bar', 'BAR', 'ACTIVE')`,
    [ids.salesLocationId, ids.organisationId, ids.eventId],
  );

  await client.query(
    `INSERT INTO public.products
       (id, organisation_id, name, category, lifecycle)
     VALUES ($1, $2, 'Recovery Fixture Drink', 'BEVERAGE', 'ACTIVE')`,
    [ids.productId, ids.organisationId],
  );

  await client.query(
    `INSERT INTO public.skus
       (id, organisation_id, product_id, name, code, unit_name, lifecycle)
     VALUES ($1, $2, $3, 'Recovery Fixture Drink 330ml', 'REC-DRINK-330', 'bottle', 'ACTIVE')`,
    [ids.skuId, ids.organisationId, ids.productId],
  );

  await client.query(
    `INSERT INTO public.inventory_locations
       (id, organisation_id, event_id, name, type, lifecycle)
     VALUES ($1, $2, $3, 'Recovery Main Store', 'STORE', 'ACTIVE')`,
    [ids.inventoryLocationId, ids.organisationId, ids.eventId],
  );

  await client.query(
    `INSERT INTO public.operator_identities
       (id, display_name, status)
     VALUES ($1, 'Recovery Drill Operator', 'ACTIVE')`,
    [ids.operatorId],
  );

  await client.query(
    `INSERT INTO public.edge_sync_clients
       (edge_id, organisation_id, credential_sha256, credential_version, status)
     VALUES ($1, $2, repeat('a', 64)::char(64), 1, 'ACTIVE')`,
    [ids.edgeId, ids.organisationId],
  );

  await client.query(
    `INSERT INTO public.sync_order_state
       (order_id, device_id, last_sequence, state, total_minor, currency,
        event_id, sales_location_id, lines, occurred_at, close_method, cashier_id)
     SELECT
       'recovery-order-' || lpad(i::text, 6, '0'),
       'recovery-pos-001',
       i,
       'CLOSED',
       50000 + (i % 7) * 5000,
       'KES',
       $1,
       $2,
       jsonb_build_array(jsonb_build_object(
         'skuId', $3::text,
         'quantity', 1,
         'unitPriceMinor', 50000 + (i % 7) * 5000
       )),
       now() - ((($4 - i) + 1)::text || ' seconds')::interval,
       CASE WHEN i % 3 = 0 THEN 'CASH' ELSE 'PROVIDER' END,
       $5
     FROM generate_series(1, $4::integer) AS series(i)`,
    [ids.eventId, ids.salesLocationId, ids.skuId, count, ids.operatorId],
  );

  await client.query(
    `INSERT INTO public.payments
       (id, event_id, order_id, amount_minor, currency)
     SELECT
       'recovery-payment-' || lpad(i::text, 6, '0'),
       $1,
       'recovery-order-' || lpad(i::text, 6, '0'),
       50000 + (i % 7) * 5000,
       'KES'
     FROM generate_series(1, $2::integer) AS series(i)`,
    [ids.eventId, count],
  );

  await client.query(
    `INSERT INTO public.payment_attempts
       (id, payment_id, provider_id, idempotency_key, status, provider_reference,
        request_fingerprint, initiated_at, resolved_at)
     SELECT
       'recovery-attempt-' || lpad(i::text, 6, '0'),
       'recovery-payment-' || lpad(i::text, 6, '0'),
       'mpesa-sandbox',
       'recovery-attempt-key-' || lpad(i::text, 6, '0'),
       'SUCCEEDED',
       'RECOVERY-MPESA-' || lpad(i::text, 6, '0'),
       md5('recovery-payment-' || i::text),
       now() - ((($1 - i) + 2)::text || ' seconds')::interval,
       now() - ((($1 - i) + 1)::text || ' seconds')::interval
     FROM generate_series(1, $1::integer) AS series(i)`,
    [count],
  );

  await client.query(
    `INSERT INTO public.inventory_edge_events
       (id, event_type, aggregate_type, aggregate_id, payload, edge_id, organisation_id)
     SELECT
       'recovery-inventory-event-' || lpad(i::text, 6, '0'),
       'STOCK_MOVEMENT',
       'SKU',
       $1,
       jsonb_build_object('orderId', 'recovery-order-' || lpad(i::text, 6, '0')),
       $2,
       $3
     FROM generate_series(1, $4::integer) AS series(i)`,
    [ids.skuId, ids.edgeId, ids.organisationId, count],
  );

  await client.query(
    `INSERT INTO public.inventory_ledger
       (id, event_id, inventory_location_id, sku_id, movement_type, quantity_delta,
        source_type, source_id, actor_id, device_id, occurred_at, idempotency_key,
        edge_event_id)
     SELECT
       'recovery-ledger-' || lpad(i::text, 6, '0'),
       $1,
       $2,
       $3,
       'SALE',
       -1,
       'ORDER',
       'recovery-order-' || lpad(i::text, 6, '0'),
       $4,
       'recovery-pos-001',
       now() - ((($5 - i) + 1)::text || ' seconds')::interval,
       'recovery-ledger-key-' || lpad(i::text, 6, '0'),
       'recovery-inventory-event-' || lpad(i::text, 6, '0')
     FROM generate_series(1, $5::integer) AS series(i)`,
    [ids.eventId, ids.inventoryLocationId, ids.skuId, ids.operatorId, count],
  );

  await client.query(
    `INSERT INTO public.audit_events
       (id, organisation_id, actor_id, action, entity_type, entity_id, changes)
     SELECT
       ('90000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
       $1,
       $2,
       'ORDER_CLOSED',
       'ORDER',
       ('a0000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
       jsonb_build_object('fixtureOrder', 'recovery-order-' || lpad(i::text, 6, '0'))
     FROM generate_series(1, $3::integer) AS series(i)`,
    [ids.organisationId, ids.operatorId, count],
  );

  await client.query(
    `INSERT INTO public.event_close_reports
       (id, organisation_id, event_id, revision, source_version_token, report_json,
        report_sha256, created_by_actor_id)
     VALUES
       ($1, $2, $3, 1, 'recovery-fixture-v1',
        json_build_object(
          'fixture', true,
          'orderCount', $4::integer,
          'currency', 'KES',
          'closedAt', now()
        ),
        repeat('b', 64)::char(64),
        $5)`,
    [ids.closeReportId, ids.organisationId, ids.eventId, count, ids.operatorId],
  );
}

async function verify(client, expectedOrders) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM public.organisations) AS organisations,
      (SELECT count(*)::integer FROM public.events) AS events,
      (SELECT count(*)::integer FROM public.sync_order_state) AS orders,
      (SELECT count(*)::integer FROM public.payments) AS payments,
      (SELECT count(*)::integer FROM public.payment_attempts) AS payment_attempts,
      (SELECT count(*)::integer FROM public.inventory_ledger) AS inventory_ledger,
      (SELECT count(*)::integer FROM public.audit_events) AS audit_events,
      (SELECT count(*)::integer FROM public.event_close_reports) AS close_reports,
      (SELECT count(*)::integer FROM public.edge_sync_clients) AS edge_clients,
      (SELECT count(*)::integer FROM public.operator_identities) AS operators
  `);
  const counts = result.rows[0];
  for (const table of [
    'orders',
    'payments',
    'payment_attempts',
    'inventory_ledger',
    'audit_events',
  ]) {
    if (counts[table] !== expectedOrders) {
      throw new Error(
        `${table} fixture count ${counts[table]} did not equal ${expectedOrders}`,
      );
    }
  }
  for (const table of [
    'organisations',
    'events',
    'close_reports',
    'edge_clients',
    'operators',
  ]) {
    if (counts[table] < 1) throw new Error(`${table} fixture is empty`);
  }
  return counts;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('representative recovery fixture refuses NODE_ENV=production');
  }

  const databaseUrl = required('DATABASE_URL');
  const { database } = parseLocalDatabaseUrl(databaseUrl);
  const acknowledgement = required('RECOVERY_FIXTURE_ACK');
  const expectedAcknowledgement = `SEED:${database}`;
  if (acknowledgement !== expectedAcknowledgement) {
    throw new Error(
      `RECOVERY_FIXTURE_ACK must exactly equal ${expectedAcknowledgement}`,
    );
  }

  const count = orderCount();
  const ids = fixedIds();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await assertDisposableEmpty(client);
    await seed(client, count, ids);
    const counts = await verify(client, count);
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        result: 'PASS',
        fixture: 'representative-recovery',
        database,
        orderCount: count,
        counts,
      }),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

await main();
