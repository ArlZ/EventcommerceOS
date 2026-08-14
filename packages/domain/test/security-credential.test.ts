import { describe, expect, it } from 'vitest';
import {
  canonicalSecurityJson,
  hashCredentialSecret,
  issueOpaqueCredential,
  parseAuthorizationCredential,
  parseOpaqueCredential,
  verifyCredentialSecret,
} from '../src/security-credential';

describe('opaque security credentials', () => {
  it('issues a one-time token while verification uses only the secret hash', () => {
    const issued = issueOpaqueCredential('12345678-1234-4234-8234-123456789abc');
    const parsed = parseOpaqueCredential(issued.token);

    expect(parsed.credentialId).toBe(issued.credentialId);
    expect(issued.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.secretHash).toBe(hashCredentialSecret(parsed.secret));
    expect(verifyCredentialSecret(parsed.secret, issued.secretHash)).toBe(true);
    expect(verifyCredentialSecret(`${parsed.secret}x`, issued.secretHash)).toBe(false);
    expect(issued.secretHash).not.toContain(parsed.secret);
  });

  it('requires the expected authorization scheme and rejects malformed tokens', () => {
    const issued = issueOpaqueCredential('22345678-1234-4234-8234-123456789abc');
    expect(parseAuthorizationCredential(`Bearer ${issued.token}`, 'Bearer').credentialId).toBe(
      issued.credentialId,
    );
    expect(() => parseAuthorizationCredential(`Edge ${issued.token}`, 'Bearer')).toThrow();
    expect(() => parseOpaqueCredential('not-a-token')).toThrow();
  });

  it('canonicalizes object key ordering without changing array ordering', () => {
    const left = {
      eventId: 'event-1',
      devices: [{ b: 2, a: 1 }, { a: 3, b: 4 }],
      version: 7,
    };
    const right = {
      version: 7,
      devices: [{ a: 1, b: 2 }, { b: 4, a: 3 }],
      eventId: 'event-1',
    };
    expect(canonicalSecurityJson(left)).toBe(canonicalSecurityJson(right));
    expect(canonicalSecurityJson({ values: [1, 2] })).not.toBe(
      canonicalSecurityJson({ values: [2, 1] }),
    );
  });
});
