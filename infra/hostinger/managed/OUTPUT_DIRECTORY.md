# Event Control Hostinger output directory

For the managed Hostinger Event Control Web App, use:

```text
Build command: pnpm run build
Package manager: pnpm
Output directory: .next/standalone
```

The Control Web workspace build stages `.next/static` and optional `public` assets into the Next.js standalone runtime. The standalone output includes the minimal production Node.js dependencies needed at runtime, including Next.js itself, so Hostinger can copy the output into its `nodejs` runtime directory without relying on pnpm workspace links.
