import { useCallback, useRef, useState } from "react";

export type TransportStatus = "disconnected" | "connecting" | "connected";

export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

const MAX_EVENTS = 20;

const REALTIME_URL =
  import.meta.env.VITE_REALTIME_URL ?? "http://127.0.0.1:8787";

export function useRealtimeTransport() {
  const [status, setStatus] = useState<TransportStatus>("disconnected");
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  /** Phase 8: Expose the session key for the results page */
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  /**
   * Phase 10.2: Direct callback ref for server events.
   * Callers set this to handle events immediately from the WS message
   * handler, bypassing the capped `events` state array.
   */
  const onServerEventRef = useRef<((evt: RealtimeEvent) => void) | null>(null);

  const appendEvent = useCallback((evt: RealtimeEvent) => {
    setEvents((prev) => [...prev, evt].slice(-MAX_EVENTS));
  }, []);

  const connect = useCallback(
    async (scenarioId: string) => {
      if (wsRef.current) return;

      setStatus("connecting");
      setEvents([]);

      let sessionId: string;
      let token: string | null = null;

      // Phase 9A: Try POST /session to get a signed token
      try {
        const resp = await fetch(`${REALTIME_URL}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            sessionKey: string;
            token: string;
            expiresAt: string;
          };
          sessionId = data.sessionKey;
          token = data.token;
        } else {
          // Fallback: generate client-side UUID (dev / REQUIRE_AUTH=false)
          sessionId = crypto.randomUUID();
        }
      } catch {
        // Network error or endpoint not available — fallback
        sessionId = crypto.randomUUID();
      }

      setSessionKey(sessionId);
      const wsUrl = REALTIME_URL.replace(/^http/, "ws");
      let wsEndpoint = `${wsUrl}/realtime?session=${sessionId}&scenarioId=${encodeURIComponent(scenarioId)}`;
      if (token) {
        wsEndpoint += `&token=${encodeURIComponent(token)}`;
      }
      const ws = new WebSocket(wsEndpoint);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setStatus("connected");
        const hello: RealtimeEvent = {
          type: "client.hello",
          scenarioId,
        };
        ws.send(JSON.stringify(hello));
        appendEvent(hello);
      });

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data as string) as RealtimeEvent;
          appendEvent(data);
          // Phase 10.2: Deliver directly to avoid sliding-window drops
          onServerEventRef.current?.(data);
        } catch {
          appendEvent({ type: "parse_error", raw: event.data });
        }
      });

      ws.addEventListener("close", () => {
        wsRef.current = null;
        setStatus("disconnected");
      });

      ws.addEventListener("error", () => {
        wsRef.current = null;
        setStatus("disconnected");
      });
    },
    [appendEvent],
  );

  const send = useCallback((obj: RealtimeEvent) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
    appendEvent(obj);
  }, [appendEvent]);

  /** Convert PCM16 ArrayBuffer to base64 and send as client.audio.append */
  const sendAudioAppend = useCallback((buffer: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);
    ws.send(JSON.stringify({ type: "client.audio.append", audio: b64 }));
    // Don't appendEvent for audio chunks — too noisy for the event log
  }, []);

  /** Signal end of a speech turn */
  const sendAudioCommit = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = { type: "client.audio.commit" };
    ws.send(JSON.stringify(msg));
    appendEvent(msg);
  }, [appendEvent]);

  /** Request the model to generate a response */
  const sendResponseCreate = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = { type: "client.response.create" };
    ws.send(JSON.stringify(msg));
    appendEvent(msg);
  }, [appendEvent]);

  /** Phase 6: Cancel an in-flight response (barge-in) */
  const sendResponseCancel = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = { type: "client.response.cancel" };
    ws.send(JSON.stringify(msg));
    appendEvent(msg);
  }, [appendEvent]);

  /** Phase 8: Send end_call and let the server respond with call_ended */
  const endCall = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = { type: "client.end_call" };
    ws.send(JSON.stringify(msg));
    appendEvent(msg);
  }, [appendEvent]);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
    setSessionKey(null);
  }, []);

  return {
    status,
    events,
    sessionKey,
    /** Phase 10.2: Set this ref to receive server events directly from the WS handler. */
    onServerEventRef,
    connect,
    send,
    sendAudioAppend,
    sendAudioCommit,
    sendResponseCreate,
    sendResponseCancel,
    endCall,
    disconnect,
  } as const;
}
