export { RealtimeSession } from "./realtimeSession";
import { mintToken, validateToken } from "./auth";

export interface Env {
  REALTIME_SESSION: DurableObjectNamespace;
  ALLOW_ANY_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_LOG_EVENTS: string;
  // Phase 9A: Auth & guardrails
  REQUIRE_AUTH: string;
  TOKEN_TTL_SECONDS: string;
  SESSION_SIGNING_SECRET: string;
  MAX_SESSION_SECONDS: string;
  MAX_RESPONSES: string;
}

// ── CORS helper ────────────────────────────────────────────────
function corsHeaders(request: Request, env: Env): Record<string, string> {
  if (env.ALLOW_ANY_ORIGIN === "true") {
    return { "Access-Control-Allow-Origin": "*" };
  }

  const origin = request.headers.get("Origin");
  if (!origin) return {};

  const allowed = env.ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.includes(origin)) {
    return { "Access-Control-Allow-Origin": origin };
  }

  // Origin not in allowlist — return empty (caller should 403)
  return {};
}

function isOriginAllowed(request: Request, env: Env): boolean {
  if (env.ALLOW_ANY_ORIGIN === "true") return true;
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const allowed = env.ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── Health check ──────────────────────────────────────────
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // ── CORS preflight for all endpoints ──────────────────────
    if (request.method === "OPTIONS") {
      if (!isOriginAllowed(request, env)) {
        return new Response("Forbidden", { status: 403 });
      }
      const cors = corsHeaders(request, env);
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ── Phase 9A: POST /session — mint session token ──────────
    if (url.pathname === "/session" && request.method === "POST") {
      // CORS check for non-preflight
      if (!isOriginAllowed(request, env)) {
        return new Response("Forbidden", { status: 403 });
      }

      let body: { scenarioId?: string };
      try {
        body = (await request.json()) as { scenarioId?: string };
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(request, env),
          },
        });
      }

      const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "";
      const sessionKey = crypto.randomUUID();
      const ttl = parseInt(env.TOKEN_TTL_SECONDS || "120", 10);
      const exp = Math.floor(Date.now() / 1000) + ttl;
      const expiresAt = new Date(exp * 1000).toISOString();

      const secret = env.SESSION_SIGNING_SECRET || "";
      const token = await mintToken({ sessionKey, scenarioId, exp }, secret);

      return new Response(
        JSON.stringify({ sessionKey, token, expiresAt }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(request, env),
          },
        },
      );
    }

    // ── /realtime WebSocket upgrade ───────────────────────────
    if (url.pathname === "/realtime") {
      const upgrade = request.headers.get("Upgrade");
      if (upgrade !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }

      // Phase 9A: Token validation
      const token = url.searchParams.get("token");
      const requireAuth = env.REQUIRE_AUTH === "true";

      if (requireAuth) {
        if (!token) {
          return new Response("Unauthorized: token required", { status: 401 });
        }
        const secret = env.SESSION_SIGNING_SECRET || "";
        const result = await validateToken(token, secret);
        if (!result.valid) {
          return new Response(`Unauthorized: ${result.error}`, { status: 401 });
        }
        // Verify scenarioId matches if provided in query
        const queryScenarioId = url.searchParams.get("scenarioId");
        if (
          queryScenarioId &&
          result.payload &&
          result.payload.scenarioId !== queryScenarioId
        ) {
          return new Response("Unauthorized: scenarioId mismatch", { status: 401 });
        }
        // Verify sessionKey matches if provided in query
        const querySession = url.searchParams.get("session");
        if (
          querySession &&
          result.payload &&
          result.payload.sessionKey !== querySession
        ) {
          return new Response("Unauthorized: session mismatch", { status: 401 });
        }
      } else if (token) {
        // Even when not required, validate if present (but don't block on failure)
        const secret = env.SESSION_SIGNING_SECRET || "";
        const result = await validateToken(token, secret);
        if (!result.valid) {
          // Log but allow through — backwards compatible
        }
      }

      const sessionKey =
        url.searchParams.get("session") ?? crypto.randomUUID();
      const id = env.REALTIME_SESSION.idFromName(sessionKey);
      const stub = env.REALTIME_SESSION.get(id);
      return stub.fetch(request);
    }

    // ── Phase 8: Session summary endpoint ────────────────────
    const summaryMatch = url.pathname.match(
      /^\/session\/([^/]+)\/summary$/,
    );
    if (summaryMatch && request.method === "GET") {
      // CORS check
      if (!isOriginAllowed(request, env)) {
        return new Response("Forbidden", { status: 403 });
      }

      const sessionKey = summaryMatch[1];
      const id = env.REALTIME_SESSION.idFromName(sessionKey);
      const stub = env.REALTIME_SESSION.get(id);
      // Delegate to DO's /internal/summary handler and add CORS headers
      const internalUrl = new URL(request.url);
      internalUrl.pathname = "/internal/summary";
      const doResponse = await stub.fetch(new Request(internalUrl.toString()));
      // Re-wrap with proper CORS headers
      const responseBody = await doResponse.text();
      return new Response(responseBody, {
        status: doResponse.status,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(request, env),
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
