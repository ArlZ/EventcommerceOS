import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAdbDevices,
  parseApkSigner,
  parseDumpsysPackage,
  validateReleaseManifest,
} from './android-device-evidence.mjs';

const RELEASE = '91a206ab7657c26953dd08fd7290beaf0efc8e07';
const APK_SHA = 'a'.repeat(64);
const SIGNER_SHA = 'b'.repeat(64);

function validManifest() {
  return {
    schemaVersion: 1,
    releaseCommit: RELEASE,
    workflowRunId: '32861520073',
    repository: 'ArlZ/EventcommerceOS',
    buildType: 'release',
    validationOnly: false,
    applicationId: 'com.eventcommerce.pos',
    versionName: '0.1.0',
    versionCode: '1',
    apk: {
      name: 'event-commerce-pos-controlled-pilot.apk',
      sha256: APK_SHA,
      signerCertificateSha256: SIGNER_SHA,
      signed: true,
      debuggable: false,
    },
    signingKeyClass: 'controlled-pilot-secret',
    warning: null,
  };
}

test('controlled-pilot manifest accepts installable release provenance', () => {
  assert.deepEqual(validateReleaseManifest(validManifest()), []);
});

test('controlled-pilot manifest rejects validation-only or debuggable builds', () => {
  const manifest = validManifest();
  manifest.validationOnly = true;
  manifest.apk.debuggable = true;
  const blockers = validateReleaseManifest(manifest);
  assert.ok(blockers.includes('validationOnly must be false.'));
  assert.ok(blockers.includes('apk.debuggable must be false.'));
});

test('controlled-pilot manifest rejects invalid identity and signer metadata', () => {
  const manifest = validManifest();
  manifest.repository = 'someone/else';
  manifest.applicationId = 'com.example.other';
  manifest.apk.signerCertificateSha256 = 'not-a-digest';
  const blockers = validateReleaseManifest(manifest);
  assert.ok(blockers.includes('repository must be ArlZ/EventcommerceOS.'));
  assert.ok(blockers.includes('applicationId must be com.eventcommerce.pos.'));
  assert.ok(blockers.includes('apk.signerCertificateSha256 is invalid.'));
});

test('APK signer parser normalizes colon-delimited SHA-256 output', () => {
  const digest = '12:D1:C1:1A:FF:F7:F2:B5:89:BC:CA:FA:4D:B7:EF:51:47:F7:C9:C1:22:5B:4F:07:28:FC:DD:3A:A5:B7:64:2F';
  assert.equal(
    parseApkSigner(`Signer #1 certificate SHA-256 digest: ${digest}\n`),
    '12d1c11afff7f2b589bccafa4db7ef5147f7c9c1225b4f0728fcdd3aa5b7642f',
  );
  assert.equal(parseApkSigner('Signer #1 certificate DN: CN=Example'), null);
});

test('ADB device parser retains readiness and metadata', () => {
  const devices = parseAdbDevices(
    `List of devices attached\nR58M123456A device product:foo model:Galaxy_A15 device:a15 transport_id:1\nemulator-5554 unauthorized transport_id:2\n\n`,
  );
  assert.deepEqual(devices, [
    {
      serial: 'R58M123456A',
      state: 'device',
      metadata: {
        product: 'foo',
        model: 'Galaxy_A15',
        device: 'a15',
        transport_id: '1',
      },
    },
    {
      serial: 'emulator-5554',
      state: 'unauthorized',
      metadata: { transport_id: '2' },
    },
  ]);
});

test('dumpsys package parser extracts installed release identity', () => {
  const parsed = parseDumpsysPackage(
    `Packages:\n  Package [com.eventcommerce.pos] (123):\n    versionCode=1 minSdk=26 targetSdk=35\n    versionName=0.1.0\n    firstInstallTime=2026-08-25 17:00:00\n    lastUpdateTime=2026-08-25 17:10:00\n`,
  );
  assert.deepEqual(parsed, {
    versionName: '0.1.0',
    versionCode: '1',
    firstInstallTime: '2026-08-25 17:00:00',
    lastUpdateTime: '2026-08-25 17:10:00',
  });
});
