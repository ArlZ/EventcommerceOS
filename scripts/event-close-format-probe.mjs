import { execFileSync } from 'node:child_process';

const file = 'scripts/event-close-evidence.test.mjs';
execFileSync('pnpm', ['exec', 'prettier', '--write', file], { stdio: 'inherit' });
const diff = execFileSync('git', ['diff', '--', file], { encoding: 'utf8' });
console.log('EVENT_CLOSE_FORMAT_DIFF_BEGIN');
console.log(diff);
console.log('EVENT_CLOSE_FORMAT_DIFF_END');
