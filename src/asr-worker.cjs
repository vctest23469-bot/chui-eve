const path = require("node:path");
const readline = require("node:readline");
const onnx = require(
  path.join(process.env.CHUI_RUNTIME, "sherpa-runtime/sherpa-onnx-node"),
);
const root = process.env.CHUI_MODEL;
const send = (x) => process.stdout.write(JSON.stringify(x) + "\n");
try {
  const r = new onnx.OfflineRecognizer({
    featConfig: { featureDim: 128, sampleRate: 16000 },
    modelConfig: {
      numThreads: 2,
      provider: "cpu",
      qwen3Asr: {
        convFrontend: path.join(root, "conv_frontend.onnx"),
        encoder: path.join(root, "encoder.int8.onnx"),
        decoder: path.join(root, "decoder.int8.onnx"),
        tokenizer: path.join(root, "tokenizer"),
      },
      tokens: "",
    },
  });
  send({ ready: true });
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    try {
      const j = JSON.parse(line),
        w = onnx.readWave(j.path, false);
      let energy = 0;
      for (const v of w.samples) energy += v * v;
      if (Math.sqrt(energy / w.samples.length) < 0.002) {
        send({ id: j.id, text: "", silent: true });
        return;
      }
      const s = r.createStream();
      s.acceptWaveform({ samples: w.samples, sampleRate: w.sampleRate });
      const t = Date.now();
      r.decode(s);
      const result = r.getResult(s);
      if (result.text.trim() === "language")
        throw Error("模型返回无效结果，请重试或切换 MLX 模型");
      send({ id: j.id, text: result.text.trim(), ms: Date.now() - t });
    } catch (e) {
      send({ error: e.message });
    }
  });
} catch (e) {
  send({ fatal: e.message });
  process.exitCode = 1;
}
