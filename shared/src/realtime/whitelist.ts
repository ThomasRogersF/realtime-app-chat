import type { RealtimeClientEventType } from './events';

// Client event whitelist: only allow safe events from browser.
// SECURITY: session.update and conversation.item.create are DISALLOWED
// to prevent prompt injection and instruction tampering.
// The server controls system instructions and opening messages.
export const CLIENT_EVENT_WHITELIST: ReadonlySet<RealtimeClientEventType> = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'response.cancel',
  'conversation.item.truncate',
  'response.create'
]);
