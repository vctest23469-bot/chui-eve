class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(16000 * 12);
    this.offset = 0;
    this.quiet = 0;
    this.frames = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        this.flush();
        this.port.postMessage({ flushed: true });
      }
    };
  }
  flush() {
    if (this.offset) {
      this.port.postMessage({ pcm: this.buffer.slice(0, this.offset).buffer });
      this.offset = 0;
      this.quiet = 0;
    }
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let energy = 0;
    for (const v of input) {
      energy += v * v;
      this.buffer[this.offset++] = Math.max(
        -32768,
        Math.min(32767, Math.round(v * 32767)),
      );
      if (this.offset === this.buffer.length) this.flush();
    }
    const rms = Math.sqrt(energy / input.length);
    this.quiet = rms < 0.008 ? this.quiet + input.length : 0;
    if (this.offset > 16000 * 2 && this.quiet > 16000 * 0.65) this.flush();
    if (++this.frames % 16 === 0) this.port.postMessage({ level: rms });
    return true;
  }
}
registerProcessor("chui-capture", Capture);
