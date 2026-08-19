const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');

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
