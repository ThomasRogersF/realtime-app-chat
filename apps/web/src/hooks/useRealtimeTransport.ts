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

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  return { status, events, connect, send, disconnect } as const;
}
