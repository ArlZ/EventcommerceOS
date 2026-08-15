import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const evidenceDir = path.resolve(root, process.env.SCA_EVIDENCE_DIR ?? 'artifacts/sca');
const acceptancePath = path.resolve(root, 'security/sca-acceptances.json');
const osvBase = (process.env.SCA_OSV_API_BASE ?? 'https://api.osv.dev/v1').replace(/\/+$/, '');
const requireCleanGit = process.env.SCA_REQUIRE_CLEAN_GIT !== 'false';
const maxAcceptanceMs = 90 * 24 * 60 * 60 * 1000;

if (!osvBase.startsWith('https://')) {
  throw new Error('SCA_OSV_API_BASE must use HTTPS');
}

function sanitized(value) {
  return String(value)
    .replace(/https?:\/\/[^/@\s]+:[^/@\s]+@/g, 'https://[redacted]@')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(token|password|secret)=([^\s&]+)/gi, '$1=[redacted]');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, CI: process.env.CI ?? '1' },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status ?? 'unknown'}): ${sanitized(
        result.stderr || result.stdout,
      ).slice(0, 4000)}`,
    );
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function normalizeVersion(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/^v(?=\d)/, '');
  if (!trimmed || /^(link:|workspace:|file:|git\+|github:|https?:)/i.test(trimmed)) return undefined;
  const withoutPeers = trimmed.split('(')[0]?.trim();
  if (!withoutPeers || !/^\d/.test(withoutPeers)) return undefined;
  return withoutPeers;
}

function inventoryKey(item) {
  return `${item.ecosystem}\u0000${item.name}\u0000${item.version}`;
}

function addInventory(target, item, scope) {
  const version = normalizeVersion(item.version);
  if (!version || typeof item.name !== 'string' || !item.name.trim()) return;
  const normalized = {
    ecosystem: item.ecosystem,
    name: item.name.trim(),
    version,
  };
  const key = inventoryKey(normalized);
  const existing = target.get(key);
  if (existing) {
    existing.scopes.add(scope);
    return;
  }
  target.set(key, { ...normalized, scopes: new Set([scope]) });
}

function collectDependencyMaps(node, target, inheritedScope = 'workspace') {
  if (!node || typeof node !== 'object') return;
  const sections = [
    ['dependencies', 'production'],
    ['optionalDependencies', 'optional'],
    ['devDependencies', 'development'],
  ];
  for (const [section, scope] of sections) {
    const map = node[section];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [declaredName, raw] of Object.entries(map)) {
      if (typeof raw === 'string') {
        addInventory(target, { ecosystem: 'npm', name: declaredName, version: raw }, scope);
        continue;
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const actualName = typeof raw.name === 'string' ? raw.name : declaredName;
      addInventory(target, { ecosystem: 'npm', name: actualName, version: raw.version }, scope);
      collectDependencyMaps(raw, target, scope ?? inheritedScope);
    }
  }
}

function collectNpmInventory() {
  const result = run('pnpm', ['list', '--recursive', '--json', '--depth', 'Infinity']);
  let projects;
  try {
    projects = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`pnpm dependency inventory was not valid JSON: ${sanitized(error)}`);
  }
  const target = new Map();
  for (const project of Array.isArray(projects) ? projects : [projects]) {
    collectDependencyMaps(project, target);
  }
  return target;
}

async function collectAndroidInventory() {
  const result = run('gradle', ['-q', '-p', 'apps/pos-android', 'app:scaResolvedDependencies']);
  const target = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.startsWith('SCA_DEP\t')) continue;
    const [, group, name, version, configuration] = line.split('\t');
    if (!group || !name || !version || !configuration) continue;
    addInventory(
      target,
      { ecosystem: 'Maven', name: `${group}:${name}`, version },
      `gradle:${configuration}`,
    );
  }

  const rootGradle = await readFile(path.join(root, 'apps/pos-android/build.gradle.kts'), 'utf8');
  const pluginCoordinates = new Map([
    ['com.android.application', 'com.android.tools.build:gradle'],
    ['org.jetbrains.kotlin.android', 'org.jetbrains.kotlin:kotlin-gradle-plugin'],
    ['org.jetbrains.kotlin.plugin.compose', 'org.jetbrains.kotlin:compose-compiler-gradle-plugin'],
    ['com.google.devtools.ksp', 'com.google.devtools.ksp:symbol-processing-gradle-plugin'],
  ]);
  const pluginRegex = /id\("([^"]+)"\)\s+version\s+"([^"]+)"/g;
  for (const match of rootGradle.matchAll(pluginRegex)) {
    const pluginId = match[1];
    const version = match[2];
    const coordinate = pluginCoordinates.get(pluginId);
    if (!coordinate || !version) continue;
    addInventory(target, { ecosystem: 'Maven', name: coordinate, version }, `gradle-plugin:${pluginId}`);
  }
  return target;
}

function materializeInventory(map) {
  return [...map.values()]
    .map((item) => ({
      ecosystem: item.ecosystem,
      name: item.name,
      version: item.version,
      scopes: [...item.scopes].sort(),
    }))
    .sort((a, b) =>
      `${a.ecosystem}:${a.name}:${a.version}`.localeCompare(`${b.ecosystem}:${b.name}:${b.version}`),
    );
}

async function fetchJson(url, init = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'user-agent': 'event-commerce-os-sca/1',
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`OSV request failed after ${attempts} attempts: ${sanitized(lastError)}`);
}

async function queryOsv(inventory) {
  const idsByIndex = inventory.map(() => new Set());
  const pageCounts = inventory.map(() => 0);
  let pending = inventory.map((item, index) => ({ item, index, pageToken: undefined }));

  while (pending.length > 0) {
    const chunk = pending.splice(0, 500);
    const payload = {
      queries: chunk.map(({ item, pageToken }) => ({
        package: { ecosystem: item.ecosystem, name: item.name },
        version: item.version,
        ...(pageToken ? { page_token: pageToken } : {}),
      })),
    };
    const response = await fetchJson(`${osvBase}/querybatch`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!Array.isArray(response.results) || response.results.length !== chunk.length) {
      throw new Error('OSV querybatch returned an unexpected result count');
    }
    response.results.forEach((result, position) => {
      const query = chunk[position];
      if (!query) return;
      for (const vuln of Array.isArray(result?.vulns) ? result.vulns : []) {
        if (typeof vuln?.id === 'string' && vuln.id) idsByIndex[query.index].add(vuln.id);
      }
      if (typeof result?.next_page_token === 'string' && result.next_page_token) {
        pageCounts[query.index] += 1;
        if (pageCounts[query.index] > 20) {
          throw new Error(`OSV pagination exceeded 20 pages for ${query.item.name}@${query.item.version}`);
        }
        pending.push({ ...query, pageToken: result.next_page_token });
      }
    });
  }

  const uniqueIds = [...new Set(idsByIndex.flatMap((set) => [...set]))].sort();
  const records = new Map();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, Math.max(1, uniqueIds.length)) }, async () => {
    while (cursor < uniqueIds.length) {
      const position = cursor;
      cursor += 1;
      const id = uniqueIds[position];
      if (!id) continue;
      const record = await fetchJson(`${osvBase}/vulns/${encodeURIComponent(id)}`);
      records.set(id, record);
    }
  });
  await Promise.all(workers);

  return { idsByIndex, records };
}

const severityRank = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4, UNKNOWN: 5 };

function normalizeSeverity(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'MEDIUM') return 'MODERATE';
  if (normalized in severityRank) return normalized;
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    if (numeric >= 9) return 'CRITICAL';
    if (numeric >= 7) return 'HIGH';
    if (numeric >= 4) return 'MODERATE';
    if (numeric > 0) return 'LOW';
  }
  return undefined;
}

function advisorySeverity(record, item) {
  const candidates = [];
  candidates.push(record?.database_specific?.severity);
  for (const affected of Array.isArray(record?.affected) ? record.affected : []) {
    const pkg = affected?.package;
    if (pkg?.ecosystem === item.ecosystem && pkg?.name === item.name) {
      candidates.push(affected?.ecosystem_specific?.severity, affected?.database_specific?.severity);
    }
  }
  for (const severity of Array.isArray(record?.severity) ? record.severity : []) {
    candidates.push(severity?.score);
  }
  const normalized = candidates.map(normalizeSeverity).filter(Boolean);
  if (normalized.length === 0) return 'UNKNOWN';
  return normalized.sort((a, b) => severityRank[b] - severityRank[a])[0];
}

function advisoryUrl(record) {
  const references = Array.isArray(record?.references) ? record.references : [];
  const advisory = references.find((reference) => reference?.type === 'ADVISORY' && reference?.url);
  const first = references.find((reference) => typeof reference?.url === 'string');
  return advisory?.url ?? first?.url ?? null;
}

function acceptanceKey(value) {
  return `${value.vulnerabilityId}\u0000${value.ecosystem}\u0000${value.packageName}\u0000${value.version}`;
}

async function loadAcceptances(now) {
  const parsed = JSON.parse(await readFile(acceptancePath, 'utf8'));
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.acceptances)) {
    throw new Error('security/sca-acceptances.json must have schemaVersion 1 and an acceptances array');
  }
  const map = new Map();
  const validationErrors = [];
  for (const [index, entry] of parsed.acceptances.entries()) {
    const label = `acceptances[${index}]`;
    const required = ['vulnerabilityId', 'ecosystem', 'packageName', 'version', 'acceptedAt', 'expiresAt', 'approvedBy', 'reason'];
    for (const key of required) {
      if (typeof entry?.[key] !== 'string' || !entry[key].trim()) {
        validationErrors.push(`${label}.${key} is required`);
      }
    }
    if (typeof entry?.reason === 'string' && entry.reason.trim().length < 20) {
      validationErrors.push(`${label}.reason must be at least 20 characters`);
    }
    const acceptedAt = Date.parse(entry?.acceptedAt ?? '');
    const expiresAt = Date.parse(entry?.expiresAt ?? '');
    if (!Number.isFinite(acceptedAt) || !Number.isFinite(expiresAt)) {
      validationErrors.push(`${label} acceptedAt/expiresAt must be RFC3339 timestamps`);
    } else {
      if (acceptedAt > now) validationErrors.push(`${label}.acceptedAt cannot be in the future`);
      if (expiresAt <= now) validationErrors.push(`${label} is expired`);
      if (expiresAt <= acceptedAt) validationErrors.push(`${label}.expiresAt must be after acceptedAt`);
      if (expiresAt - acceptedAt > maxAcceptanceMs) {
        validationErrors.push(`${label} may not exceed 90 days`);
      }
    }
    const key = acceptanceKey(entry ?? {});
    if (map.has(key)) validationErrors.push(`${label} duplicates another acceptance`);
    else map.set(key, entry);
  }
  return { map, validationErrors, entries: parsed.acceptances };
}

function commandVersion(command, args) {
  const result = run(command, args, { allowFailure: true });
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return result.status === 0 ? text.slice(0, 1000) : `unavailable (${result.status})`;
}

function resolveCommit() {
  const explicit = process.env.SCA_RELEASE_COMMIT?.trim() || process.env.GITHUB_SHA?.trim();
  const value = explicit || run('git', ['rev-parse', 'HEAD']).stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error('Release commit must be a 40-character git SHA');
  return value.toLowerCase();
}

function gitState() {
  const result = run('git', ['status', '--porcelain'], { allowFailure: true });
  if (result.status !== 0) return { available: false, clean: false };
  return { available: true, clean: result.stdout.trim().length === 0 };
}

function blockingSeverity(severity) {
  return severity === 'HIGH' || severity === 'CRITICAL' || severity === 'UNKNOWN';
}

async function writeEvidence(evidence, filename) {
  await mkdir(evidenceDir, { recursive: true });
  const target = path.join(evidenceDir, filename);
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return target;
}

async function main() {
  const generatedAt = new Date();
  const commit = resolveCommit();
  const git = gitState();
  const errors = [];
  if (requireCleanGit && (!git.available || !git.clean)) {
    errors.push('Release SCA evidence requires a clean git working tree');
  }

  const npmMap = collectNpmInventory();
  const androidMap = await collectAndroidInventory();
  const npmInventory = materializeInventory(npmMap);
  const androidInventory = materializeInventory(androidMap);
  if (npmInventory.length === 0) errors.push('npm inventory is empty');
  if (androidInventory.length === 0) errors.push('Android/Maven inventory is empty');

  const inventory = [...npmInventory, ...androidInventory].sort((a, b) =>
    `${a.ecosystem}:${a.name}:${a.version}`.localeCompare(`${b.ecosystem}:${b.name}:${b.version}`),
  );
  const { map: acceptances, validationErrors, entries } = await loadAcceptances(generatedAt.getTime());
  errors.push(...validationErrors);

  const { idsByIndex, records } = await queryOsv(inventory);
  const findings = [];
  const matchedAcceptanceKeys = new Set();
  inventory.forEach((item, index) => {
    for (const id of [...idsByIndex[index]].sort()) {
      const record = records.get(id);
      if (!record) throw new Error(`OSV record ${id} was not returned`);
      const severity = advisorySeverity(record, item);
      const key = acceptanceKey({
        vulnerabilityId: id,
        ecosystem: item.ecosystem,
        packageName: item.name,
        version: item.version,
      });
      const acceptance = acceptances.get(key);
      if (acceptance) matchedAcceptanceKeys.add(key);
      findings.push({
        vulnerabilityId: id,
        severity,
        ecosystem: item.ecosystem,
        packageName: item.name,
        version: item.version,
        scopes: item.scopes,
        summary: typeof record.summary === 'string' ? record.summary : null,
        aliases: Array.isArray(record.aliases) ? record.aliases.filter((alias) => typeof alias === 'string') : [],
        modified: typeof record.modified === 'string' ? record.modified : null,
        advisoryUrl: advisoryUrl(record),
        accepted: Boolean(acceptance),
        acceptance: acceptance
          ? {
              acceptedAt: acceptance.acceptedAt,
              expiresAt: acceptance.expiresAt,
              approvedBy: acceptance.approvedBy,
              reason: acceptance.reason,
            }
          : null,
        blocking: blockingSeverity(severity) && !acceptance,
      });
    }
  });

  const blockers = findings.filter((finding) => finding.blocking);
  const unusedAcceptances = entries
    .filter((entry) => !matchedAcceptanceKeys.has(acceptanceKey(entry)))
    .map((entry) => ({
      vulnerabilityId: entry.vulnerabilityId,
      ecosystem: entry.ecosystem,
      packageName: entry.packageName,
      version: entry.version,
      expiresAt: entry.expiresAt,
    }));

  const status = errors.length === 0 && blockers.length === 0 ? 'PASS' : 'FAIL';
  const evidence = {
    schemaVersion: 1,
    status,
    generatedAt: generatedAt.toISOString(),
    releaseCommit: commit,
    git,
    scanner: {
      source: 'OSV.dev API v1',
      apiBase: osvBase,
      failureMode: 'fail-closed',
    },
    tools: {
      node: process.version,
      pnpm: commandVersion('pnpm', ['--version']),
      java: commandVersion('java', ['-version']),
      gradle: commandVersion('gradle', ['--version']),
      platform: process.platform,
      arch: process.arch,
    },
    inventory: {
      npmCount: npmInventory.length,
      mavenCount: androidInventory.length,
      totalCount: inventory.length,
      packages: inventory,
    },
    summary: {
      findingCount: findings.length,
      critical: findings.filter((finding) => finding.severity === 'CRITICAL').length,
      high: findings.filter((finding) => finding.severity === 'HIGH').length,
      moderate: findings.filter((finding) => finding.severity === 'MODERATE').length,
      low: findings.filter((finding) => finding.severity === 'LOW').length,
      unknown: findings.filter((finding) => finding.severity === 'UNKNOWN').length,
      accepted: findings.filter((finding) => finding.accepted).length,
      blocking: blockers.length,
      unusedAcceptances: unusedAcceptances.length,
    },
    findings,
    unusedAcceptances,
    errors,
  };

  const target = await writeEvidence(evidence, `sca-evidence-${commit.slice(0, 12)}.json`);
  console.log(
    `SCA ${status}: ${inventory.length} dependencies, ${findings.length} findings, ${blockers.length} blocking. Evidence: ${path.relative(root, target)}`,
  );
  if (status !== 'PASS') process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  const message = sanitized(error instanceof Error ? error.message : error);
  const failed = {
    schemaVersion: 1,
    status: 'FAIL',
    generatedAt: new Date().toISOString(),
    releaseCommit: process.env.SCA_RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? null,
    scanner: { source: 'OSV.dev API v1', apiBase: osvBase, failureMode: 'fail-closed' },
    errors: [message],
  };
  const target = await writeEvidence(failed, 'sca-evidence-failed.json');
  console.error(`SCA FAIL: ${message}. Evidence: ${path.relative(root, target)}`);
  process.exitCode = 1;
}
