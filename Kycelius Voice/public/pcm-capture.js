/**
 * Kycelius Voice — AudioWorklet PCM tap.
 * Aggregates 128-sample render quanta into 512-sample (~32 ms @16 kHz)
 * chunks and posts them to the main thread as transferable buffers.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(512);
  private offset = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channel = input[0];
    let i = 0;
    while (i < channel.length) {
      const space = this.buffer.length - this.offset;
      const take = Math.min(space, channel.length - i);
      this.buffer.set(channel.subarray(i, i + take), this.offset);
      this.offset += take;
      i += take;

      if (this.offset === this.buffer.length) {
        const out = this.buffer;
        this.port.postMessage(out, [out.buffer]);
        this.buffer = new Float32Array(512);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
