import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

interface MigrationExecutionResult {
  error?: Error;
  status: number | null;
}

type MigrationExecutor = (
  migrationScript: string,
  appRoot: string,
  env: NodeJS.ProcessEnv,
) => MigrationExecutionResult;

interface ManagedMigrationOptions {
  env?: NodeJS.ProcessEnv;
  appRoot?: string;
  execute?: MigrationExecutor;
}

function executeMigration(
  migrationScript: string,
  appRoot: string,
  env: NodeJS.ProcessEnv,
): MigrationExecutionResult {
  return spawnSync(process.execPath, [migrationScript], {
    cwd: appRoot,
    env,
    stdio: 'inherit',
  });
}

export function isManagedHostingerCloudApi(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HOSTINGER_APP_TARGET?.trim() === 'cloud-api';
}

export function runManagedHostingerMigrations(options: ManagedMigrationOptions = {}): void {
  const env = options.env ?? process.env;
  if (!isManagedHostingerCloudApi(env)) return;

  const appRoot = options.appRoot ?? resolve(__dirname, '..', '..');
  const migrationScript = resolve(appRoot, 'scripts', 'migrate.mjs');
  const execute = options.execute ?? executeMigration;
  const result = execute(migrationScript, appRoot, env);

  if (result.error) {
    throw new Error('Managed Hostinger Cloud API migrations failed to start', {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(`Managed Hostinger Cloud API migrations exited with status ${result.status}`);
  }
}

export async function runManagedCloudApiStartup(
  bootstrap: () => Promise<void>,
  options: ManagedMigrationOptions = {},
): Promise<void> {
  runManagedHostingerMigrations(options);
  await bootstrap();
}
