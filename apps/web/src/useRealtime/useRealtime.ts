import { useEffect, useMemo, useRef, useState } from 'react';
import type { TranscriptItem } from '../ui/CallScreen';

type UseRealtimeArgs = {
  enabled: boolean;
  scenarioId: string;
  userId: string;
};

type AnyEvent = Record<string, unknown> & { type?: string };

export function useRealtime(args: UseRealtimeArgs) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AnyEvent[]>([]);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => {
    const url = new URL('/ws', window.location.href);
    url.searchParams.set('scenario', args.scenarioId);
    url.searchParams.set('user', args.userId);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }, [args.scenarioId, args.userId]);

  useEffect(() => {
    if (!args.enabled) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener('open', () => setConnected(true));
    ws.addEventListener('close', () => setConnected(false));
    ws.addEventListener('error', () => setConnected(false));

    ws.addEventListener('message', (evt) => {
      let parsed: AnyEvent | null = null;
      try {
        parsed = JSON.parse(String(evt.data)) as AnyEvent;
      } catch {
        // ignore non-JSON
      }

      if (parsed) {
        setEvents((prev) => [...prev.slice(-9), parsed!]);
        maybeAppendTranscript(parsed);
      }
    });

    function maybeAppendTranscript(e: AnyEvent) {
      // Placeholder parsing: OpenAI Realtime emits many event types.
      // We try to extract text from common shapes.
      // TODO: refine once audio + full event model is wired.

      // 1) conversation.item.created with message content
      if (e.type === 'conversation.item.created' && typeof e.item === 'object' && e.item) {
        const item: any = e.item;
        if (item.type === 'message' && (item.role === 'assistant' || item.role === 'user')) {
          const text = extractTextFromContent(item.content);
          if (text) {
            setTranscript((prev) => [
              ...prev,
              { id: crypto.randomUUID(), role: item.role, text }
            ]);
          }
        }
      }

      // 2) response.output_text.delta (common in some SDKs)
      if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') {
        const deltaText = String(e.delta);
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, text: last.text + deltaText }];
          }
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', text: deltaText }];
        });
      }

      // 3) response.text.delta (fallback)
      if (e.type === 'response.text.delta' && typeof e.delta === 'string') {
        const deltaText = String(e.delta);
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, text: last.text + deltaText }];
          }
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', text: deltaText }];
        });
      }
    }

    function extractTextFromContent(content: any): string {
      if (!Array.isArray(content)) return '';
      const parts = content
        .map((p) => {
          if (p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string') return p.text;
          return '';
        })
        .filter(Boolean);
      return parts.join('');
    }

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [args.enabled, wsUrl]);

  return { connected, events, transcript };
}
