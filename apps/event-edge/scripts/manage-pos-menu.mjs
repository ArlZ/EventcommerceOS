const action = process.argv[2];
if (action !== 'pull') {
  throw new Error('usage: pos-menu pull');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function uuid(name, value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
  return value;
}

function localPort() {
  const raw = process.env.EDGE_LOCAL_ADMIN_PORT?.trim() || process.env.PORT?.trim() || '3002';
  if (!/^\d+$/.test(raw)) throw new Error('EDGE_LOCAL_ADMIN_PORT must be an integer');
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('EDGE_LOCAL_ADMIN_PORT must be between 1 and 65535');
  }
  return port;
}

function installedSnapshots(value) {
  if (!Array.isArray(value)) throw new Error('Event Edge returned an invalid POS menu response');
  return value.map((snapshot, index) => {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new Error(`Event Edge returned an invalid snapshot at index ${index}`);
    }
    const row = snapshot;
    if (
      typeof row.salesLocationId !== 'string' ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1 ||
      typeof row.checksum !== 'string'
    ) {
      throw new Error(`Event Edge returned an invalid snapshot at index ${index}`);
    }
    return {
      salesLocationId: row.salesLocationId,
      version: row.version,
      checksum: row.checksum,
    };
  });
}

const configuredEventId =
  process.env.POS_MENU_EVENT_ID?.trim() || process.env.PILOT_EVENT_ID?.trim() || '';
const eventId = uuid('POS_MENU_EVENT_ID or PILOT_EVENT_ID', configuredEventId);
const adminToken = required('EDGE_LOCAL_ADMIN_TOKEN');
if (adminToken.length < 32) {
  throw new Error('EDGE_LOCAL_ADMIN_TOKEN must contain at least 32 characters');
}

const endpoint = `http://127.0.0.1:${localPort()}/pos-menu/pull/${encodeURIComponent(eventId)}`;
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${adminToken}`,
    accept: 'application/json',
  },
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  const body = (await response.text()).slice(0, 1_000).trim();
  throw new Error(
    `Event Edge POS menu pull failed with HTTP ${response.status}${body ? `: ${body}` : ''}`,
  );
}

const installed = installedSnapshots(await response.json());
if (installed.length === 0) {
  console.log(`No approved POS menu publications were available for event ${eventId}.`);
} else {
  console.log(`Installed ${installed.length} POS menu snapshot(s) for event ${eventId}.`);
  for (const snapshot of installed) {
    console.log(
      `${snapshot.salesLocationId} version=${snapshot.version} checksum=${snapshot.checksum}`,
    );
  }
  console.log(
    'Cloud installation receipts were acknowledged after the local transaction committed.',
  );
}
