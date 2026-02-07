# Realtime AI Tutor

A data-driven Realtime AI Tutor app built with a pnpm workspaces monorepo.

## Structure

```
/
  apps/web        — Vite + React + TypeScript + Tailwind frontend
  apps/worker     — Cloudflare Worker + Durable Object relay
  packages/shared — Shared TypeScript types and helpers
```

## Getting Started

```bash
# Install dependencies
pnpm install

# Set your OpenAI API key (required for realtime AI)
cd apps/worker && npx wrangler secret put OPENAI_API_KEY

# Start the worker in dev mode
pnpm dev:worker

# Start the web app in dev mode
pnpm dev:web

# Or run both together
pnpm dev

# Typecheck all packages
pnpm typecheck
```

## Environment Variables (Worker)

| Variable | Source | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | `wrangler secret put` | OpenAI API key (never committed) |
| `OPENAI_MODEL` | `wrangler.toml` vars | Realtime model id (default: `gpt-realtime-mini-2025-12-15`) |
| `OPENAI_LOG_EVENTS` | `wrangler.toml` vars | `"true"` to forward raw OpenAI events as `debug.openai` |
| `ALLOW_ANY_ORIGIN` | `wrangler.toml` vars | `"true"` to skip CORS origin checks (dev only) |
| `ALLOWED_ORIGINS` | `wrangler.toml` vars | Comma-separated production origins |

## Phase 0 — Repo Foundations

Monorepo wiring, shared types, scaffold web app with menu and call pages
using mock scenario data.

## Phase 2 — WebSocket Echo Relay

Worker + Durable Object echo protocol. Client connects via WebSocket,
sends `client.hello` / `client.ping` / `client.event` and receives echoed replies.

## Phase 3 — OpenAI Realtime Text Integration

Durable Object opens a second WebSocket to OpenAI Realtime API and relays
text events. The session is configured from the selected scenario's
`system_prompt` and `tools`. Send `client.text` messages and receive
streaming `server.text.delta` / `server.text.completed` responses.
