import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/health/route';

describe('control-web health', () => {
  it('returns the configured exact release identity', async () => {
    const releaseCommit = '0123456789abcdef0123456789abcdef01234567';
    const previousReleaseCommit = process.env.RELEASE_COMMIT;
    process.env.RELEASE_COMMIT = releaseCommit;

    try {
      const response = GET();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.service).toBe('control-web');
      expect(body.status).toBe('ok');
      expect(body.releaseCommit).toBe(releaseCommit);
    } finally {
      if (previousReleaseCommit === undefined) {
        delete process.env.RELEASE_COMMIT;
      } else {
        process.env.RELEASE_COMMIT = previousReleaseCommit;
      }
    }
  });

  it('does not invent a release identity when none is configured', async () => {
    const previousReleaseCommit = process.env.RELEASE_COMMIT;
    delete process.env.RELEASE_COMMIT;

    try {
      const response = GET();
      const body = await response.json();
      expect(body.releaseCommit).toBeNull();
    } finally {
      if (previousReleaseCommit !== undefined) {
        process.env.RELEASE_COMMIT = previousReleaseCommit;
      }
    }
  });
});
