import { useCallback, useRef, useState } from "react";

export interface UseMicPcmStream {
  /** Begin capturing mic audio. Each PCM16 24kHz chunk fires onChunk. */
  start: () => Promise<void>;
  /** Stop capturing and release resources. */
  stop: () => void;
  isCapturing: boolean;
  error: string | null;
}

/**
 * Hook that captures microphone audio via an AudioWorklet,
 * resamples to 24 kHz PCM16, and delivers ArrayBuffer chunks
 * through the provided callback.
 */
export function useMicPcmStream(
  onChunk: (buffer: ArrayBuffer) => void,
): UseMicPcmStream {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Stable ref to always have the latest onChunk without re-creating start()
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  const start = useCallback(async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: undefined as unknown as number });
      // Let browser pick its native sampleRate (usually 44100 or 48000).
      // The worklet will resample to 24 kHz.
      audioCtxRef.current = ctx;

      await ctx.audioWorklet.addModule("/pcm16-processor.js");

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const worklet = new AudioWorkletNode(ctx, "pcm16-processor");
      workletRef.current = worklet;

      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        onChunkRef.current(event.data);
      };

      source.connect(worklet);
      // Connect to destination to keep the graph alive (output is silent)
      worklet.connect(ctx.destination);

      setIsCapturing(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsCapturing(false);
    }
  }, []);

  const stop = useCallback(() => {
    // Stop media tracks
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    // Disconnect nodes
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (workletRef.current) {
      workletRef.current.disconnect();
      workletRef.current = null;
    }

    // Close audio context
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }

    setIsCapturing(false);
  }, []);

  return { start, stop, isCapturing, error };
}
