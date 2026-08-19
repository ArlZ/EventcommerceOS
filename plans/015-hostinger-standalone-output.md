# Plan 015: Hostinger portable Event Control output

## Goal

Make the managed Hostinger Event Control deployment self-contained at runtime when hPanel copies only the configured output directory into its Node.js runtime.

## Problem observed

The Next.js build completes successfully, but Hostinger returns HTTP 503 and its runtime log reports `Cannot find module 'next'` from the generated `nodejs/server.js` entry point. A normal `.next` build directory does not include the production `node_modules` tree that Hostinger's generated launcher expects. The Next standalone tree can boot its own generated server, but does not make `require('next')` resolvable from Hostinger's top-level launcher.

## Change

- Keep Next.js `output: 'standalone'` enabled for the existing hardened container path.
- After the Control Web build, run `pnpm deploy --prod --legacy` to create a portable production dependency tree.
- Combine that dependency tree with the built `.next` application in `.hostinger-output`.
- Deploy `.hostinger-output` as the Hostinger output directory instead of `.next`.
- Add CI that copies `.hostinger-output` into a clean temporary directory and proves `require.resolve('next')` succeeds there, matching the Hostinger runtime failure mode.

## Safety

This changes only managed-hosting packaging for Event Control. It does not alter the offline-first POS/Event Edge boundary, Cloud API persistence, payment behavior, or the hardened Docker/VPS deployment path.
