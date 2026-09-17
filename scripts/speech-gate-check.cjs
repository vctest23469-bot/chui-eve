const assert = require("node:assert/strict");
const path = require("node:path");
const { createSpeechGate } = require("../src/speech-gate.cjs");
const gate = createSpeechGate(path.resolve("runtime"));
const [noise, ...speech] = process.argv.slice(2);
assert(
  noise && speech.length,
  "Usage: node scripts/speech-gate-check.cjs noise.wav speech.wav ...",
);
assert.equal(gate(noise).speech, false, "Confirmed noise must not reach ASR");
for (const file of speech)
  assert.equal(gate(file).speech, true, "Speech must remain eligible: " + file);
assert.equal(
  gate(noise).speech,
  false,
  "Previous speech must not leak VAD state into noise",
);
console.log(
  "PASS: confirmed noise rejected; " +
    speech.length +
    " speech samples retained; state isolated",
);
