/**
 * PCM16 audio player for streaming AI audio output.
 * Decodes base64-encoded PCM16 24kHz audio deltas and schedules
 * gapless playback through the Web Audio API.
 *
 * Phase 6: Added GainNode for instant hard-stop on barge-in.
 */

const INPUT_SAMPLE_RATE = 24000;

export class Pcm16Player {
  private ctx: AudioContext;
  private gain: GainNode;
  private playbackTime = 0;
  /** Track active sources so stopHard() can stop them immediately */
  private activeSources: AudioBufferSourceNode[] = [];

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
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

    // Schedule gapless playback through the GainNode
    const now = this.ctx.currentTime;
    const startTime = Math.max(now, this.playbackTime);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gain);
    source.start(startTime);

    // Track this source for hard-stop; remove when it finishes naturally
    this.activeSources.push(source);
    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) this.activeSources.splice(idx, 1);
    };

    this.playbackTime = startTime + audioBuffer.duration;
  }

  /**
   * Phase 6: Immediately silence all playing and scheduled audio.
   * Stops every active BufferSourceNode and resets the gain to 1
   * so subsequent playback works normally.
   */
  stopHard(): void {
    // Stop all active/scheduled sources immediately
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        // Already stopped
      }
    }
    this.activeSources = [];

    // Reset playback time so new chunks start immediately
    this.playbackTime = this.ctx.currentTime;

    // Ensure gain is at full volume for next playback
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(1, this.ctx.currentTime);
  }

  /** Reset the playback queue (e.g. on barge-in or new response). */
  resetQueue(): void {
    this.playbackTime = this.ctx.currentTime;
  }

  /** Close the AudioContext and release resources. */
  close(): void {
    this.activeSources = [];
    this.ctx.close().catch(() => {});
  }
}
