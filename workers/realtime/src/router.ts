import type { Env } from './env';
import { withCors } from './origin';
import { getScenarioIndex } from '../../../shared/src/scenarios/loader';

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return withCors(request, env, new Response(null, { status: 204 }));
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return withCors(request, env, json({ ok: true }));
  }

  if (url.pathname === '/api/scenarios' && request.method === 'GET') {
    return withCors(request, env, json(getScenarioIndex()));
  }

  if (url.pathname === '/ws' && request.method === 'GET') {
    const scenarioId = url.searchParams.get('scenario') ?? '';
    const userId = url.searchParams.get('user') ?? '';

    if (!scenarioId || !userId) {
      return withCors(request, env, json({ ok: false, error: 'Missing scenario or user' }, 400));
    }

    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return withCors(request, env, json({ ok: false, error: 'Expected websocket upgrade' }, 426));
    }

    // Route to a DO instance per (scenario,user)
    const id = env.REALTIME_SESSIONS.idFromName(`${scenarioId}:${userId}`);
    const stub = env.REALTIME_SESSIONS.get(id);

    // Forward the request to the DO. The DO will accept the websocket.
    return stub.fetch(request);
  }

  return withCors(request, env, json({ ok: false, error: 'Not found' }, 404));
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
