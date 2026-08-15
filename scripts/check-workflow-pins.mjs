import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const workflowDirectory = '.github/workflows';
const immutableRef = /^[0-9a-f]{40}$/;
const immutableImage = /@sha256:[0-9a-f]{64}$/;
const violations = [];

for (const entry of readdirSync(workflowDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !['.yml', '.yaml'].includes(extname(entry.name))) continue;
  const path = join(workflowDirectory, entry.name);
  const lines = readFileSync(path, 'utf8').split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- uses:') || trimmed.startsWith('uses:')) {
      const value = trimmed
        .replace(/^-?\s*uses:\s*/, '')
        .split(/\s+#\s*/, 1)[0]
        .trim();
      if (value.startsWith('./')) return;
      const separator = value.lastIndexOf('@');
      if (separator < 1) {
        violations.push(
          `${path}:${index + 1}: action reference must include an immutable commit SHA`,
        );
        return;
      }
      const ref = value.slice(separator + 1);
      if (!immutableRef.test(ref)) {
        violations.push(
          `${path}:${index + 1}: action ref must be a lowercase 40-character commit SHA`,
        );
      }
    }

    if (trimmed.startsWith('image:')) {
      const value = trimmed.slice('image:'.length).trim();
      if (!immutableImage.test(value)) {
        violations.push(`${path}:${index + 1}: workflow image must be pinned to a SHA-256 digest`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`Workflow dependency pin check failed (${violations.length} issue(s)):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('Workflow dependency pin check passed.');
}
