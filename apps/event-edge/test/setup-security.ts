import { afterEach } from 'vitest';

process.env.SECURITY_TEST_BYPASS ??= 'true';
process.env.EDGE_CLOUD_CREDENTIAL ??=
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789_-';

afterEach(() => {
  process.env.SECURITY_TEST_BYPASS = 'true';
  delete process.env.SECURITY_TEST_RATE_LIMIT_PER_MINUTE;
});
