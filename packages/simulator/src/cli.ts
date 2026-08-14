import { runRequiredSuite } from './scenarios';

const suite = runRequiredSuite();
process.stdout.write(`${JSON.stringify(suite, null, 2)}\n`);
process.exitCode = suite.passed ? 0 : 1;
