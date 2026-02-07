/**
 * PCM16 audio player for streaming AI audio output.
 * Decodes base64-encoded PCM16 24kHz audio deltas and schedules
 * gapless playback through the Web Audio API.
 */

const INPUT_SAMPLE_RATE = 24000;

export class Pcm16Player {
  private ctx: AudioContext;
  private playbackTime = 0;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
  }

  /** Decode a base64-encoded PCM16 chunk and schedule it for playback. */
  playBase64Pcm16Delta(b64: string): void {
    // Resume context if suspended (browsers require user gesture)
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    // Decode base64 → binary
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Convert Int16 → Float32
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    // Create AudioBuffer at the source sample rate
    const audioBuffer = this.ctx.createBuffer(
      1,
      float32.length,
      INPUT_SAMPLE_RATE,
    );
    audioBuffer.getChannelData(0).set(float32);

    // Schedule gapless playback
    const now = this.ctx.currentTime;
    const startTime = Math.max(now, this.playbackTime);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);
    source.start(startTime);

    this.playbackTime = startTime + audioBuffer.duration;
  }

  /** Reset the playback queue (e.g. on barge-in or new response). */
  resetQueue(): void {
    this.playbackTime = this.ctx.currentTime;
  }

  /** Close the AudioContext and release resources. */
  close(): void {
    this.ctx.close().catch(() => {});
  }
}
