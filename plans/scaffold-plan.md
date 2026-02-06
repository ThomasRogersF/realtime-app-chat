# Cloudflare Pages + Worker + Durable Object scaffold plan (OpenAI Realtime WS)

## Goals
- Monorepo with pnpm workspaces:
  - [`apps/web`](apps/web:1) Vite + React + TS UI scaffold
  - [`workers/realtime`](workers/realtime:1) Cloudflare Worker + Durable Object relay
  - [`shared`](shared:1) shared types/constants
  - [`scenarios`](scenarios:1) JSON scenarios + [`index.json`](scenarios/index.json:1)
- Worker endpoints:
  - `GET /api/health` -> `{ ok: true }`
  - `GET /api/scenarios` -> serve [`/scenarios/index.json`](scenarios/index.json:1)
  - `GET /ws?scenario=<id>&user=<id>` -> WebSocket upgrade, forward to DO instance
- Durable Object [`RealtimeSession`](workers/realtime/src/durable/RealtimeSession.ts:1)
  - Accept client WS
  - Connect upstream to OpenAI Realtime WS
  - On open: load scenario, send `session.update`, opening line, `response.create`
  - Relay client->OpenAI with whitelist
  - Relay OpenAI->client all JSON
  - Tool calling skeleton: accumulate deltas, run stub tools, send function_call_output, then `response.create`
- Security:
  - `OPENAI_API_KEY` as Wrangler secret
  - Origin allowlist via `ALLOWED_ORIGINS` env; if empty allow all (TODO tighten)

## Proposed file tree (high level)
- [`package.json`](package.json:1)
- [`pnpm-workspace.yaml`](pnpm-workspace.yaml:1)
- [`wrangler.toml`](wrangler.toml:1)
- [`apps/web`](apps/web:1)
- [`workers/realtime`](workers/realtime:1)
- [`shared`](shared:1)
- [`scenarios`](scenarios:1)
- [`README.md`](README.md:1)

## Key design decisions
### Scenario loading
- For initial scaffold, embed scenarios into the worker bundle by importing JSON from [`/scenarios`](scenarios:1).
- Worker `GET /api/scenarios` returns the imported [`index.json`](scenarios/index.json:1).
- DO loads scenario by id via shared helper `getScenarioById(id)`.

### WebSocket routing
- Worker handles `/ws` upgrade.
- It derives DO id from `scenario` + `user` (e.g. `${scenario}:${user}`) to isolate sessions.
- It forwards the client socket to DO via `stub.fetch()` with `Upgrade: websocket`.

### OpenAI Realtime event model alignment
- Use only documented-ish event names from the user spec:
  - `session.update`
  - `conversation.item.create`
  - `response.create`
  - `input_audio_buffer.append`
  - `response.cancel`
  - `conversation.item.truncate`
  - plus tool-call events:
    - `response.function_call_arguments.delta`
    - `response.function_call_arguments.done`
- Everything else is relayed server->client as raw JSON for debugging.

### Tool calling skeleton
- Maintain `Map<call_id, string>` buffer.
- On `.delta`: append.
- On `.done`: parse JSON; if parse fails, return `{ ok:false, error }`.
- Run stub tool:
  - `grade_lesson(args)` -> `{ ok:true, score:0.8, notes:'stub' }`
  - `trigger_quiz(args)` -> `{ ok:true, quiz:{ lesson_id: args.lesson_id || scenarioId } }`
- Send `conversation.item.create` with `type: 'function_call_output'` and `call_id`.
- Then send `response.create`.

### Frontend scaffold
- Two screens:
  - Scenario menu: fetch `/api/scenarios`, select scenario, navigate to call
  - Call screen: header, transcript bubbles, big Start Call button
- `useRealtime` hook:
  - Connect to `/ws?scenario=...&user=...`
  - Expose `connected`, `events` (last N)
  - Append transcript when it sees text-like events (placeholder parsing; keep raw events visible)

### Local dev
- Wrangler dev on `http://localhost:8787`
- Vite dev on `http://localhost:5173`
- Vite proxy routes `/api` and `/ws` to `8787`.

## Implementation checklist (for Code mode)
- Create workspace manifests and TS configs
- Implement worker router + origin guard + scenario endpoint
- Implement DO with WS relay + tool skeleton
- Add scenarios JSON
- Create Vite React app + hook + screens
- Add README
