const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { createInterface } = require("node:readline");
const { createSpeechGate } = require("./speech-gate.cjs");
const runtime = process.env.CHUI_RUNTIME,
  model = process.env.CHUI_MODEL;
const binary = path.join(runtime, "funasr/llama-funasr-cli");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let active;
process.on("SIGTERM", () => {
  active?.kill("SIGKILL");
  process.exit(0);
});
function repetitive(text) {
  const units = text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) || [];
  for (let width = 1; width <= 12; width++)
    for (let start = 0; start + width * 8 <= units.length; start++) {
      const phrase = units.slice(start, start + width).join("|");
      let count = 1;
      while (
        units
          .slice(start + count * width, start + (count + 1) * width)
          .join("|") === phrase
      )
        count++;
      if (
        count >= 8 &&
        count * width >= 24 &&
        count * width >= units.length * 0.6
      )
        return true;
    }
  return false;
}
try {
  fs.accessSync(binary, fs.constants.X_OK);
  const gate = createSpeechGate(runtime);
  createInterface({ input: process.stdin }).on("line", (line) => {
    let job;
    try {
      job = JSON.parse(line);
      if (active) throw Error("Fun-ASR 正在识别上一段");
      if (!gate(job.path).speech) {
        send({ id: job.id, text: "", suppressed: "no_speech" });
        return;
      }
      const args = [
        "--enc",
        path.join(model, "funasr-encoder-f16.gguf"),
        "-m",
        path.join(model, "qwen3-0.6b-q8_0.gguf"),
        "-a",
        job.path,
        "-n",
        "448",
      ];
      if (job.language === "Chinese") args.push("--lang", "中文");
      const started = Date.now();
      active = execFile(
        binary,
        args,
        { timeout: 85000, maxBuffer: 4 * 1024 * 1024, env: process.env },
        (err, stdout, stderr) => {
          active = null;
          if (err) {
            send({
              id: job.id,
              error:
                "Fun-ASR 识别失败：" + (stderr || err.message).slice(-1500),
            });
            return;
          }
          const text = stdout.trim();
          if (repetitive(text))
            send({
              id: job.id,
              text: "",
              suppressed: "repetition",
              rejectedText: text,
            });
          else send({ id: job.id, text, ms: Date.now() - started });
        },
      );
    } catch (e) {
      send({ id: job?.id, error: e.message });
    }
  });
  send({ ready: true });
} catch (e) {
  send({ fatal: e.message });
  process.exitCode = 1;
}
