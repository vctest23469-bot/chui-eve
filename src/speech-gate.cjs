const path = require("node:path");
function createSpeechGate(runtime) {
  const onnx = require(path.join(runtime, "sherpa-runtime/sherpa-onnx-node"));
  const vad = new onnx.Vad(
    {
      sileroVad: {
        model: path.join(runtime, "silero_vad.onnx"),
        threshold: 0.95,
        minSilenceDuration: 0.15,
        minSpeechDuration: 0.25,
        windowSize: 512,
        maxSpeechDuration: 30,
      },
      sampleRate: 16000,
      numThreads: 1,
      provider: "cpu",
    },
    60,
  );
  return (file) => {
    const w = onnx.readWave(file, false);
    if (w.sampleRate !== 16000) throw Error("语音检测要求 16 kHz 音频");
    vad.reset();
    for (let i = 0; i < w.samples.length; i += 512) {
      const frame = new Float32Array(512);
      frame.set(w.samples.subarray(i, i + 512));
      vad.acceptWaveform(frame);
    }
    vad.flush();
    let speechSamples = 0;
    while (!vad.isEmpty()) {
      speechSamples += vad.front().samples.length;
      vad.pop();
    }
    return { speech: speechSamples > 0, speechSeconds: speechSamples / 16000 };
  };
}
module.exports = { createSpeechGate };
if (require.main === module) {
  try {
    console.log(
      JSON.stringify(
        createSpeechGate(process.env.CHUI_RUNTIME)(process.argv[2]),
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
