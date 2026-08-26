import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const baselineMigration = readFileSync(
  new URL(
    '../apps/cloud-api/migrations/0020_supabase_data_api_least_privilege.sql',
    import.meta.url,
  ),
  'utf8',
);
const completeDefaultsMigration = readFileSync(
  new URL(
    '../apps/cloud-api/migrations/0021_supabase_data_api_complete_default_privileges.sql',
    import.meta.url,
  ),
  'utf8',
);

function compactSql(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const baselineSql = compactSql(baselineMigration);
const completeDefaultsSql = compactSql(completeDefaultsMigration);

test('Supabase API-role hardening stays portable to non-Supabase PostgreSQL', () => {
  for (const sql of [baselineSql, completeDefaultsSql]) {
    assert.match(sql, /foreach api_role in array array\['anon', 'authenticated', 'service_role'\]/);
    assert.match(sql, /if to_regrole\(api_role\) is null then continue/);
  }
});

test('existing public application objects are removed from Supabase Data API roles', () => {
  assert.match(baselineSql, /revoke all privileges on all tables in schema public from %i/);
  assert.match(baselineSql, /revoke all privileges on all sequences in schema public from %i/);
  assert.match(baselineSql, /revoke execute on all functions in schema public from %i/);
});

test('future public application objects are fully opt-in for Supabase Data API roles', () => {
  assert.match(
    completeDefaultsSql,
    /alter default privileges for role %i in schema public revoke all privileges on tables from %i/,
  );
  assert.match(
    completeDefaultsSql,
    /alter default privileges for role %i in schema public revoke all privileges on sequences from %i/,
  );
  assert.match(
    completeDefaultsSql,
    /alter default privileges for role %i in schema public revoke execute on functions from %i/,
  );
});

test('public function execution is denied now and as a global future default', () => {
  assert.match(baselineSql, /revoke execute on all functions in schema public from public/);
  assert.match(baselineSql, /alter default privileges revoke execute on functions from public/);
  assert.doesNotMatch(
    baselineSql,
    /alter default privileges in schema public revoke execute on functions from public/,
  );
});
