# Realtime AI Tutor

A data-driven Realtime AI Tutor app built with a pnpm workspaces monorepo.

## Structure

```
/
  apps/web        — Vite + React + TypeScript + Tailwind frontend
  apps/worker     — Cloudflare Worker + Durable Object (OpenAI Realtime relay)
  packages/shared — Shared TypeScript types and helpers
```

## Getting Started

```bash
# Install dependencies
pnpm install

# Set the OpenAI API key (required for the worker)
cd apps/worker && npx wrangler secret put OPENAI_API_KEY

# Start the worker in dev mode
pnpm dev:worker

# Start the web app in dev mode (in a separate terminal)
pnpm dev:web

# Typecheck all packages
pnpm typecheck
```

## Environment Variables (Worker)

| Variable | Source | Description |
|---|---|---|
| `OPENAI_API_KEY` | `wrangler secret put` | Your OpenAI API key (secret) |
| `OPENAI_MODEL` | `wrangler.toml` vars | Realtime model ID |
| `OPENAI_LOG_EVENTS` | `wrangler.toml` vars | Forward raw OpenAI events as `debug.openai` |
