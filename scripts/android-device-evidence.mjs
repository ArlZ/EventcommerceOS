import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const APPLICATION_ID = 'com.eventcommerce.pos';
const APK_NAME = 'event-commerce-pos-controlled-pilot.apk';
const MANIFEST_NAME = 'release-manifest.json';

function fail(message) {
  throw new Error(message);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateReleaseManifest(manifest) {
  const blockers = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['release-manifest.json must contain a JSON object.'];
  }
  if (manifest.schemaVersion !== 1) blockers.push('schemaVersion must equal 1.');
  if (!SHA_PATTERN.test(manifest.releaseCommit ?? '')) {
    blockers.push('releaseCommit must be a lowercase 40-character Git SHA.');
  }
  if (!nonEmpty(manifest.workflowRunId)) blockers.push('workflowRunId is required.');
  if (manifest.repository !== 'ArlZ/EventcommerceOS') {
    blockers.push('repository must be ArlZ/EventcommerceOS.');
  }
  if (manifest.buildType !== 'release') blockers.push('buildType must be release.');
  if (manifest.validationOnly !== false) blockers.push('validationOnly must be false.');
  if (manifest.applicationId !== APPLICATION_ID) {
    blockers.push(`applicationId must be ${APPLICATION_ID}.`);
  }
  if (!nonEmpty(manifest.versionName)) blockers.push('versionName is required.');
  if (!nonEmpty(manifest.versionCode)) blockers.push('versionCode is required.');
  if (manifest.signingKeyClass !== 'controlled-pilot-secret') {
    blockers.push('signingKeyClass must be controlled-pilot-secret.');
  }
  if (manifest.warning !== null) {
    blockers.push('warning must be null for a controlled-pilot build.');
  }

  const apk = manifest.apk;
  if (!apk || typeof apk !== 'object' || Array.isArray(apk)) {
    blockers.push('apk metadata is required.');
  } else {
    if (apk.name !== APK_NAME) blockers.push(`apk.name must be ${APK_NAME}.`);
    if (!SHA256_PATTERN.test(apk.sha256 ?? '')) blockers.push('apk.sha256 is invalid.');
    if (!SHA256_PATTERN.test(apk.signerCertificateSha256 ?? '')) {
      blockers.push('apk.signerCertificateSha256 is invalid.');
    }
    if (apk.signed !== true) blockers.push('apk.signed must be true.');
    if (apk.debuggable !== false) blockers.push('apk.debuggable must be false.');
  }

  return blockers;
}

export function parseApkSigner(output) {
  const match = output.match(/certificate SHA-256 digest:\s*([0-9a-f:]+)/i);
  if (!match) return null;
  const digest = match[1].replaceAll(':', '').toLowerCase();
  return SHA256_PATTERN.test(digest) ? digest : null;
}

export function parseAdbDevices(output) {
  const devices = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('List of devices attached')) continue;
    const [serial, state, ...metadataParts] = line.split(/\s+/);
    if (!serial || !state) continue;
    const metadata = {};
    for (const part of metadataParts) {
      const separator = part.indexOf(':');
      if (separator > 0) metadata[part.slice(0, separator)] = part.slice(separator + 1);
    }
    devices.push({ serial, state, metadata });
  }
  return devices;
}

export function parseDumpsysPackage(output) {
  const versionName = output.match(/^\s*versionName=(.+)$/m)?.[1]?.trim() ?? '';
  const versionCode = output.match(/^\s*versionCode=(\d+)/m)?.[1] ?? '';
  const firstInstallTime = output.match(/^\s*firstInstallTime=(.+)$/m)?.[1]?.trim() ?? '';
  const lastUpdateTime = output.match(/^\s*lastUpdateTime=(.+)$/m)?.[1]?.trim() ?? '';
  return { versionName, versionCode, firstInstallTime, lastUpdateTime };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command),
    windowsHide: true,
    ...options,
  });
  if (result.error) {
    fail(`${basename(command)} could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(nonEmpty).join('\n').trim();
    fail(`${basename(command)} failed${detail ? `: ${detail}` : '.'}`);
  }
  return result.stdout ?? '';
}

function sdkExecutable(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  if (name === 'adb') {
    const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const candidate = join(sdk, 'platform-tools', executable);
    return existsSync(candidate) ? candidate : null;
  }
  if (name === 'apksigner') {
    const root = join(sdk, 'build-tools');
    if (!existsSync(root)) return null;
    const executable = process.platform === 'win32' ? 'apksigner.bat' : 'apksigner';
    const versions = readdirSync(root)
      .filter((entry) => statSync(join(root, entry)).isDirectory())
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = join(root, version, executable);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function adbExecutable() {
  return process.env.ADB || sdkExecutable('adb') || 'adb';
}

function apksignerExecutable() {
  return process.env.APKSIGNER || sdkExecutable('apksigner') || 'apksigner';
}

function parseArgs(argv) {
  const command = argv[0];
  if (!['verify', 'install'].includes(command)) {
    return { command: null, options: {} };
  }
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function loadReviewedArtifact(artifactDir) {
  const root = resolve(artifactDir);
  const manifestPath = join(root, MANIFEST_NAME);
  const apkPath = join(root, APK_NAME);
  if (!existsSync(manifestPath)) fail(`Missing ${MANIFEST_NAME} in ${root}.`);
  if (!existsSync(apkPath)) fail(`Missing ${APK_NAME} in ${root}.`);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`Unable to parse ${MANIFEST_NAME}: ${detail}`);
  }

  const blockers = validateReleaseManifest(manifest);
  if (blockers.length > 0) {
    fail(`Controlled-pilot manifest is not installable:\n- ${blockers.join('\n- ')}`);
  }

  const actualApkSha = sha256File(apkPath);
  if (actualApkSha !== manifest.apk.sha256) {
    fail(`APK SHA-256 mismatch: manifest=${manifest.apk.sha256} actual=${actualApkSha}`);
  }

  const signerOutput = run(apksignerExecutable(), [
    'verify',
    '--verbose',
    '--print-certs',
    apkPath,
  ]);
  if (!/Verifies/i.test(signerOutput)) {
    fail('apksigner did not report a successful verification.');
  }
  const actualSigner = parseApkSigner(signerOutput);
  if (!actualSigner) fail('Unable to extract APK signer certificate SHA-256.');
  if (actualSigner !== manifest.apk.signerCertificateSha256) {
    fail(
      `APK signer mismatch: manifest=${manifest.apk.signerCertificateSha256} actual=${actualSigner}`,
    );
  }

  return { root, manifestPath, apkPath, manifest, actualApkSha, actualSigner };
}

function selectDevice(adb, requestedSerial) {
  const devices = parseAdbDevices(run(adb, ['devices', '-l']));
  const unauthorized = devices.filter((device) => device.state !== 'device');
  if (requestedSerial) {
    const selected = devices.find((device) => device.serial === requestedSerial);
    if (!selected) fail(`Requested ADB device ${requestedSerial} is not connected.`);
    if (selected.state !== 'device') {
      fail(`Requested ADB device ${requestedSerial} is ${selected.state}, not authorized/ready.`);
    }
    return selected;
  }

  const ready = devices.filter((device) => device.state === 'device');
  if (ready.length !== 1) {
    const summary = devices.map((device) => `${device.serial}:${device.state}`).join(', ');
    const detail = summary || 'none';
    fail(`Exactly one authorized ADB device is required unless --serial is supplied; found ${detail}.`);
  }
  if (unauthorized.length > 0) {
    const detail = unauthorized.map((device) => `${device.serial}:${device.state}`).join(', ');
    console.warn(`Warning: ignoring non-ready ADB device(s): ${detail}`);
  }
  return ready[0];
}

function adbFor(adb, serial, args) {
  return run(adb, ['-s', serial, ...args]);
}

function deviceProperty(adb, serial, property) {
  return adbFor(adb, serial, ['shell', 'getprop', property]).trim();
}

function batteryLevel(adb, serial) {
  const output = adbFor(adb, serial, ['shell', 'dumpsys', 'battery']);
  return output.match(/^\s*level:\s*(\d+)/m)?.[1] ?? '';
}

function verifyInstalledPackage(adb, serial, manifest) {
  const packagePath = adbFor(adb, serial, [
    'shell',
    'pm',
    'path',
    APPLICATION_ID,
  ]).trim();
  if (!packagePath.startsWith('package:')) {
    fail(`Installed ${APPLICATION_ID} package path was not found.`);
  }
  const packageInfo = parseDumpsysPackage(
    adbFor(adb, serial, ['shell', 'dumpsys', 'package', APPLICATION_ID]),
  );
  if (packageInfo.versionName !== manifest.versionName) {
    fail(
      `Installed versionName mismatch: expected=${manifest.versionName} actual=${packageInfo.versionName || '<missing>'}`,
    );
  }
  if (packageInfo.versionCode !== String(manifest.versionCode)) {
    fail(
      `Installed versionCode mismatch: expected=${manifest.versionCode} actual=${packageInfo.versionCode || '<missing>'}`,
    );
  }
  return { packagePath, ...packageInfo };
}

function installCommand(artifact, options) {
  if (!nonEmpty(options['asset-id'])) {
    fail('install requires --asset-id <controlled-device-asset-id>.');
  }
  const adb = adbExecutable();
  const device = selectDevice(adb, options.serial);

  const installOutput = adbFor(adb, device.serial, [
    'install',
    '-r',
    artifact.apkPath,
  ]).trim();
  if (!/Success/i.test(installOutput)) {
    fail(`ADB install did not report Success: ${installOutput}`);
  }

  const installed = verifyInstalledPackage(adb, device.serial, artifact.manifest);
  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    tool: 'scripts/android-device-evidence.mjs',
    artifact: {
      releaseCommit: artifact.manifest.releaseCommit,
      workflowRunId: artifact.manifest.workflowRunId,
      applicationId: APPLICATION_ID,
      versionName: artifact.manifest.versionName,
      versionCode: String(artifact.manifest.versionCode),
      apkSha256: artifact.actualApkSha,
      signerCertificateSha256: artifact.actualSigner,
      signed: true,
      debuggable: false,
      validationOnly: false,
      signingKeyClass: artifact.manifest.signingKeyClass,
    },
    device: {
      assetId: options['asset-id'].trim(),
      adbSerial: device.serial,
      manufacturer: deviceProperty(adb, device.serial, 'ro.product.manufacturer'),
      model: deviceProperty(adb, device.serial, 'ro.product.model'),
      androidVersion: deviceProperty(adb, device.serial, 'ro.build.version.release'),
      sdk: deviceProperty(adb, device.serial, 'ro.build.version.sdk'),
      timezone: deviceProperty(adb, device.serial, 'persist.sys.timezone'),
      batteryLevelPercent: batteryLevel(adb, device.serial),
    },
    installation: {
      adbResult: installOutput,
      packagePath: installed.packagePath,
      installedVersionName: installed.versionName,
      installedVersionCode: installed.versionCode,
      firstInstallTime: installed.firstInstallTime,
      lastUpdateTime: installed.lastUpdateTime,
    },
  };

  const safeAssetId = options['asset-id'].replaceAll(/[^a-zA-Z0-9._-]/g, '_');
  const defaultOutput = join(artifact.root, `device-evidence-${safeAssetId}.json`);
  const outputPath = resolve(options.output || defaultOutput);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log('Controlled-pilot device installation: PASS');
  console.log(`Release: ${artifact.manifest.releaseCommit}`);
  console.log(`APK SHA-256: ${artifact.actualApkSha}`);
  console.log(`Signer SHA-256: ${artifact.actualSigner}`);
  console.log(`Device asset: ${evidence.device.assetId}`);
  console.log(`Evidence: ${outputPath}`);
}

function verifyCommand(artifact) {
  console.log('Controlled-pilot artifact verification: PASS');
  console.log(`Release: ${artifact.manifest.releaseCommit}`);
  console.log(`APK SHA-256: ${artifact.actualApkSha}`);
  console.log(`Signer SHA-256: ${artifact.actualSigner}`);
  const version = `${artifact.manifest.versionName} (${artifact.manifest.versionCode})`;
  console.log(`Application: ${APPLICATION_ID} ${version}`);
}

function usage() {
  console.log('Usage:');
  console.log('  node scripts/android-device-evidence.mjs verify --artifact-dir <dir>');
  console.log(
    '  node scripts/android-device-evidence.mjs install --artifact-dir <dir> --asset-id <id> [--serial <adb-serial>] [--output <evidence.json>]',
  );
  console.log('');
  console.log('Environment overrides: ADB, APKSIGNER, ANDROID_HOME, ANDROID_SDK_ROOT.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    if (!command || !nonEmpty(options['artifact-dir'])) {
      usage();
      process.exitCode = 2;
    } else {
      const artifact = loadReviewedArtifact(options['artifact-dir']);
      if (command === 'verify') verifyCommand(artifact);
      else installCommand(artifact, options);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Android controlled-pilot device evidence failed: ${detail}`);
    process.exitCode = 1;
  }
}
