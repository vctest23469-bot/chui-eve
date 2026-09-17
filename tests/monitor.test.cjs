const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
test("音量使用完整窗口 RMS，静音退出说话状态且不会输出非有限 dB", () => {
  let Klass;
  const messages = [];
  vm.runInNewContext(fs.readFileSync("src/capture-worklet.js", "utf8"), {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => messages.push(m) };
      }
    },
    registerProcessor: (_, k) => (Klass = k),
    Int16Array,
    Math,
  });
  const capture = new Klass();
  const feed = (value, n) => {
    for (let i = 0; i < n; i++)
      capture.process([[new Float32Array(128).fill(value)]]);
  };
  feed(0.1, 16);
  const loud = messages.at(-1);
  assert.ok(Math.abs(20 * Math.log10(loud.level) + 20) < 0.001);
  assert.equal(loud.speaking, true);
  feed(0, 48);
  assert.equal(messages.at(-1).level, 0);
  assert.equal(messages.at(-1).speaking, false);
});
