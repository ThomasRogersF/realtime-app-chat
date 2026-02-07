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
  const wsRef = useRef<WebSocket | null>(null);

  const appendEvent = useCallback((evt: RealtimeEvent) => {
    setEvents((prev) => [...prev, evt].slice(-MAX_EVENTS));
  }, []);

  const connect = useCallback(
    (scenarioId: string) => {
      if (wsRef.current) return;

      setStatus("connecting");
      setEvents([]);

      const sessionId = crypto.randomUUID();
      const wsUrl = REALTIME_URL.replace(/^http/, "ws");
      const ws = new WebSocket(
        `${wsUrl}/realtime?session=${sessionId}&scenarioId=${encodeURIComponent(scenarioId)}`,
      );
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

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  return {
    status,
    events,
    connect,
    send,
    sendAudioAppend,
    sendAudioCommit,
    sendResponseCreate,
    sendResponseCancel,
    disconnect,
  } as const;
}
