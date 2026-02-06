import type { Env } from '../env';
import { isObject, safeJsonParse } from '../../../../shared/src/realtime/events';
import { CLIENT_EVENT_WHITELIST } from '../../../../shared/src/realtime/whitelist';
import { getScenarioById } from '../../../../shared/src/scenarios/loader';
import { GLOBAL_TUTOR_RULES } from '../../../../shared/src/tutor/rules';
import type { Scenario } from '../../../../shared/src/scenarios/types';

type ToolCallBuffer = {
  name?: string;
  argsText: string;
};

export class RealtimeSession implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  private scenarioId: string | null = null;
  private scenario: Scenario | null = null;

  private clientSocket: WebSocket | null = null;
  private upstreamSocket: WebSocket | null = null;

  private toolArgsByCallId = new Map<string, ToolCallBuffer>();
  private debugMode = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.debugMode = (env.DEBUG_RELAY ?? '').toLowerCase() === 'true';
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // We expect the Worker to forward the original /ws request.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const scenarioId = url.searchParams.get('scenario') ?? '';
    if (!scenarioId) {
      return new Response('Missing scenario', { status: 400 });
    }

    this.scenarioId = scenarioId;
    this.scenario = getScenarioById(scenarioId);

    // SECURITY: Validate scenario exists server-side
    if (!this.scenario) {
      this.log(`Scenario not found: ${scenarioId}`);
      return new Response(JSON.stringify({ error: `Scenario not found: ${scenarioId}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.clientSocket = server;
    this.log(`Client WebSocket connected for scenario: ${scenarioId}`);

    server.addEventListener('message', (evt: MessageEvent) => {
      void this.onClientMessage(String(evt.data));
    });

    server.addEventListener('close', () => {
      this.log('Client WebSocket closed');
      void this.closeAll('client_closed');
    });

    server.addEventListener('error', (evt) => {
      this.log('Client WebSocket error', evt);
      void this.closeAll('client_error');
    });

    // Start upstream connection in background.
    void this.connectUpstream();

    // Cloudflare Workers supports `webSocket` on ResponseInit.
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  private async connectUpstream(): Promise<void> {
    if (!this.clientSocket) return;

    const model = this.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
    const upstreamUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

    this.log(`Connecting to OpenAI Realtime: ${upstreamUrl}`);

    try {
      // Cloudflare Workers WebSocket: use fetch() with headers for auth.
      // This is the official method for outbound WebSocket with custom headers.
      const resp = await fetch(upstreamUrl, {
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.log(`Upstream fetch response status: ${resp.status}`);

      if (resp.status !== 101) {
        const errorText = await resp.text().catch(() => 'Unable to read error');
        this.log(`Upstream WebSocket upgrade failed: ${resp.status} - ${errorText}`);
        this.sendClientRaw(
          JSON.stringify({
            type: 'error',
            error: `Upstream connection failed: ${resp.status}`,
            details: errorText
          })
        );
        await this.closeAll('upstream_upgrade_failed');
        return;
      }

      // Get the WebSocket from the response
      const ws = resp.webSocket;
      if (!ws) {
        this.log('No webSocket in response despite 101 status');
        this.sendClientRaw(
          JSON.stringify({ type: 'error', error: 'No WebSocket in upstream response' })
        );
        await this.closeAll('upstream_no_websocket');
        return;
      }

      ws.accept();
      this.upstreamSocket = ws;
      this.log('Upstream WebSocket accepted');

      ws.addEventListener('open', () => {
        this.log('Upstream WebSocket opened');
        void this.onUpstreamOpen();
      });

      ws.addEventListener('message', (evt: MessageEvent) => {
        void this.onUpstreamMessage(String(evt.data));
      });

      ws.addEventListener('close', (evt) => {
        this.log(`Upstream WebSocket closed: code=${evt.code}, reason=${evt.reason}`);
        void this.closeAll('upstream_closed');
      });

      ws.addEventListener('error', (evt) => {
        this.log('Upstream WebSocket error', evt);
        void this.closeAll('upstream_error');
      });
    } catch (err) {
      this.log('Exception connecting to upstream', err);
      this.sendClientRaw(
        JSON.stringify({
          type: 'error',
          error: 'Failed to connect to OpenAI',
          details: err instanceof Error ? err.message : String(err)
        })
      );
      await this.closeAll('upstream_exception');
    }
  }

  private async onUpstreamOpen(): Promise<void> {
    if (!this.upstreamSocket) return;

    const scenario = this.scenario;
    const scenarioSystem = scenario?.system ?? 'You are a helpful tutor.';
    const tools = scenario?.tools ?? [];

    this.log('Sending session.update to upstream');

    // 1) session.update
    this.sendUpstream({
      type: 'session.update',
      session: {
        instructions: `${GLOBAL_TUTOR_RULES}\n\n${scenarioSystem}`,
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200
        },
        modalities: ['audio', 'text'],
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        tools
      }
    });

    // 2) opening assistant message
    const opening = scenario?.opening_line ?? 'Hello!';
    this.log(`Sending opening message: ${opening}`);
    this.sendUpstream({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: opening }]
      }
    });

    // 3) response.create
    this.log('Sending response.create');
    this.sendUpstream({ type: 'response.create' });
  }

  private async onClientMessage(text: string): Promise<void> {
    if (!this.upstreamSocket) return;

    const parsed = safeJsonParse(text);
    if (!parsed.ok || !isObject(parsed.value)) return;

    const evt = parsed.value as Record<string, unknown>;
    const type = evt.type;
    if (typeof type !== 'string') return;

    // SECURITY: Whitelist check
    if (!CLIENT_EVENT_WHITELIST.has(type as any)) {
      this.log(`Blocked disallowed client event: ${type}`);
      // Send warning to client for debugging
      this.sendClientRaw(
        JSON.stringify({
          type: 'debug.warning',
          message: `Event type '${type}' is not allowed from client`,
          blocked_event: type
        })
      );
      return;
    }

    this.sendUpstream(evt);
  }

  private async onUpstreamMessage(text: string): Promise<void> {
    // Relay everything upstream -> client.
    this.sendClientRaw(text);

    // Also inspect for tool calling events.
    const parsed = safeJsonParse(text);
    if (!parsed.ok || !isObject(parsed.value)) return;

    const evt = parsed.value as Record<string, unknown>;
    const type = evt.type;
    if (typeof type !== 'string') return;

    if (type === 'response.function_call_arguments.delta') {
      this.onToolArgsDelta(evt);
      return;
    }

    if (type === 'response.function_call_arguments.done') {
      await this.onToolArgsDone(evt);
      return;
    }
  }

  private onToolArgsDelta(evt: Record<string, unknown>): void {
    const callId = typeof evt.call_id === 'string' ? evt.call_id : null;
    const delta = typeof evt.delta === 'string' ? evt.delta : '';
    const name = typeof evt.name === 'string' ? evt.name : undefined;
    if (!callId) return;

    const existing = this.toolArgsByCallId.get(callId) ?? { argsText: '' };
    existing.argsText += delta;
    if (name) existing.name = name;
    this.toolArgsByCallId.set(callId, existing);
  }

  private async onToolArgsDone(evt: Record<string, unknown>): Promise<void> {
    const callId = typeof evt.call_id === 'string' ? evt.call_id : null;
    const name = typeof evt.name === 'string' ? evt.name : null;
    if (!callId || !name) return;

    const buf = this.toolArgsByCallId.get(callId);
    const argsText = buf?.argsText ?? '';

    this.log(`Tool call complete: ${name}(${argsText})`);

    let args: any = {};
    let parseError: string | null = null;

    if (argsText.trim()) {
      const parsed = safeJsonParse(argsText);
      if (parsed.ok && isObject(parsed.value)) {
        args = parsed.value;
      } else {
        parseError = parsed.ok ? 'Tool args must be an object' : parsed.error;
      }
    }

    const output = await this.runToolSafe(name, args, parseError);

    // Send function_call_output
    this.sendUpstream({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output)
      }
    });

    // Ask model to continue.
    this.sendUpstream({ type: 'response.create' });

    this.toolArgsByCallId.delete(callId);
  }

  private async runToolSafe(name: string, args: any, parseError: string | null): Promise<unknown> {
    try {
      if (parseError) {
        return { ok: false, error: `Failed to parse tool args: ${parseError}` };
      }

      if (name === 'grade_lesson') {
        return this.tool_grade_lesson(args);
      }

      if (name === 'trigger_quiz') {
        return this.tool_trigger_quiz(args);
      }

      return { ok: false, error: `Unknown tool: ${name}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private tool_grade_lesson(_args: any): unknown {
    this.log('Tool: grade_lesson (stub)');
    return { ok: true, score: 0.8, notes: 'stub' };
  }

  private tool_trigger_quiz(args: any): unknown {
    this.log('Tool: trigger_quiz (stub)');
    const lessonId = typeof args?.lesson_id === 'string' ? args.lesson_id : this.scenarioId;
    return { ok: true, quiz: { lesson_id: lessonId } };
  }

  private sendUpstream(evt: unknown): void {
    if (!this.upstreamSocket) return;
    this.upstreamSocket.send(JSON.stringify(evt));
  }

  private sendClientRaw(text: string): void {
    if (!this.clientSocket) return;
    this.clientSocket.send(text);
  }

  private async closeAll(reason: string): Promise<void> {
    this.log(`Closing all connections: ${reason}`);
    try {
      this.clientSocket?.close();
    } catch {}
    try {
      this.upstreamSocket?.close();
    } catch {}

    this.clientSocket = null;
    this.upstreamSocket = null;
  }

  private log(message: string, ...args: any[]): void {
    if (this.debugMode) {
      console.log(`[RealtimeSession ${this.scenarioId}]`, message, ...args);
    }
  }
}
