import type { Env } from "./index";
import { LocalScenarioRegistry } from "@shared";
import type { Scenario } from "@shared";
import { runTool, type ToolContext } from "./tools/toolRunner";

interface SessionState {
  sessionId: string;
  scenarioId: string | null;
}

/** Shape of each persisted tool result entry */
interface ToolResultEntry {
  name: string;
  result: Record<string, unknown>;
  at: string; // ISO timestamp
}

/** Phase 9B: Transcript excerpt entry */
interface TranscriptEntry {
  role: "user" | "ai";
  text: string;
  at: string;
}

/** Phase 9B: Progress tracking */
interface SessionProgress {
  completed: boolean;
  completionScore: number | null;
  completedAt: string | null;
}

/** Phase 9A: Session stats counters */
interface SessionStats {
  audioChunksIn: number;
  audioChunksOut: number;
  toolCalls: number;
  responsesCreated: number;
}

const MAX_TRANSCRIPT_ENTRIES = 30;

const registry = new LocalScenarioRegistry();

/**
 * Durable Object that manages a single realtime session.
 * Phase 3-7: WebSocket relay between client and OpenAI Realtime API.
 * Phase 8: Persists tool results, supports end-call flow, exposes summary.
 * Phase 9A: Guardrails (max duration, max responses) and session stats.
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
  /** Accumulates response.audio_transcript.delta content for the current response */
  private pendingAudioTranscript = "";
  /** Phase 7: Tracks call_ids already dispatched to avoid duplicate execution */
  private pendingToolCalls = new Set<string>();

  /** Phase 8: In-memory mirror of persisted tool results */
  private toolResults: ToolResultEntry[] = [];
  /** Phase 8: Session timing */
  private startedAt: string | null = null;
  private endedAt: string | null = null;

  /** Phase 9A: Guardrails */
  private terminationReason: string | null = null;
  private guardrailTimer: ReturnType<typeof setInterval> | null = null;

  /** Phase 9A: Session stats */
  private stats: SessionStats = {
    audioChunksIn: 0,
    audioChunksOut: 0,
    toolCalls: 0,
    responsesCreated: 0,
  };
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  /** Phase 9B: In-memory transcript excerpt (last N entries) */
  private transcript: TranscriptEntry[] = [];
  /** Phase 9B: Progress tracking */
  private progress: SessionProgress = {
    completed: false,
    completionScore: null,
    completedAt: null,
  };
  /** Phase 9B: Loaded scenario (cached after first load) */
  private loadedScenario: Scenario | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Hydrate in-memory state from storage on construction
    this.state.blockConcurrencyWhile(async () => {
      this.toolResults =
        (await this.state.storage.get<ToolResultEntry[]>("toolResults")) ?? [];
      this.startedAt =
        (await this.state.storage.get<string>("startedAt")) ?? null;
      this.endedAt =
        (await this.state.storage.get<string>("endedAt")) ?? null;
      this.terminationReason =
        (await this.state.storage.get<string>("terminationReason")) ?? null;
      const storedStats =
        await this.state.storage.get<SessionStats>("stats");
      if (storedStats) {
        this.stats = storedStats;
      }
      const storedScenarioId =
        (await this.state.storage.get<string>("scenarioId")) ?? null;
      if (storedScenarioId) {
        this.session.scenarioId = storedScenarioId;
      }
      // Phase 9B: Hydrate transcript and progress
      this.transcript =
        (await this.state.storage.get<TranscriptEntry[]>("transcript")) ?? [];
      const storedProgress =
        await this.state.storage.get<SessionProgress>("progress");
      if (storedProgress) {
        this.progress = storedProgress;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── Phase 8: Internal summary endpoint (non-WebSocket) ───
    if (url.pathname === "/internal/summary") {
      return this.handleSummaryRequest();
    }

    // ── Origin check ──────────────────────────────────────────
    if (!this.isOriginAllowed(request)) {
      return new Response("Forbidden", { status: 403 });
    }

    // ── WebSocket upgrade ─────────────────────────────────────
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    const sessionKey = url.searchParams.get("session") ?? crypto.randomUUID();
    const scenarioId = url.searchParams.get("scenarioId") ?? null;

    this.session = { sessionId: sessionKey, scenarioId };

    // Phase 8: Persist session metadata at start
    this.startedAt = new Date().toISOString();
    if (scenarioId) {
      await this.state.storage.put("scenarioId", scenarioId);
    }
    await this.state.storage.put("startedAt", this.startedAt);

    server.accept();
    this.clientWs = server;

    // Phase 9A: Start guardrail timer
    this.startGuardrailTimer();
    // Phase 9A: Start stats broadcast timer (dev-only)
    this.startStatsBroadcast();

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

  // ── Phase 9A: Guardrail timer ────────────────────────────────
  private startGuardrailTimer(): void {
    const maxSeconds = parseInt(this.env.MAX_SESSION_SECONDS || "600", 10);
    // Check every 5 seconds
    this.guardrailTimer = setInterval(() => {
      if (!this.startedAt) return;
      const elapsed = (Date.now() - new Date(this.startedAt).getTime()) / 1000;
      if (elapsed > maxSeconds) {
        this.terminateSession("time_limit", "Session time limit reached");
      }
    }, 5000);
  }

  // ── Phase 9A: Stats broadcast (dev-only, every 15s) ─────────
  private startStatsBroadcast(): void {
    if (this.env.OPENAI_LOG_EVENTS !== "true") return;
    this.statsTimer = setInterval(() => {
      if (this.clientWs) {
        this.sendJson(this.clientWs, {
          type: "server.stats",
          ...this.stats,
          elapsedSeconds: this.startedAt
            ? Math.floor((Date.now() - new Date(this.startedAt).getTime()) / 1000)
            : 0,
        });
      }
    }, 15000);
  }

  // ── Phase 9A: Check response limit ───────────────────────────
  private checkResponseLimit(): void {
    const maxResponses = parseInt(this.env.MAX_RESPONSES || "60", 10);
    if (this.stats.responsesCreated > maxResponses) {
      this.terminateSession("response_limit", "Response limit reached");
    }
  }

  // ── Phase 9A: Graceful session termination ───────────────────
  private async terminateSession(
    reason: string,
    message: string,
  ): Promise<void> {
    // Prevent double-termination
    if (this.terminationReason) return;
    this.terminationReason = reason;

    // Persist termination
    this.endedAt = new Date().toISOString();
    await this.state.storage.put("endedAt", this.endedAt);
    await this.state.storage.put("terminationReason", reason);
    await this.state.storage.put("stats", this.stats);

    // Notify client
    if (this.clientWs) {
      this.sendJson(this.clientWs, {
        type: "server.error",
        error: message,
      });
      this.sendJson(this.clientWs, {
        type: "server.call_ended",
        reason,
      });
    }

    // Close OpenAI WS
    if (this.openaiWs) {
      try {
        this.openaiWs.close(1000, reason);
      } catch {
        // Already closed
      }
      this.openaiWs = null;
    }

    // Close client WS
    if (this.clientWs) {
      try {
        this.clientWs.close(1000, reason);
      } catch {
        // Already closed
      }
      this.clientWs = null;
    }

    this.clearTimers();
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

      // ── Phase 4: Audio forwarding ────────────────────────────
      case "client.audio.append": {
        if (typeof msg.audio !== "string") {
          this.sendJson(ws, {
            type: "server.error",
            error: "client.audio.append requires a base64 'audio' field",
          });
          break;
        }
        // Phase 9A: Track audio in
        this.stats.audioChunksIn++;
        this.forwardToOpenAI({
          type: "input_audio_buffer.append",
          audio: msg.audio,
        });
        break;
      }

      case "client.audio.commit": {
        this.forwardToOpenAI({ type: "input_audio_buffer.commit" });
        break;
      }

      case "client.response.create": {
        // Phase 9A: Track response creation
        this.stats.responsesCreated++;
        this.checkResponseLimit();
        this.forwardToOpenAI({ type: "response.create" });
        break;
      }

      // ── Phase 6: Barge-in — cancel in-flight response ─────
      case "client.response.cancel": {
        this.forwardToOpenAI({ type: "response.cancel" });
        break;
      }

      // ── Phase 8: End call ──────────────────────────────────
      case "client.end_call": {
        this.handleEndCall(ws);
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
    // Load scenario (and cache for later use in grading)
    let scenario: Scenario | null = null;
    if (scenarioId) {
      try {
        scenario = await registry.getScenarioById(scenarioId);
        this.loadedScenario = scenario;
      } catch {
        this.sendJson(clientWs, {
          type: "server.error",
          error: `Failed to load scenario: ${scenarioId}`,
        });
      }
    }

    // Build OpenAI WS URL
    const model = this.env.OPENAI_MODEL || "gpt-realtime-mini-2025-12-15";
    const openaiUrl = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

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
      // Phase 5: enable both text and audio output; PCM16 in/out
      const voice = scenario?.session_overrides?.voice ?? "alloy";
      const sessionUpdate: Record<string, unknown> = {
        type: "session.update",
        session: {
          instructions: scenario?.system_prompt ?? "You are a helpful assistant.",
          modalities: ["text", "audio"],
          voice,
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
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
        // Phase 9B: Track AI text in transcript excerpt
        if (fullText) {
          this.appendTranscript("ai", fullText);
        }
        this.pendingResponseText = "";
        break;
      }

      // ── Phase 10: Audio transcript streaming ──────────────────
      case "response.audio_transcript.delta": {
        const delta =
          typeof msg.delta === "string" ? msg.delta : "";
        this.pendingAudioTranscript += delta;
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.text.delta",
            role: "ai",
            delta,
          });
        }
        break;
      }

      case "response.audio_transcript.done": {
        const transcript =
          typeof msg.transcript === "string"
            ? msg.transcript
            : this.pendingAudioTranscript;
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.text.completed",
            role: "ai",
            text: transcript,
          });
        }
        // Phase 9B: Track AI audio transcript in transcript excerpt
        if (transcript) {
          this.appendTranscript("ai", transcript);
        }
        this.pendingAudioTranscript = "";
        break;
      }

      // ── Response lifecycle ────────────────────────────────────
      case "response.created": {
        // Reset accumulators on new response
        this.pendingResponseText = "";
        this.pendingAudioTranscript = "";
        // Phase 9A: Count responses from OpenAI (server-initiated responses)
        this.stats.responsesCreated++;
        this.checkResponseLimit();
        break;
      }

      case "response.done": {
        if (this.clientWs) {
          this.sendJson(this.clientWs, { type: "server.response.done" });
        }
        break;
      }

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

      // ── Phase 5: Audio output streaming ─────────────────────
      case "response.audio.delta": {
        const delta = typeof msg.delta === "string" ? msg.delta : "";
        if (this.clientWs && delta) {
          // Phase 9A: Track audio out
          this.stats.audioChunksOut++;
          this.sendJson(this.clientWs, {
            type: "server.audio.delta",
            delta,
          });
        }
        break;
      }

      case "response.audio.done": {
        if (this.clientWs) {
          this.sendJson(this.clientWs, { type: "server.audio.done" });
        }
        break;
      }

      // ── Phase 4: Transcription events ────────────────────────
      case "conversation.item.input_audio_transcription.completed": {
        const transcript =
          typeof msg.transcript === "string" ? msg.transcript : "";
        if (this.clientWs && transcript) {
          this.sendJson(this.clientWs, {
            type: "server.transcription.completed",
            role: "user",
            text: transcript,
          });
        }
        // Phase 9B: Track user speech in transcript excerpt
        if (transcript) {
          this.appendTranscript("user", transcript);
        }
        break;
      }

      case "conversation.item.input_audio_transcription.failed": {
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.error",
            error: "Audio transcription failed",
          });
        }
        break;
      }

      // ── Phase 6: Voice activity detection (barge-in) ────────
      case "input_audio_buffer.speech_started": {
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.user_speech_started",
          });
        }
        break;
      }

      case "input_audio_buffer.speech_stopped": {
        if (this.clientWs) {
          this.sendJson(this.clientWs, {
            type: "server.user_speech_stopped",
          });
        }
        break;
      }

      // ── Phase 7: Tool call detection ────────────────────────
      // Primary path: OpenAI Realtime API emits this when function call
      // arguments are fully streamed.
      case "response.function_call_arguments.done": {
        const callId = typeof msg.call_id === "string" ? msg.call_id : undefined;
        const toolName = typeof msg.name === "string" ? msg.name : "";
        const rawArgs = typeof msg.arguments === "string" ? msg.arguments : "{}";
        if (toolName) {
          this.handleToolCall(toolName, rawArgs, callId);
        }
        break;
      }

      // Secondary / defensive path: response.output_item.done may contain
      // a complete function_call item. We only act if we can extract what
      // we need and the primary path hasn't already handled it (keyed on
      // call_id via the pendingToolCalls set).
      case "response.output_item.done": {
        const item = msg.item as Record<string, unknown> | undefined;
        if (item && item.type === "function_call") {
          const callId = typeof item.call_id === "string" ? item.call_id : undefined;
          // Skip if we already handled this via the primary path
          if (callId && this.pendingToolCalls.has(callId)) break;
          const toolName = typeof item.name === "string" ? item.name : "";
          const rawArgs = typeof item.arguments === "string" ? item.arguments : "{}";
          if (toolName) {
            this.handleToolCall(toolName, rawArgs, callId);
          }
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

  // ── Phase 7: Tool call execution ────────────────────────────────
  private async handleToolCall(
    name: string,
    rawArgs: string,
    callId?: string,
  ): Promise<void> {
    // De-duplicate: mark this call_id as in-flight
    if (callId) {
      if (this.pendingToolCalls.has(callId)) return;
      this.pendingToolCalls.add(callId);
    }

    // Parse arguments defensively
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(rawArgs);
    } catch {
      args = {};
    }

    // Phase 9A: Track tool calls
    this.stats.toolCalls++;

    // 1) Execute the tool handler (Phase 9B: enriched context)
    const result = await runTool(name, args, this.buildToolContext());

    // 2) Send function_call_output back to OpenAI
    const outputItem: Record<string, unknown> = {
      type: "function_call_output",
      output: JSON.stringify(result),
    };
    if (callId) {
      outputItem.call_id = callId;
    }

    this.forwardToOpenAI({
      type: "conversation.item.create",
      item: outputItem,
    });

    // 3) Always trigger response.create so the model continues speaking
    this.forwardToOpenAI({ type: "response.create" });

    // 4) Phase 8: Persist tool result in DO storage
    const entry: ToolResultEntry = {
      name,
      result,
      at: new Date().toISOString(),
    };
    this.toolResults.push(entry);
    await this.state.storage.put("toolResults", this.toolResults);

    // 5) Forward tool result to client as a non-audio event
    if (this.clientWs) {
      this.sendJson(this.clientWs, {
        type: "server.tool_result",
        name,
        result,
      });
    }

    // Clean up tracking set
    if (callId) {
      this.pendingToolCalls.delete(callId);
    }
  }

  // ── Forward arbitrary JSON to OpenAI WS ────────────────────────
  private forwardToOpenAI(data: Record<string, unknown>): void {
    if (!this.openaiWs) {
      if (this.clientWs) {
        this.sendJson(this.clientWs, {
          type: "server.error",
          error: "Not connected to OpenAI",
        });
      }
      return;
    }
    try {
      this.openaiWs.send(JSON.stringify(data));
    } catch {
      if (this.clientWs) {
        this.sendJson(this.clientWs, {
          type: "server.error",
          error: "Failed to send to OpenAI",
        });
      }
    }
  }

  // ── Phase 8 + 9B: End call ──────────────────────────────────
  private async handleEndCall(ws: WebSocket): Promise<void> {
    // Phase 9B: Ensure scenario is loaded for rubric/auto_quiz access
    await this.ensureScenarioLoaded();
    const ctx = this.buildToolContext();

    // Auto-grade if no grade_lesson result exists yet
    const hasGrade = this.toolResults.some((tr) => tr.name === "grade_lesson");
    if (!hasGrade) {
      const result = await runTool(
        "grade_lesson",
        { topic: this.session.scenarioId ?? "general conversation" },
        ctx,
      );
      const entry: ToolResultEntry = {
        name: "grade_lesson",
        result,
        at: new Date().toISOString(),
      };
      this.toolResults.push(entry);
      await this.state.storage.put("toolResults", this.toolResults);
    }

    // Phase 9B: Auto-quiz if scenario says enabled on end_call
    const autoQuiz = this.loadedScenario?.auto_quiz;
    if (autoQuiz?.enabled && autoQuiz.when === "end_call") {
      const hasQuiz = this.toolResults.some(
        (tr) => tr.name === "trigger_quiz",
      );
      if (!hasQuiz) {
        const quizResult = await runTool(
          "trigger_quiz",
          {
            topic: this.session.scenarioId ?? "vocabulary review",
            num_questions: autoQuiz.num_questions ?? 3,
          },
          ctx,
        );
        const quizEntry: ToolResultEntry = {
          name: "trigger_quiz",
          result: quizResult,
          at: new Date().toISOString(),
        };
        this.toolResults.push(quizEntry);
        await this.state.storage.put("toolResults", this.toolResults);
      }
    }

    // Persist endedAt and stats
    this.endedAt = new Date().toISOString();
    await this.state.storage.put("endedAt", this.endedAt);
    await this.state.storage.put("stats", this.stats);

    // Phase 9B: Persist transcript excerpt
    await this.persistTranscript();

    // Phase 9B: Persist progress
    const latestGrade = [...this.toolResults]
      .reverse()
      .find((tr) => tr.name === "grade_lesson");
    const gradeScore =
      latestGrade && typeof latestGrade.result.score === "number"
        ? latestGrade.result.score
        : null;
    this.progress = {
      completed: true,
      completionScore: gradeScore,
      completedAt: this.endedAt,
    };
    await this.state.storage.put("progress", this.progress);

    // Close OpenAI WS cleanly
    if (this.openaiWs) {
      try {
        this.openaiWs.close(1000, "call_ended");
      } catch {
        // Already closed
      }
      this.openaiWs = null;
    }

    // Tell client the call has ended
    this.sendJson(ws, { type: "server.call_ended" });

    this.clearTimers();
  }

  // ── Phase 8 + 9B: Summary endpoint handler ─────────────────
  private handleSummaryRequest(): Response {
    // Phase 9B: Extract latest grade and quiz from toolResults
    const latestGrade = [...this.toolResults]
      .reverse()
      .find((tr) => tr.name === "grade_lesson");
    const latestQuiz = [...this.toolResults]
      .reverse()
      .find((tr) => tr.name === "trigger_quiz");

    const body = {
      sessionKey: this.session.sessionId || null,
      scenarioId: this.session.scenarioId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      // Phase 9A
      terminationReason: this.terminationReason,
      stats: this.stats,
      toolResults: this.toolResults,
      // Phase 9B
      transcriptExcerpt: this.transcript,
      progress: this.progress,
      grade: latestGrade?.result ?? null,
      quiz: latestQuiz?.result ?? null,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────
  private cleanup(): void {
    this.clientWs = null;
    this.pendingResponseText = "";
    this.pendingAudioTranscript = "";
    this.pendingToolCalls.clear();

    if (this.openaiWs) {
      try {
        this.openaiWs.close();
      } catch {
        // Already closed
      }
      this.openaiWs = null;
    }

    this.clearTimers();
  }

  /** Phase 9A: Clear all interval timers */
  private clearTimers(): void {
    if (this.guardrailTimer) {
      clearInterval(this.guardrailTimer);
      this.guardrailTimer = null;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  // ── Phase 9B: Build enriched tool context ────────────────────
  private buildToolContext(): ToolContext {
    return {
      scenarioId: this.session.scenarioId ?? undefined,
      sessionId: this.session.sessionId,
      transcript: this.transcript,
      targetPhrases: this.loadedScenario?.target_phrases,
      rubric: this.loadedScenario?.grading_rubric,
    };
  }

  // ── Phase 9B: Ensure scenario is loaded (for end_call path) ─
  private async ensureScenarioLoaded(): Promise<void> {
    if (this.loadedScenario) return;
    if (!this.session.scenarioId) return;
    try {
      this.loadedScenario = await registry.getScenarioById(
        this.session.scenarioId,
      );
    } catch {
      // Scenario not found — proceed without it
    }
  }

  // ── Phase 9B: Transcript helpers ─────────────────────────────
  private appendTranscript(role: "user" | "ai", text: string): void {
    if (!text.trim()) return;
    this.transcript.push({ role, text, at: new Date().toISOString() });
    // Keep only last N entries
    if (this.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
      this.transcript = this.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
    }
  }

  private async persistTranscript(): Promise<void> {
    await this.state.storage.put("transcript", this.transcript);
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
