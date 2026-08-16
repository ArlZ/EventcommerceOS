import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPilotStack } from '../infra/aws/pilot/render-stack.mjs';

const stack = buildPilotStack();
const resources = stack.Resources;

test('pilot stack is explicitly Cape Town controlled-pilot infrastructure', () => {
  assert.equal(stack.Metadata.EventCommerceOS.ExpectedRegion, 'af-south-1');
  assert.equal(stack.Metadata.EventCommerceOS.Scope, 'controlled-pilot');
  assert.deepEqual(stack.Conditions.IsCapeTown, {
    'Fn::Equals': [{ Ref: 'AWS::Region' }, 'af-south-1'],
  });
  assert.equal(stack.Parameters.DesiredCount.Default, 0);
  assert.equal(stack.Parameters.DesiredCount.MaxValue, 1);
  assert.equal(stack.Parameters.ReleaseCommit.AllowedPattern, '^[0-9a-f]{40}$');
  assert.ok(Object.values(resources).every((resource) => resource.Condition === 'IsCapeTown'));
});

test('application tasks have no public IP and database is isolated', () => {
  for (const name of ['CloudApiService', 'ControlWebService']) {
    assert.equal(
      resources[name].Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp,
      'DISABLED',
    );
  }

  assert.equal(resources.Database.Properties.PubliclyAccessible, false);
  assert.equal(resources.Database.Properties.StorageEncrypted, true);
  assert.equal(resources.Database.DeletionPolicy, 'Snapshot');
  assert.equal(resources.Database.UpdateReplacePolicy, 'Snapshot');
  assert.equal(resources.Database.Properties.BackupRetentionPeriod, 7);
});

test('runtime containers preserve hardened container restrictions', () => {
  for (const name of ['CloudApiTaskDefinition', 'ControlWebTaskDefinition']) {
    const container = resources[name].Properties.ContainerDefinitions[0];
    assert.equal(container.ReadonlyRootFilesystem, true);
    assert.deepEqual(container.LinuxParameters.Capabilities.Drop, ['ALL']);
    assert.equal(container.LinuxParameters.InitProcessEnabled, true);
  }
});

test('release images use immutable exact-SHA tags and repositories', () => {
  assert.equal(resources.CloudApiRepository.Properties.ImageTagMutability, 'IMMUTABLE');
  assert.equal(resources.ControlWebRepository.Properties.ImageTagMutability, 'IMMUTABLE');

  for (const name of ['CloudApiTaskDefinition', 'ControlWebTaskDefinition']) {
    const image = resources[name].Properties.ContainerDefinitions[0].Image['Fn::Sub'];
    assert.match(image, /\$\{ReleaseCommit\}$/);
  }
});

test('pilot payment configuration remains sandbox-only', () => {
  const env = Object.fromEntries(
    resources.CloudApiTaskDefinition.Properties.ContainerDefinitions[0].Environment.map((entry) => [
      entry.Name,
      entry.Value,
    ]),
  );

  assert.equal(env.MPESA_BASE_URL, 'https://sandbox.safaricom.co.ke');
  assert.deepEqual(env.MPESA_CALLBACK_URL, {
    'Fn::Sub': 'https://${ApiDomainName}/payments/providers/mpesa/callback',
  });
  assert.equal(env.ABUSE_DEPLOYMENT_MODE, 'single_instance_pilot');
  assert.equal(env.ABUSE_UPSTREAM_CONFIRMED, 'false');
});

test('cloud services are HTTPS host-routed and health checked', () => {
  assert.equal(resources.HttpsListener.Properties.Protocol, 'HTTPS');
  assert.equal(resources.ApiTargetGroup.Properties.HealthCheckPath, '/health');
  assert.equal(resources.WebTargetGroup.Properties.HealthCheckPath, '/api/health');
  assert.deepEqual(resources.ApiListenerRule.Properties.Conditions[0].Values, [
    { Ref: 'ApiDomainName' },
  ]);
  assert.deepEqual(resources.WebListenerRule.Properties.Conditions[0].Values, [
    { Ref: 'ControlDomainName' },
  ]);
});

test('all Ref and GetAtt dependencies point to declared template objects', () => {
  const knownRefs = new Set([
    ...Object.keys(stack.Parameters),
    ...Object.keys(resources),
    'AWS::AccountId',
    'AWS::NoValue',
    'AWS::NotificationARNs',
    'AWS::Partition',
    'AWS::Region',
    'AWS::StackId',
    'AWS::StackName',
    'AWS::URLSuffix',
  ]);

  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;

    if (Object.keys(value).length === 1 && typeof value.Ref === 'string') {
      assert.ok(knownRefs.has(value.Ref), `undeclared Ref: ${value.Ref}`);
    }
    if (Object.keys(value).length === 1 && Array.isArray(value['Fn::GetAtt'])) {
      assert.ok(resources[value['Fn::GetAtt'][0]], `undeclared GetAtt: ${value['Fn::GetAtt'][0]}`);
    }
    Object.values(value).forEach(visit);
  };

  visit(stack);
});
