import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../apps/cloud-api/migrations/0020_supabase_data_api_least_privilege.sql',
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

const sql = compactSql(migration);

test('Supabase API-role hardening stays portable to non-Supabase PostgreSQL', () => {
  assert.match(sql, /foreach api_role in array array\['anon', 'authenticated', 'service_role'\]/);
  assert.match(sql, /if to_regrole\(api_role\) is null then continue/);
});

test('existing public application objects are removed from Supabase Data API roles', () => {
  assert.match(sql, /revoke all privileges on all tables in schema public from %i/);
  assert.match(sql, /revoke all privileges on all sequences in schema public from %i/);
  assert.match(sql, /revoke execute on all functions in schema public from %i/);
});

test('future public application objects are opt-in for Supabase Data API roles', () => {
  assert.match(
    sql,
    /alter default privileges for role %i in schema public revoke select, insert, update, delete on tables from %i/,
  );
  assert.match(
    sql,
    /alter default privileges for role %i in schema public revoke usage, select on sequences from %i/,
  );
  assert.match(
    sql,
    /alter default privileges for role %i in schema public revoke execute on functions from %i/,
  );
});

test('public function execution is denied now and as a global future default', () => {
  assert.match(sql, /revoke execute on all functions in schema public from public/);
  assert.match(sql, /alter default privileges revoke execute on functions from public/);
  assert.doesNotMatch(
    sql,
    /alter default privileges in schema public revoke execute on functions from public/,
  );
});
