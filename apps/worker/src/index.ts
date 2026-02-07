export { RealtimeSession } from "./realtimeSession";

export interface Env {
  REALTIME_SESSION: DurableObjectNamespace;
  ALLOW_ANY_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_LOG_EVENTS: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/realtime") {
      const upgrade = request.headers.get("Upgrade");
      if (upgrade !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
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
      const sessionKey = summaryMatch[1];
      const id = env.REALTIME_SESSION.idFromName(sessionKey);
      const stub = env.REALTIME_SESSION.get(id);
      // Delegate to DO's /internal/summary handler
      const internalUrl = new URL(request.url);
      internalUrl.pathname = "/internal/summary";
      return stub.fetch(new Request(internalUrl.toString()));
    }

    // ── CORS preflight for summary endpoint ──────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
