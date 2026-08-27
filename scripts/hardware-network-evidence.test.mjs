import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyHardwareNetworkFieldEvidence } from './hardware-network-evidence.mjs';

const releaseCommit = 'b'.repeat(40);
const credentialHashA = '1'.repeat(64);
const credentialHashB = '2'.repeat(64);

function passingInput() {
  return {
    schemaVersion: 1,
    releaseCommit,
    eventId: 'event-controlled-pilot',
    venue: 'Controlled pilot venue',
    operator: 'Field Test Operator',
    liveMoneyApproved: false,
    edge: {
      hostId: 'edge-venue-01',
      releaseCommit,
      postgresHealthy: true,
      diskFreeGb: 120,
      minimumDiskFreeGb: 20,
      clockSynchronized: true,
      restartTestPassed: true,
      staticOrReservedLanAddress: true,
      durableStorageVerified: true,
      backupPathVerified: true,
      upsOrPowerBackupVerified: true,
    },
    network: {
      dhcpHeadroomConfirmed: true,
      wanDisconnectedDuringLanTest: true,
      posToEdgeContinuedWithoutWan: true,
      locationSamples: [
        {
          salesLocationId: 'bar-a',
          posToEdgeReachable: true,
          latencyP95Ms: 18,
          packetLossPercent: 0,
        },
        {
          salesLocationId: 'bar-b',
          posToEdgeReachable: true,
          latencyP95Ms: 24,
          packetLossPercent: 0.2,
        },
      ],
    },
    devices: [
      {
        assetId: 'asset-pos-01',
        registerId: 'register-01',
        credentialIdHash: credentialHashA,
        credentialRevocable: true,
        releaseCommit,
        batteryChecked: true,
        timezoneCorrect: true,
        eventMenuCached: true,
        coldStartWithoutWan: true,
        localOrderCommitted: true,
        localStateSurvivedRestart: true,
        reconnectSyncPassed: true,
      },
      {
        assetId: 'asset-pos-02',
        registerId: 'register-02',
        credentialIdHash: credentialHashB,
        credentialRevocable: true,
        releaseCommit,
        batteryChecked: true,
        timezoneCorrect: true,
        eventMenuCached: true,
        coldStartWithoutWan: true,
        localOrderCommitted: true,
        localStateSurvivedRestart: true,
        reconnectSyncPassed: true,
      },
    ],
  };
}

test('hardware/network verifier passes complete exact-release field evidence', () => {
  const report = verifyHardwareNetworkFieldEvidence(
    passingInput(),
    new Date('2026-08-27T09:30:00+03:00'),
  );
  assert.equal(report.status, 'PASS');
  assert.equal(report.hardwareNetworkSatisfied, true);
  assert.equal(report.liveMoneyApproved, false);
  assert.equal(report.summary.physicalDeviceCount, 2);
  assert.equal(report.summary.salesLocationSampleCount, 2);
  assert.equal(report.summary.worstLatencyP95Ms, 24);
  assert.equal(report.summary.worstPacketLossPercent, 0.2);
  assert.match(report.reportDigestSha256, /^[0-9a-f]{64}$/);
});

test('hardware/network verifier requires two distinct physical devices and credentials', () => {
  const input = passingInput();
  input.devices[1].assetId = input.devices[0].assetId;
  input.devices[1].credentialIdHash = input.devices[0].credentialIdHash;
  const report = verifyHardwareNetworkFieldEvidence(input);
  assert.equal(report.status, 'FAIL');
  const devices = report.checks.find((entry) => entry.id === 'physical-pos-devices');
  assert.equal(devices?.status, 'FAIL');
  assert.match(devices?.details ?? '', /assetId/);
  assert.match(devices?.details ?? '', /credentialIdHash/);
});

test('hardware/network verifier requires LAN operation while WAN is disconnected', () => {
  const input = passingInput();
  input.network.posToEdgeContinuedWithoutWan = false;
  const report = verifyHardwareNetworkFieldEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.checks.find((entry) => entry.id === 'venue-lan')?.status, 'FAIL');
});

test('hardware/network verifier fails when Edge restart or power protection is unproven', () => {
  const input = passingInput();
  input.edge.restartTestPassed = false;
  input.edge.upsOrPowerBackupVerified = false;
  const report = verifyHardwareNetworkFieldEvidence(input);
  assert.equal(report.status, 'FAIL');
  const edge = report.checks.find((entry) => entry.id === 'edge-host');
  assert.match(edge?.details ?? '', /restartTestPassed/);
  assert.match(edge?.details ?? '', /upsOrPowerBackupVerified/);
});

test('hardware/network verifier never approves live money', () => {
  const input = passingInput();
  input.liveMoneyApproved = true;
  const report = verifyHardwareNetworkFieldEvidence(input);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.liveMoneyApproved, false);
  assert.equal(report.checks.find((entry) => entry.id === 'live-money-boundary')?.status, 'FAIL');
});
