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

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
