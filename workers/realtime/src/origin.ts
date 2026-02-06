import type { Env } from './env';

export function isOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser or same-origin navigation

  const allow = (env.ALLOWED_ORIGINS ?? '').trim();
  if (!allow) {
    // Dev-friendly default.
    // TODO: tighten for production.
    return true;
  }

  const allowed = allow
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return allowed.includes(origin);
}

export function withCors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);

  if (origin && isOriginAllowed(request, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }

  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
