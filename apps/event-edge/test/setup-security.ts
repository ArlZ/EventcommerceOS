import { afterEach } from 'vitest';

process.env.SECURITY_TEST_BYPASS ??= 'true';

afterEach(() => {
  process.env.SECURITY_TEST_BYPASS = 'true';
  delete process.env.SECURITY_TEST_RATE_LIMIT_PER_MINUTE;
});
