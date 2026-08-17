const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const target = "scripts/hostinger-managed-webapp.test.mjs";

execFileSync("pnpm", ["exec", "prettier", target, "--write"], {
  cwd: root,
  stdio: "inherit",
});

const diff = execFileSync(
  "git",
  ["diff", "--no-ext-diff", "--", target],
  { cwd: root, encoding: "utf8" },
);

console.log("PRETTIER_CLI_DIFF_BEGIN");
console.log(diff || "PRETTIER_CLI_DIFF=NONE");
console.log("PRETTIER_CLI_DIFF_END");
