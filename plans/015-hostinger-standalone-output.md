# Plan 015: Hostinger standalone Event Control output

## Goal

Make the managed Hostinger Event Control deployment self-contained at runtime when hPanel copies only the configured Next.js output directory into its Node.js runtime.

## Problem observed

The Next.js build completes successfully, but Hostinger returns HTTP 503 and its runtime log reports `Cannot find module 'next'` from the generated `nodejs/server.js` entry point. A normal `.next` build directory does not include the production `node_modules` tree that Hostinger's generated launcher expects.

## Change

- Keep Next.js `output: 'standalone'` enabled.
- Make the Control Web workspace build stage `.next/static` and optional `public` assets into the generated standalone runtime.
- Deploy `.next/standalone` as the Hostinger output directory instead of `.next`.
- Add CI that copies `.next/standalone` into a clean temporary directory and proves `require.resolve('next')` succeeds there, matching the Hostinger runtime failure mode.

## Safety

This changes only managed-hosting packaging for Event Control. It does not alter the offline-first POS/Event Edge boundary, Cloud API persistence, payment behavior, or the hardened Docker/VPS deployment path.
