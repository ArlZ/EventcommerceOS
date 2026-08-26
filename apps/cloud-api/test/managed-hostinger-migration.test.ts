import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  isManagedHostingerCloudApi,
  runManagedCloudApiStartup,
  runManagedHostingerMigrations,
} from '../src/system/managed-hostinger-migration';

describe('managed Hostinger migration preflight', () => {
  it('only activates for the managed Cloud API target', () => {
    expect(isManagedHostingerCloudApi({})).toBe(false);
    expect(isManagedHostingerCloudApi({ HOSTINGER_APP_TARGET: 'control-web' })).toBe(false);
    expect(isManagedHostingerCloudApi({ HOSTINGER_APP_TARGET: ' cloud-api ' })).toBe(true);
  });

  it('runs the repository migration script before managed Cloud startup', () => {
    const execute = vi.fn(() => ({ status: 0 }));
    const appRoot = resolve('/workspace', 'apps', 'cloud-api');
    const env = {
      HOSTINGER_APP_TARGET: 'cloud-api',
      DATABASE_URL: 'postgresql://example.invalid/db',
    };

    runManagedHostingerMigrations({ env, appRoot, execute });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      resolve(appRoot, 'scripts', 'migrate.mjs'),
      appRoot,
      env,
    );
  });

  it('orders migration before Nest bootstrap on the configured managed entry path', async () => {
    const order: string[] = [];
    const appRoot = resolve('/workspace', 'apps', 'cloud-api');

    await runManagedCloudApiStartup(
      async () => {
        order.push('bootstrap');
      },
      {
        env: { HOSTINGER_APP_TARGET: 'cloud-api' },
        appRoot,
        execute: () => {
          order.push('migrate');
          return { status: 0 };
        },
      },
    );

    expect(order).toEqual(['migrate', 'bootstrap']);
  });

  it('does not run migrations for other runtimes', () => {
    const execute = vi.fn(() => ({ status: 0 }));

    runManagedHostingerMigrations({
      env: { HOSTINGER_APP_TARGET: 'control-web' },
      appRoot: resolve('/workspace', 'apps', 'cloud-api'),
      execute,
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when migrations cannot start', () => {
    expect(() =>
      runManagedHostingerMigrations({
        env: { HOSTINGER_APP_TARGET: 'cloud-api' },
        appRoot: resolve('/workspace', 'apps', 'cloud-api'),
        execute: () => ({ status: null, error: new Error('spawn failed') }),
      }),
    ).toThrow(/migrations failed to start/);
  });

  it('fails closed when migrations exit unsuccessfully', () => {
    expect(() =>
      runManagedHostingerMigrations({
        env: { HOSTINGER_APP_TARGET: 'cloud-api' },
        appRoot: resolve('/workspace', 'apps', 'cloud-api'),
        execute: () => ({ status: 17 }),
      }),
    ).toThrow(/migrations exited with status 17/);
  });

  it('never bootstraps the API after a failed managed migration', async () => {
    const bootstrap = vi.fn(async () => undefined);

    await expect(
      runManagedCloudApiStartup(bootstrap, {
        env: { HOSTINGER_APP_TARGET: 'cloud-api' },
        appRoot: resolve('/workspace', 'apps', 'cloud-api'),
        execute: () => ({ status: 23 }),
      }),
    ).rejects.toThrow(/migrations exited with status 23/);

    expect(bootstrap).not.toHaveBeenCalled();
  });
});
