import { DurableObject } from "cloudflare:workers";
import { SCENARIO_MAP } from "@shared";
import type { Scenario } from "@shared";

export interface Env {
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_LOG_EVENTS: string;
  REALTIME_SESSION: DurableObjectNamespace;
}

interface ClientMessage {
  type: string;
  [key: string]: unknown;
}

export class RealtimeSession extends DurableObject<Env> {
  private clientWs: WebSocket | null = null;
  private openaiWs: WebSocket | null = null;
  private scenario: Scenario | null = null;
  private currentResponseText = "";
  private logEvents = false;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const scenarioId = url.searchParams.get("scenarioId");
    if (!scenarioId) {
      return new Response("Missing scenarioId query param", { status: 400 });
    }

    const scenario = SCENARIO_MAP[scenarioId];
    if (!scenario) {
      return new Response(`Unknown scenario: ${scenarioId}`, { status: 404 });
    }

    this.scenario = scenario;
    this.logEvents = this.env.OPENAI_LOG_EVENTS === "true";

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);
    this.clientWs = server;

    // Connect to OpenAI in the background — send server.hello once ready
    this.connectToOpenAI();

    return new Response(null, { status: 101, webSocket: client });
  }

  private connectToOpenAI(): void {
    const model = this.env.OPENAI_MODEL;
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

    const openaiWs = new WebSocket(url, [
      "realtime",
      `openai-insecure-api-key.${this.env.OPENAI_API_KEY}`,
      "openai-beta.realtime-v1",
    ]);

    this.openaiWs = openaiWs;

    openaiWs.addEventListener("open", () => {
      this.sendSessionUpdate();
      this.sendToClient({
        type: "server.hello",
        scenarioId: this.scenario?.id,
        message: "Connected to OpenAI Realtime",
      });
    });

    openaiWs.addEventListener("message", (event) => {
      this.handleOpenAIMessage(event);
    });

    openaiWs.addEventListener("close", (event) => {
      console.log(`OpenAI WS closed: ${event.code} ${event.reason}`);
      this.sendToClient({
        type: "server.error",
        error: `OpenAI connection closed: ${event.code} ${event.reason || "unknown"}`,
      });
      this.openaiWs = null;
    });

    openaiWs.addEventListener("error", (event) => {
      console.error("OpenAI WS error:", event);
      this.sendToClient({
        type: "server.error",
        error: "OpenAI WebSocket connection error",
      });
    });
  }

  private sendSessionUpdate(): void {
    if (!this.openaiWs || !this.scenario) return;

    const tools = (this.scenario.tools ?? []).map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description ?? "",
      parameters: t.parameters,
    }));

    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions: this.scenario.system_prompt,
        modalities: ["text"],
        tools,
        tool_choice: "auto",
        temperature:
          this.scenario.session_overrides?.temperature ?? 0.7,
      },
    };

    this.openaiWs.send(JSON.stringify(sessionUpdate));
  }

  private handleOpenAIMessage(event: MessageEvent): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(typeof event.data === "string" ? event.data : "{}");
    } catch {
      console.error("Failed to parse OpenAI message:", event.data);
      return;
    }

    const eventType = data.type as string;

    // Forward raw event in debug mode
    if (this.logEvents) {
      this.sendToClient({
        type: "debug.openai",
        event: data,
      });
    }

    switch (eventType) {
      case "session.created":
      case "session.updated":
        // Informational — no action needed
        break;

      case "response.text.delta": {
        const delta = (data as { delta?: string }).delta ?? "";
        this.currentResponseText += delta;
        this.sendToClient({
          type: "server.text.delta",
          role: "ai",
          delta,
        });
        break;
      }

      case "response.text.done": {
        const fullText =
          (data as { text?: string }).text ?? this.currentResponseText;
        this.sendToClient({
          type: "server.text.completed",
          role: "ai",
          text: fullText,
        });
        this.currentResponseText = "";
        break;
      }

      case "response.done":
        // Response finished — reset accumulator as safety
        this.currentResponseText = "";
        break;

      case "error": {
        const errorData = data.error as
          | { message?: string; code?: string }
          | undefined;
        this.sendToClient({
          type: "server.error",
          error: errorData?.message ?? "Unknown OpenAI error",
          code: errorData?.code,
        });
        break;
      }

      default:
        // Other events are logged via debug.openai if enabled
        break;
    }
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") return;

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.sendToClient({
        type: "server.error",
        error: "Invalid JSON",
      });
      return;
    }

    switch (parsed.type) {
      case "client.ping":
        this.sendToClient({ type: "server.pong" });
        break;

      case "client.event":
        // Echo back for debugging
        this.sendToClient({
          type: "server.echo",
          original: parsed,
        });
        break;

      case "client.text":
        this.handleClientText(parsed.text as string);
        break;

      default:
        this.sendToClient({
          type: "server.error",
          error: `Unknown client event: ${parsed.type}`,
        });
    }
  }

  private handleClientText(text: string): void {
    if (!text || typeof text !== "string") {
      this.sendToClient({
        type: "server.error",
        error: "client.text requires a non-empty 'text' field",
      });
      return;
    }

    if (!this.openaiWs) {
      this.sendToClient({
        type: "server.error",
        error: "OpenAI connection not established yet",
      });
      return;
    }

    // Reset accumulator for new response
    this.currentResponseText = "";

    // Send conversation.item.create
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

    // Trigger response generation
    this.openaiWs.send(
      JSON.stringify({
        type: "response.create",
      }),
    );
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    console.log(`Client WS closed: ${code} ${reason}`);
    this.clientWs = null;

    // Close OpenAI connection when client disconnects
    if (this.openaiWs) {
      try {
        this.openaiWs.close(1000, "Client disconnected");
      } catch {
        // Already closed
      }
      this.openaiWs = null;
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    console.error("Client WS error");
    this.clientWs = null;
    if (this.openaiWs) {
      try {
        this.openaiWs.close(1000, "Client error");
      } catch {
        // Already closed
      }
      this.openaiWs = null;
    }
  }

  private sendToClient(data: Record<string, unknown>): void {
    if (!this.clientWs) return;
    try {
      this.clientWs.send(JSON.stringify(data));
    } catch (err) {
      console.error("Failed to send to client:", err);
    }
  }
}
