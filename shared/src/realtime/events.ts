// Minimal, compile-safe types for OpenAI Realtime event relay.
// Keep these permissive because the Realtime event model evolves.

export type JsonObject = Record<string, unknown>;

export type RealtimeClientEventType =
  | 'input_audio_buffer.append'
  | 'input_audio_buffer.commit'
  | 'response.cancel'
  | 'conversation.item.truncate'
  | 'response.create'
  | 'conversation.item.create'
  | 'session.update';

export type RealtimeServerEventType = string;

export type RealtimeClientEvent = JsonObject & { type: RealtimeClientEventType };
export type RealtimeServerEvent = JsonObject & { type: RealtimeServerEventType };

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
