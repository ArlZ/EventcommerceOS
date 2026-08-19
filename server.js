const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn, spawnSync } = require('node:child_process');

const target = process.env.HOSTINGER_APP_TARGET ?? 'control-web';

if (target === 'control-web') {
  startControlWeb();
} else if (target === 'cloud-api') {
  startCloudApi();
} else {
  console.error(`Unsupported HOSTINGER_APP_TARGET: ${target}`);
  process.exit(1);
}

function startControlWeb() {
  const appDir = path.join(__dirname, 'apps', 'control-web');
  const requireFromControlWeb = createRequire(path.join(appDir, 'package.json'));
  const next = requireFromControlWeb('next');
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const hostname = '0.0.0.0';
  const app = next({ dev: false, dir: appDir, hostname, port });
  const handle = app.getRequestHandler();

  app
    .prepare()
    .then(() => {
      http
        .createServer((request, response) => handle(request, response))
        .listen(port, hostname, () => {
          console.log(`Event Control listening on ${hostname}:${port}`);
        });
    })
    .catch((error) => {
      console.error('Failed to start Event Control', error);
      process.exit(1);
    });
}

function startCloudApi() {
  const appDir = path.join(__dirname, 'apps', 'cloud-api');
  const migration = spawnSync(process.execPath, ['scripts/migrate.mjs'], {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit',
  });

  if (migration.error) {
    console.error('Failed to run Cloud API migrations', migration.error);
    process.exit(1);
  }
  if (migration.status !== 0) {
    console.error(`Cloud API migrations exited with status ${migration.status}`);
    process.exit(migration.status ?? 1);
  }

  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('Failed to start Cloud API', error);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
}
