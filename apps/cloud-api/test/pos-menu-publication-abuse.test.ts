import { describe, expect, it } from 'vitest';
import { classifyAbuseRequest } from '../src/security/abuse-protection.guard';

describe('POS menu publication abuse classification', () => {
  it('classifies authenticated Event Edge publication pulls under EDGE_SYNC', () => {
    const classified = classifyAbuseRequest({
      method: 'GET',
      path: '/sync/events/11111111-1111-4111-8111-111111111111/pos-menu-publications',
      headers: {
        authorization: 'Bearer edge-secret-value',
        'x-edge-id': 'edge-a',
      },
    });

    expect(classified).toMatchObject({ policy: 'EDGE_SYNC', principalType: 'edge' });
    expect(classified?.principalKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
