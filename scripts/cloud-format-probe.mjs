import { execFileSync } from 'node:child_process';

const files = [
  'apps/cloud-api/scripts/cloud-convergence-snapshot.mjs',
  'scripts/cloud-convergence-evidence.mjs',
  'scripts/cloud-convergence-evidence.test.mjs',
];

execFileSync('pnpm', ['exec', 'prettier', '--write', ...files], {
  stdio: 'inherit',
});

const diff = execFileSync('git', ['diff', '--', ...files], {
  encoding: 'utf8',
});
console.log('FORMAT_PROBE_DIFF_BEGIN');
console.log(diff);
console.log('FORMAT_PROBE_DIFF_END');
