/**
 * AudioWorkletProcessor that resamples incoming audio to 24 kHz PCM16
 * and posts ArrayBuffer chunks to the main thread.
 *
 * Register with: audioContext.audioWorklet.addModule("/pcm16-processor.js")
 */
class Pcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Fractional sample position for linear-interpolation resampling
    this._resamplePos = 0;
  }

  /**
   * @param {Float32Array[][]} inputs  – inputs[0][0] is first channel
   * @param {Float32Array[][]} _outputs
   * @param {Record<string, Float32Array>} _parameters
   * @returns {boolean} keep-alive
   */
  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const srcData = input[0]; // mono Float32 at device sampleRate
    const srcRate = sampleRate; // global provided by AudioWorkletGlobalScope
    const dstRate = 24000;

    if (srcRate === dstRate) {
      // No resampling needed — convert directly to Int16
      const int16 = this._float32ToInt16(srcData);
      this.port.postMessage(int16.buffer, [int16.buffer]);
      return true;
    }

    const ratio = srcRate / dstRate;
    // Estimate max output samples for this block
    const maxOut = Math.ceil(srcData.length / ratio) + 1;
    const out = new Float32Array(maxOut);
    let outIdx = 0;

    let pos = this._resamplePos;
    while (pos < srcData.length - 1) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      // Linear interpolation between adjacent samples
      out[outIdx++] = srcData[idx] * (1 - frac) + srcData[idx + 1] * frac;
      pos += ratio;
    }
    // Save fractional remainder for next block (offset by block length)
    this._resamplePos = pos - srcData.length;

    // Convert the resampled Float32 to Int16
    const trimmed = out.subarray(0, outIdx);
    const int16 = this._float32ToInt16(trimmed);
    this.port.postMessage(int16.buffer, [int16.buffer]);

    return true;
  }

  /**
   * Convert Float32 [-1, 1] to Int16 [-32768, 32767].
   * @param {Float32Array} float32
   * @returns {Int16Array}
   */
  _float32ToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }
}

registerProcessor("pcm16-processor", Pcm16Processor);
