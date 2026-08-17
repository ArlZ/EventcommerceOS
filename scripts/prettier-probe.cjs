const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

(async () => {
  const { format } = await import("prettier");
  const target = resolve(__dirname, "hostinger-managed-webapp.test.mjs");
  const source = readFileSync(target, "utf8");
  const formatted = await format(source, { filepath: target });

  if (source === formatted) {
    console.log("PRETTIER_DIFF=NONE");
    return;
  }

  const current = source.split("\n");
  const expected = formatted.split("\n");
  const max = Math.max(current.length, expected.length);
  console.log("PRETTIER_DIFF_BEGIN");
  for (let index = 0; index < max; index += 1) {
    if (current[index] !== expected[index]) {
      console.log(`LINE ${index + 1}`);
      console.log(`CURRENT=${JSON.stringify(current[index] ?? null)}`);
      console.log(`EXPECTED=${JSON.stringify(expected[index] ?? null)}`);
    }
  }
  console.log("PRETTIER_DIFF_END");
})();
