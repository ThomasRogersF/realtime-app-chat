# Realtime AI Tutor

A data-driven Realtime AI Tutor app built with a pnpm workspaces monorepo.

## Structure

```
/
  apps/web        — Vite + React + TypeScript + Tailwind frontend
  packages/shared — Shared TypeScript types and helpers
```

## Getting Started

```bash
# Install dependencies
pnpm install

# Start the web app in dev mode
pnpm dev:web

# Typecheck all packages
pnpm typecheck
```

## Phase 0 — Repo Foundations

This phase sets up the monorepo wiring, shared types, and a scaffold web app
with menu and call pages using mock scenario data. No backend, no WebSockets,
no audio, no AI integration yet.
