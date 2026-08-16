import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudScriptDatabaseConnectionString,
  migrationChecksum as cloudMigrationChecksum,
  migrationRecordAction as cloudMigrationRecordAction,
  validateMigrationInventory as validateCloudMigrationInventory,
} from '../apps/cloud-api/scripts/migration-safety.mjs';
import {
  edgeScriptDatabaseConnectionString,
  migrationChecksum as edgeMigrationChecksum,
  migrationRecordAction as edgeMigrationRecordAction,
  validateMigrationInventory as validateEdgeMigrationInventory,
} from '../apps/event-edge/scripts/migration-safety.mjs';

const SQL = 'CREATE TABLE example (id uuid PRIMARY KEY);\n';
const EXPECTED_SHA256 = '1bb152616852268f15b86f7198b4d44af50f9711e269108bbc718eae36737cb6';

test('Cloud production migrations require an explicit database target', () => {
  assert.throws(
    () => cloudScriptDatabaseConnectionString({ NODE_ENV: 'production' }),
    /DATABASE_URL is required for production database tooling/,
  );
  assert.equal(
    cloudScriptDatabaseConnectionString({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://cloud.example/release',
    }),
    'postgresql://cloud.example/release',
  );
});

test('Cloud non-production migration target retains the local fallback', () => {
  assert.match(cloudScriptDatabaseConnectionString({ NODE_ENV: 'test' }), /event_commerce_cloud/);
});

test('Event Edge production migrations require EDGE_DATABASE_URL even when DATABASE_URL exists', () => {
  assert.throws(
    () =>
      edgeScriptDatabaseConnectionString({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://cloud.example/wrong-target',
      }),
    /EDGE_DATABASE_URL is required for production database tooling/,
  );
  assert.equal(
    edgeScriptDatabaseConnectionString({
      NODE_ENV: 'production',
      EDGE_DATABASE_URL: 'postgresql://edge.example/release',
      DATABASE_URL: 'postgresql://cloud.example/wrong-target',
    }),
    'postgresql://edge.example/release',
  );
});

test('Event Edge non-production migrations may use the shared developer database URL', () => {
  assert.equal(
    edgeScriptDatabaseConnectionString({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost/shared-dev',
    }),
    'postgresql://localhost/shared-dev',
  );
});

test('migration checksums are deterministic lowercase SHA-256 across Cloud and Edge', () => {
  assert.equal(cloudMigrationChecksum(SQL), EXPECTED_SHA256);
  assert.equal(edgeMigrationChecksum(SQL), EXPECTED_SHA256);
  assert.match(cloudMigrationChecksum(SQL), /^[a-f0-9]{64}$/);
});

for (const [name, action, validateInventory] of [
  ['Cloud', cloudMigrationRecordAction, validateCloudMigrationInventory],
  ['Event Edge', edgeMigrationRecordAction, validateEdgeMigrationInventory],
]) {
  test(`${name} migration ledger baselines legacy rows with no checksum`, () => {
    assert.equal(action(null, EXPECTED_SHA256), 'BASELINE');
  });

  test(`${name} migration ledger accepts an exact checksum match`, () => {
    assert.equal(action(EXPECTED_SHA256, EXPECTED_SHA256), 'MATCH');
  });

  test(`${name} migration ledger rejects applied migration byte drift`, () => {
    assert.throws(
      () => action('0'.repeat(64), EXPECTED_SHA256),
      /Applied migration checksum mismatch/,
    );
  });

  test(`${name} migration inventory accepts append-only forward history`, () => {
    assert.doesNotThrow(() =>
      validateInventory(
        ['0001_initial.sql', '0002_forward.sql', '0003_next.sql'],
        ['0001_initial.sql', '0002_forward.sql'],
      ),
    );
  });

  test(`${name} migration inventory rejects a deleted or renamed applied file`, () => {
    assert.throws(
      () => validateInventory(['0002_forward.sql'], ['0001_initial.sql', '0002_forward.sql']),
      /Applied migration file missing from repository: 0001_initial.sql/,
    );
  });

  test(`${name} migration inventory rejects an out-of-order backfill`, () => {
    assert.throws(
      () =>
        validateInventory(
          ['0001_initial.sql', '0002_backfill.sql', '0003_existing.sql'],
          ['0001_initial.sql', '0003_existing.sql'],
        ),
      /Unapplied migration sorts before existing history: 0002_backfill.sql/,
    );
  });
}
