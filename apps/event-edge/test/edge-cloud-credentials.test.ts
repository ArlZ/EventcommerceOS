import { afterEach, describe, expect, it } from 'vitest';
import { edgeCloudCredentials } from '../src/security/edge-cloud-credentials';

const previousEdgeId = process.env.EDGE_ID;
const previousToken = process.env.EDGE_CLOUD_SYNC_TOKEN;

function restore(): void {
  if (previousEdgeId === undefined) delete process.env.EDGE_ID;
  else process.env.EDGE_ID = previousEdgeId;
  if (previousToken === undefined) delete process.env.EDGE_CLOUD_SYNC_TOKEN;
  else process.env.EDGE_CLOUD_SYNC_TOKEN = previousToken;
}

afterEach(restore);

describe('Event Edge Cloud credentials', () => {
  it('fails closed when the runtime credential is missing', () => {
    process.env.EDGE_ID = 'edge-credentials-test';
    delete process.env.EDGE_CLOUD_SYNC_TOKEN;
    expect(() => edgeCloudCredentials('edge-credentials-test')).toThrow(
      'EDGE_CLOUD_SYNC_TOKEN is required',
    );
  });

  it('rejects a batch whose edgeId does not match the configured machine identity', () => {
    process.env.EDGE_ID = 'edge-credentials-test';
    process.env.EDGE_CLOUD_SYNC_TOKEN = 'edge-runtime-token-0123456789-abcdefghijklmnopqrstuvwxyz';
    expect(() => edgeCloudCredentials('different-edge')).toThrow(
      'batch edgeId does not match configured EDGE_ID',
    );
  });

  it('returns the bearer credential only as request headers', () => {
    const token = 'edge-runtime-token-0123456789-abcdefghijklmnopqrstuvwxyz';
    process.env.EDGE_ID = 'edge-credentials-test';
    process.env.EDGE_CLOUD_SYNC_TOKEN = token;
    const credentials = edgeCloudCredentials('edge-credentials-test');

    expect(credentials.edgeId).toBe('edge-credentials-test');
    expect(credentials.headers.authorization).toBe(`Bearer ${token}`);
    expect(credentials.headers['x-edge-id']).toBe('edge-credentials-test');
    expect(JSON.stringify({ edgeId: credentials.edgeId })).not.toContain(token);
  });
});
