# Realtime App Chat

**Native Multimodal Real-Time AI Tutor** using OpenAI Realtime API over WebSockets.

This is a Cloudflare Pages + Worker + Durable Object monorepo scaffold for speech-to-speech single-model architecture (no REST STT/LLM/TTS pipeline).

## Project Structure

```
realtime-app-chat/
├── apps/
│   └── web/              # Vite + React + TypeScript frontend
├── workers/
│   └── realtime/         # Cloudflare Worker + Durable Object
├── shared/               # Shared types/constants/utilities
├── scenarios/            # JSON scenario definitions
├── package.json          # Root workspace config (pnpm)
├── pnpm-workspace.yaml   # pnpm workspace definition
├── wrangler.toml         # Cloudflare Worker config
└── README.md
```

## Prerequisites

- Node.js 18+ (tested with v22.17.0)
- pnpm 9+ (installed via `npm install -g pnpm` or use `npx pnpm`)
- Cloudflare account (for deployment)
- OpenAI API key with Realtime API access

## Setup

### 1. Install Dependencies

This repo uses **pnpm workspaces**. Install pnpm globally first:

```bash
npm install -g pnpm
```

Then install all dependencies:

```bash
pnpm install
```

### 2. Set OpenAI API Key

The Worker needs your OpenAI API key as a Wrangler secret:

```bash
npx wrangler secret put OPENAI_API_KEY
```

When prompted, paste your OpenAI API key.

**For local dev**, create a `.dev.vars` file in the project root:

```
OPENAI_API_KEY=sk-...your-key-here...
```

(This file is gitignored by default.)

### 3. Configure Model (Optional)

The default model is `gpt-4o-realtime-preview-2024-12-17`. To change it, edit [`wrangler.toml`](wrangler.toml:14):

```toml
[vars]
OPENAI_REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17"
```

### 4. Enable Debug Logging (Optional)

For detailed WebSocket relay logs during development:

```toml
[vars]
DEBUG_RELAY = "true"
```

## Development

Run both the Worker and the web app in parallel:

### Terminal 1: Start Worker (port 8787)

```bash
pnpm run dev:worker
```

This starts the Cloudflare Worker with Durable Objects locally.

### Terminal 2: Start Web App (port 5173)

```bash
cd apps/web
pnpm dev
```

Vite proxies `/api` and `/ws` requests to the Worker on port 8787.

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Architecture

### Backend (Worker + Durable Object)

**Worker Endpoints** ([`workers/realtime/src/router.ts`](workers/realtime/src/router.ts:1)):
- `GET /api/health` → `{ ok: true }`
- `GET /api/scenarios` → Returns [`scenarios/index.json`](scenarios/index.json:1)
- `GET /ws?scenario=<id>&user=<id>` → WebSocket upgrade, forwards to Durable Object

**Durable Object** ([`workers/realtime/src/durable/RealtimeSession.ts`](workers/realtime/src/durable/RealtimeSession.ts:1)):
- Accepts client WebSocket
- Creates upstream WebSocket to OpenAI Realtime API:
  ```
  wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}
  ```
- On upstream open:
  - Loads scenario JSON by ID (server-side validation)
  - Sends `session.update` with tutor instructions, VAD config, tools
  - Sends opening assistant message
  - Sends `response.create`
- Relays client events to OpenAI (whitelisted types only):
  - **Allowed**: `input_audio_buffer.append`, `input_audio_buffer.commit`, `response.cancel`, `conversation.item.truncate`, `response.create`
  - **Blocked**: `session.update`, `conversation.item.create` (prevents prompt injection)
- Relays all OpenAI events back to client
- Implements tool calling skeleton:
  - Accumulates `response.function_call_arguments.delta`
  - On `response.function_call_arguments.done`, parses args and runs stub tools:
    - `grade_lesson(args)` → `{ ok:true, score:0.8, notes:"stub" }`
    - `trigger_quiz(args)` → `{ ok:true, quiz:{ lesson_id: ... } }`
  - Sends `conversation.item.create` (function_call_output) + `response.create`

**Security**:
- `OPENAI_API_KEY` is a Wrangler secret (not exposed to browser)
- Origin allowlist via `ALLOWED_ORIGINS` env var (default: `http://localhost:5173`)
- Client event whitelist prevents abuse and prompt injection
- Scenario validation happens server-side

### Frontend (React + Vite)

**Screens**:
- **Scenario Menu** ([`apps/web/src/ui/ScenarioMenu.tsx`](apps/web/src/ui/ScenarioMenu.tsx:1)):
  - Fetches `/api/scenarios`
  - User selects level + scenario
  - Navigates to Call screen
- **Call Screen** ([`apps/web/src/ui/CallScreen.tsx`](apps/web/src/ui/CallScreen.tsx:1)):
  - Header: Exit button, scenario title, connection status
  - Transcript area: assistant (teal) + user (indigo) bubbles
  - Footer: "Start Call" button
  - Debug card: shows last 10 raw events

**`useRealtime` Hook** ([`apps/web/src/useRealtime/useRealtime.ts`](apps/web/src/useRealtime/useRealtime.ts:1)):
- Connects to `/ws?scenario=...&user=...`
- Exposes `connected`, `events`, `transcript`
- Placeholder transcript parsing (extracts text from common event shapes)

### Scenarios

Sample scenario: [`scenarios/a1_taxi_bogota.json`](scenarios/a1_taxi_bogota.json:1)
- Level: A1 (beginner Spanish)
- Roleplay: taxi driver in Bogotá
- Tools: `grade_lesson`, `trigger_quiz`

Add more scenarios by:
1. Creating `scenarios/<id>.json`
2. Adding entry to [`scenarios/index.json`](scenarios/index.json:1)
3. Importing in [`shared/src/scenarios/loader.ts`](shared/src/scenarios/loader.ts:1)

## Type Checking

```bash
pnpm run typecheck
```

Runs TypeScript checks for all workspaces:
- `shared/`
- `workers/realtime/`
- `apps/web/`

## Deployment

### Deploy Worker

```bash
npx wrangler deploy --config wrangler.toml
```

Make sure you've set the `OPENAI_API_KEY` secret (see Setup step 2).

### Deploy Web App (Cloudflare Pages)

1. Build the web app:
   ```bash
   cd apps/web
   pnpm run build
   ```

2. Deploy to Cloudflare Pages:
   - Connect your GitHub repo to Cloudflare Pages
   - Build command: `cd apps/web && pnpm run build`
   - Build output directory: `apps/web/dist`
   - Environment variables:
     - (None needed for the web app; it calls the Worker API)

3. Update `ALLOWED_ORIGINS` in [`wrangler.toml`](wrangler.toml:16) to include your Pages domain:
   ```toml
   ALLOWED_ORIGINS = "http://localhost:5173,https://your-pages-domain.pages.dev"
   ```

4. Redeploy the Worker:
   ```bash
   npx wrangler deploy --config wrangler.toml
   ```

## Local Smoke Test Checklist

After setting up, verify everything works:

1. **Start Worker**: `pnpm run dev:worker`
   - Should show: `[wrangler] ⛅️ wrangler dev`
   - Durable Object migration should succeed

2. **Start Web**: `cd apps/web && pnpm dev`
   - Should show: `VITE v5.x.x ready in xxx ms`
   - Port 5173 should be open

3. **Open Scenario Menu**: http://localhost:5173
   - Should show "Taxi in Bogotá (basic greetings + destination)"
   - Select scenario and click "Start"

4. **Start Call**:
   - Click "Start Call" button
   - Connection status should change to "Connected"

5. **Verify WebSocket**:
   - Check browser DevTools → Network → WS
   - Should see `/ws?scenario=a1_taxi_bogota&user=...` connection

6. **Check Worker Logs**:
   - Look for: `[RealtimeSession a1_taxi_bogota] Client WebSocket connected`
   - Look for: `Connecting to OpenAI Realtime`
   - Look for: `Upstream WebSocket accepted`
   - Look for: `Sending session.update to upstream`

7. **Verify Events in Debug Panel**:
   - Should see `session.updated` event from OpenAI
   - Should see `conversation.item.created` with opening message
   - Should see `response.created` event

## Troubleshooting

### Worker fails to start

- Check that `OPENAI_API_KEY` is set:
  ```bash
  npx wrangler secret list
  ```
- Or create `.dev.vars` with `OPENAI_API_KEY=sk-...`
- Check that port 8787 is not in use

### Web app can't connect to Worker

- Make sure Worker is running on port 8787
- Check Vite proxy config in [`apps/web/vite.config.ts`](apps/web/vite.config.ts:1)
- Check browser console for CORS errors
- Verify `ALLOWED_ORIGINS` includes `http://localhost:5173`

### TypeScript errors

- Run `pnpm install` to ensure all dependencies are installed
- Run `pnpm run typecheck` to see all errors
- Check that `@cloudflare/workers-types` is installed

### OpenAI Realtime connection fails

- Check that your OpenAI API key has Realtime API access
- Check Worker logs: `DEBUG_RELAY=true` should show detailed logs
- Check browser console for WebSocket errors
- Verify the model name is correct in `wrangler.toml`

### WebSocket proxy not working

The Vite dev server proxies `/ws` to the Worker. If you see connection errors:

1. Ensure both Worker and Vite are running
2. Check that `ws: true` is set in [`vite.config.ts`](apps/web/vite.config.ts:13)
3. Try connecting directly to Worker: `ws://localhost:8787/ws?scenario=test&user=test`

## TODOs

- [ ] Wire actual audio input/output (currently text-only scaffold)
- [ ] Implement real tool logic (grade_lesson, trigger_quiz)
- [ ] Add user authentication
- [ ] Tighten CORS allowlist for production
- [ ] Add progress tracking UI
- [ ] Add more scenarios (A2, B1, etc.)
- [ ] Add error handling for upstream connection failures
- [ ] Add reconnection logic for dropped WebSocket connections
- [ ] Add analytics/logging

## License

MIT (or your preferred license)
