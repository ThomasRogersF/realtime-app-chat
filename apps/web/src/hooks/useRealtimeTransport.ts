import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

export interface UseRealtimeTransportOptions {
  /** Worker WS URL, e.g. ws://localhost:8787/ws */
  url: string;
  scenarioId: string;
  /** Called for every server event */
  onEvent?: (event: ServerEvent) => void;
}

export interface RealtimeTransport {
  status: ConnectionStatus;
  connect: () => void;
  disconnect: () => void;
  send: (message: Record<string, unknown>) => void;
}

export function useRealtimeTransport({
  url,
  scenarioId,
  onEvent,
}: UseRealtimeTransportOptions): RealtimeTransport {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close(1000, "User disconnect");
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const connect = useCallback(() => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close(1000, "Reconnecting");
      wsRef.current = null;
    }

    setStatus("connecting");

    const wsUrl = `${url}?scenarioId=${encodeURIComponent(scenarioId)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      // Status will be set to "connected" when we receive server.hello
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent;

        if (data.type === "server.hello") {
          setStatus("connected");
        }

        onEventRef.current?.(data);
      } catch {
        console.error("Failed to parse server message:", event.data);
      }
    });

    ws.addEventListener("close", () => {
      wsRef.current = null;
      setStatus("disconnected");
    });

    ws.addEventListener("error", () => {
      setStatus("error");
    });
  }, [url, scenarioId]);

  const send = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("Cannot send — WebSocket not open");
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmount");
        wsRef.current = null;
      }
    };
  }, []);

  return { status, connect, disconnect, send };
}
