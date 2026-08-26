import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const cloudRoot = resolve(root, 'apps', 'cloud-api');
const distMain = resolve(cloudRoot, 'dist', 'main.js');
const releaseIdentity = resolve(cloudRoot, 'dist', 'release-commit.txt');
const migrationsRoot = resolve(cloudRoot, 'migrations');
const probeFilename = '9999_ci_hostinger_managed_entry_probe.sql';
const probeMigration = resolve(migrationsRoot, probeFilename);
const probeTable = 'ci_hostinger_managed_entry_probe';
const port = 32119;

const requireFromCloud = createRequire(resolve(cloudRoot, 'package.json'));
const { Client } = requireFromCloud('pg');

const canExerciseManagedEntry = Boolean(
  process.env.DATABASE_URL && existsSync(distMain) && existsSync(releaseIdentity),
);

test(
  'configured Hostinger Cloud entry applies a pending migration before becoming ready',
  { skip: !canExerciseManagedEntry },
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl);

    const expectedRelease = readFileSync(releaseIdentity, 'utf8').trim();
    assert.match(expectedRelease, /^[0-9a-f]{40}$/);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    let child;
    let stdout = '';
    let stderr = '';

    try {
      await cleanupProbe(client);
      writeFileSync(
        probeMigration,
        `CREATE TABLE ${probeTable} (id integer PRIMARY KEY);\n`,
        'utf8',
      );

      child = spawn(process.execPath, [distMain], {
        cwd: cloudRoot,
        env: {
          ...process.env,
          HOSTINGER_APP_TARGET: 'cloud-api',
          NODE_ENV: 'production',
          PORT: String(port),
          CONTROL_WEB_ORIGIN: 'https://control-pilot.invalid',
          ABUSE_DEPLOYMENT_MODE: 'single_instance_pilot',
          ABUSE_UPSTREAM_CONFIRMED: 'false',
          TRUST_PROXY_HOPS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });

      const health = await waitForHealth(child, stdoutAndStderr);
      assert.equal(health.service, 'cloud-api');
      assert.equal(health.status, 'ok');
      assert.equal(health.releaseCommit, expectedRelease);

      const ledger = await client.query(
        'SELECT checksum_sha256 FROM schema_migrations WHERE filename = $1',
        [probeFilename],
      );
      assert.equal(ledger.rowCount, 1, 'managed entry did not ledger the pending probe migration');
      assert.match(ledger.rows[0].checksum_sha256, /^[0-9a-f]{64}$/);

      const table = await client.query('SELECT to_regclass($1) AS name', [`public.${probeTable}`]);
      assert.equal(table.rows[0].name, probeTable);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([once(child, 'exit'), delay(5_000)]).catch(() => undefined);
      }
      rmSync(probeMigration, { force: true });
      await cleanupProbe(client);
      await client.end();
    }

    function stdoutAndStderr() {
      return `${stdout}\n${stderr}`.trim();
    }
  },
);

async function waitForHealth(child, logs) {
  const url = `http://127.0.0.1:${port}/health`;
  let lastStatus = 'no response';

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`managed Cloud entry exited before readiness\n${logs()}`);
    }
    try {
      const response = await fetch(url);
      lastStatus = `HTTP ${response.status}`;
      if (response.ok) return await response.json();
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }

  throw new Error(`managed Cloud entry did not become ready (${lastStatus})\n${logs()}`);
}

async function cleanupProbe(client) {
  await client.query(`DROP TABLE IF EXISTS ${probeTable}`);
  await client.query('DELETE FROM schema_migrations WHERE filename = $1', [probeFilename]);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
