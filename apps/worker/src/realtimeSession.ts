import type { Env } from "./index";

interface SessionState {
  sessionId: string;
  scenarioId: string | null;
}

/**
 * Durable Object that manages a single realtime session.
 * Phase 2: echo protocol only — no model calls.
 */
export class RealtimeSession implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private session: SessionState = { sessionId: "", scenarioId: null };

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    // ── Origin check ──────────────────────────────────────────
    if (!this.isOriginAllowed(request)) {
      return new Response("Forbidden", { status: 403 });
    }

    // ── WebSocket upgrade ─────────────────────────────────────
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    const url = new URL(request.url);
    const sessionKey = url.searchParams.get("session") ?? crypto.randomUUID();
    this.session = {
      sessionId: sessionKey,
      scenarioId: url.searchParams.get("scenarioId"),
    };

    server.accept();

    server.addEventListener("message", (event) => {
      this.handleMessage(server, event);
    });

    server.addEventListener("close", () => {
      this.session = { sessionId: "", scenarioId: null };
    });

    server.addEventListener("error", () => {
      this.session = { sessionId: "", scenarioId: null };
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Message handler ───────────────────────────────────────────
  private handleMessage(ws: WebSocket, event: MessageEvent): void {
    if (typeof event.data !== "string") {
      this.sendJson(ws, {
        type: "server.error",
        error: "Binary messages not supported",
      });
      return;
    }

    let msg: { type?: string; [key: string]: unknown };
    try {
      msg = JSON.parse(event.data);
    } catch {
      this.sendJson(ws, {
        type: "server.error",
        error: "Invalid JSON",
      });
      return;
    }

    if (!msg || typeof msg.type !== "string") {
      this.sendJson(ws, {
        type: "server.error",
        error: "Missing 'type' field",
      });
      return;
    }

    switch (msg.type) {
      case "client.hello": {
        const scenarioId =
          typeof msg.scenarioId === "string"
            ? msg.scenarioId
            : this.session.scenarioId;
        this.session.scenarioId = scenarioId;
        this.sendJson(ws, {
          type: "server.hello",
          sessionId: this.session.sessionId,
          scenarioId,
        });
        break;
      }

      case "client.ping":
        this.sendJson(ws, { type: "server.pong" });
        break;

      case "client.event": {
        const { type: _type, ...payload } = msg;
        this.sendJson(ws, { type: "server.echo", payload });
        break;
      }

      default:
        this.sendJson(ws, {
          type: "server.error",
          error: `Unknown message type: ${msg.type}`,
        });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  private isOriginAllowed(request: Request): boolean {
    if (this.env.ALLOW_ANY_ORIGIN === "true") return true;

    const origin = request.headers.get("Origin");
    if (!origin) return false;

    const allowed = this.env.ALLOWED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return allowed.includes(origin);
  }

  private sendJson(ws: WebSocket, data: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Connection may have closed; nothing to do.
    }
  }
}
