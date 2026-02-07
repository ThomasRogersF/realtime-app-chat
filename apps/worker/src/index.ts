import type { Env } from "./realtimeSession.js";

export { RealtimeSession } from "./realtimeSession.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response("ok");
    }

    // WebSocket upgrade to Durable Object session
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const scenarioId = url.searchParams.get("scenarioId");
      if (!scenarioId) {
        return new Response("Missing scenarioId query param", { status: 400 });
      }

      // Use a unique DO per session — each connection gets its own DO instance
      const id = env.REALTIME_SESSION.newUniqueId();
      const stub = env.REALTIME_SESSION.get(id);

      // Forward the request (including scenarioId) to the DO
      return stub.fetch(request);
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Upgrade, Content-Type",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
