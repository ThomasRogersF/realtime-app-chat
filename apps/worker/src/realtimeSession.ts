import type { Env } from "./index";
import { LocalScenarioRegistry } from "@shared";
import type { Scenario } from "@shared";

interface SessionState {
  sessionId: string;
  scenarioId: string | null;
}

const registry = new LocalScenarioRegistry();

/**
 * Durable Object that manages a single realtime session.
 * Phase 3: Opens a second WebSocket to OpenAI Realtime API and relays TEXT events.
 */
export class RealtimeSession implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private session: SessionState = { sessionId: "", scenarioId: null };

  /** WebSocket back to the browser client */
  private clientWs: WebSocket | null = null;
  /** WebSocket to OpenAI Realtime API */
  private openaiWs: WebSocket | null = null;
  /** Accumulates response.text.delta content for the current response */
  private pendingResponseText = "";

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
    const scenarioId = url.searchParams.get("scenarioId") ?? null;

    this.session = { sessionId: sessionKey, scenarioId };

    server.accept();
    this.clientWs = server;

    server.addEventListener("message", (event) => {
      this.handleMessage(server, event);
    });

    server.addEventListener("close", () => {
      this.cleanup();
    });

    server.addEventListener("error", () => {
      this.cleanup();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Client message handler ────────────────────────────────────
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
        // Initiate OpenAI connection; server.hello sent after OpenAI WS is ready
        this.connectToOpenAI(ws, scenarioId);
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

      case "client.text": {
        if (typeof msg.text !== "string" || !msg.text.trim()) {
          this.sendJson(ws, {
            type: "server.error",
            error: "client.text requires a non-empty 'text' field",
          });
          break;
        }
        this.handleClientText(msg.text as string);
        break;
      }

      default:
        this.sendJson(ws, {
          type: "server.error",
          error: `Unknown message type: ${msg.type}`,
        });
    }
  }

  // ── OpenAI Realtime connection ────────────────────────────────
  private async connectToOpenAI(
    clientWs: WebSocket,
    scenarioId: string | null,
  ): Promise<void> {
    // Load scenario
    let scenario: Scenario | null = null;
    if (scenarioId) {
      try {
        scenario = await registry.getScenarioById(scenarioId);
      } catch {
        this.sendJson(clientWs, {
          type: "server.error",
          error: `Failed to load scenario: ${scenarioId}`,
        });
      }
    }

    // Build OpenAI WS URL
    const model = this.env.OPENAI_MODEL || "gpt-realtime-mini-2025-12-15";
    const openaiUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

    try {
      const resp = await fetch(openaiUrl, {
        headers: {
          Upgrade: "websocket",
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });
      const ws = resp.webSocket;
      if (!ws) {
        this.sendJson(clientWs, {
          type: "server.error",
          error: "Failed to establish WebSocket to OpenAI",
        });
        // Still send hello so client isn't stuck
        this.sendJson(clientWs, {
          type: "server.hello",
          sessionId: this.session.sessionId,
          scenarioId: this.session.scenarioId,
          openai: false,
        });
        return;
      }

      ws.accept();
      this.openaiWs = ws;

      ws.addEventListener("message", (event) => {
        this.handleOpenAIMessage(event);
      });

      ws.addEventListener("close", () => {
        this.openaiWs = null;
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.error",
            error: "OpenAI connection closed",
          });
        }
      });

      ws.addEventListener("error", () => {
        this.openaiWs = null;
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.error",
            error: "OpenAI connection error",
          });
        }
      });

      // Send session.update to configure the session
      const sessionUpdate: Record<string, unknown> = {
        type: "session.update",
        session: {
          instructions: scenario?.system_prompt ?? "You are a helpful assistant.",
          modalities: ["text"],
          tools: scenario?.tools ?? [],
          tool_choice: "auto",
          temperature: scenario?.session_overrides?.temperature ?? 0.7,
        },
      };
      ws.send(JSON.stringify(sessionUpdate));

      // Now send server.hello to client
      this.sendJson(clientWs, {
        type: "server.hello",
        sessionId: this.session.sessionId,
        scenarioId: this.session.scenarioId,
        openai: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(clientWs, {
        type: "server.error",
        error: `OpenAI connection failed: ${message}`,
      });
      // Send hello anyway so client isn't stuck
      this.sendJson(clientWs, {
        type: "server.hello",
        sessionId: this.session.sessionId,
        scenarioId: this.session.scenarioId,
        openai: false,
      });
    }
  }

  // ── Handle messages from OpenAI Realtime API ──────────────────
  private handleOpenAIMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") return;

    let msg: { type?: string; [key: string]: unknown };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    // Forward raw event for debugging if enabled
    if (this.env.OPENAI_LOG_EVENTS === "true" && this.clientWs) {
      this.sendJson(this.clientWs, {
        type: "debug.openai",
        event: msg,
      });
    }

    switch (msg.type) {
      // ── Text streaming ────────────────────────────────────────
      case "response.text.delta": {
        const delta =
          typeof msg.delta === "string" ? msg.delta : "";
        this.pendingResponseText += delta;
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.text.delta",
            role: "ai",
            delta,
          });
        }
        break;
      }

      case "response.text.done": {
        const fullText =
          typeof msg.text === "string"
            ? msg.text
            : this.pendingResponseText;
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.text.completed",
            role: "ai",
            text: fullText,
          });
        }
        this.pendingResponseText = "";
        break;
      }

      // ── Response lifecycle ────────────────────────────────────
      case "response.created":
      case "response.done":
        // Reset accumulator on new response
        if (msg.type === "response.created") {
          this.pendingResponseText = "";
        }
        break;

      // ── Error handling ────────────────────────────────────────
      case "error": {
        const errorData = msg.error as Record<string, unknown> | undefined;
        const errorMessage =
          typeof errorData?.message === "string"
            ? errorData.message
            : "Unknown OpenAI error";
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.error",
            error: `OpenAI: ${errorMessage}`,
          });
        }
        break;
      }

      // ── Session events (informational) ────────────────────────
      case "session.created":
      case "session.updated":
        // These confirm session configuration; no client action needed
        break;

      default:
        // Other events are forwarded via debug.openai above if logging is on
        break;
    }
  }

  // ── Client text -> OpenAI ─────────────────────────────────────
  private handleClientText(text: string): void {
    if (!this.openaiWs) {
      if (this.clientWs) {
        this.sendJson(this.clientWs, {
          type: "server.error",
          error: "Not connected to OpenAI",
        });
      }
      return;
    }

    // 1) Send conversation.item.create
    this.openaiWs.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
    );

    // 2) Trigger response generation
    this.openaiWs.send(
      JSON.stringify({
        type: "response.create",
      }),
    );
  }

  // ── Cleanup ───────────────────────────────────────────────────
  private cleanup(): void {
    this.session = { sessionId: "", scenarioId: null };
    this.clientWs = null;
    this.pendingResponseText = "";

    if (this.openaiWs) {
      try {
        this.openaiWs.close();
      } catch {
        // Already closed
      }
      this.openaiWs = null;
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
