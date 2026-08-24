import https from 'node:https';
import tls from 'node:tls';

const lanHost = process.env.EDGE_HTTPS_TEST_LAN_HOST?.trim();
const caBase64 = process.env.EDGE_HTTPS_TEST_CA_B64?.trim();

if (!lanHost) throw new Error('EDGE_HTTPS_TEST_LAN_HOST is required');
if (!caBase64) throw new Error('EDGE_HTTPS_TEST_CA_B64 is required');

const ca = Buffer.from(caBase64, 'base64');
if (ca.length === 0) throw new Error('Event Edge root CA is empty');

await new Promise((resolve, reject) => {
  const request = https.request(
    {
      hostname: 'edge-https',
      port: 443,
      path: '/health',
      method: 'GET',
      ca,
      servername: '',
      timeout: 5_000,
      headers: { Host: lanHost },
      checkServerIdentity: (_hostname, certificate) =>
        tls.checkServerIdentity(lanHost, certificate),
    },
    (response) => {
      response.resume();
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error(`Event Edge HTTPS health returned HTTP ${response.statusCode ?? 'unknown'}`));
      });
    },
  );

  request.on('timeout', () => request.destroy(new Error('Event Edge HTTPS health check timed out')));
  request.on('error', reject);
  request.end();
});

console.log('LAN HTTPS certificate and health verified');
