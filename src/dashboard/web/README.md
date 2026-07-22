# FinOps — Dashboard UI

The React dashboard for FinOps, built with Vite, TypeScript, Tailwind CSS,
shadcn/ui-style components (Radix primitives), and Recharts. It renders the
local Financial Brief served by the Node API at `../server.ts`.

You don't run this directly — the top-level project builds and serves it:

```bash
npm run dashboard        # from the repo root: builds this app and serves it
```

To develop the UI in isolation:

```bash
npm install
npm run build            # tsc -b && vite build
```

UI components live in `src/components/ui` (shadcn/ui style, copied in as source).
