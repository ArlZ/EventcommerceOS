import { generateKeyPairSync } from 'node:crypto';

const pair = generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');

console.log(`OPERATOR_TOKEN_SIGNING_PRIVATE_KEY=${privateKey}`);
console.log(`OPERATOR_TOKEN_VERIFYING_PUBLIC_KEY=${publicKey}`);
console.log('Store the private key only in Cloud secrets. Distribute only the public key to Event Edge.');
