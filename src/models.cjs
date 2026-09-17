const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const support = path.join(os.homedir(), "Library/Application Support/Chui Eve");
const DEFAULT_MODEL = path.join(
  support,
  "models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25",
);
const MLX_MODEL = path.join(support, "models/Qwen3-ASR-1.7B-4bit");
const BF16_MODEL = path.join(support, "models/Qwen3-ASR-1.7B-bf16");
const FUNASR_MODEL = path.join(support, "models/Fun-ASR-Nano-GGUF");
const MODEL_LABELS = {
  "mlx-bf16": "Qwen3-ASR 1.7B · MLX BF16",
  mlx: "Qwen3-ASR 1.7B · MLX 4-bit",
  sherpa: "Qwen3-ASR 0.6B · ONNX INT8",
  funasr: "Fun-ASR-Nano 800M · GGUF Q8",
};
const MLX_PYTHON = path.join(support, "mlx-env/bin/python");
function validateModel(backend, model, python = MLX_PYTHON) {
  if (!["sherpa", "mlx", "mlx-bf16", "funasr"].includes(backend))
    throw Error("未知引擎");
  const files =
    backend === "funasr"
      ? ["funasr-encoder-f16.gguf", "qwen3-0.6b-q8_0.gguf", "installed.json"]
      : backend.startsWith("mlx")
        ? ["config.json", "model.safetensors"]
        : [
            "conv_frontend.onnx",
            "encoder.int8.onnx",
            "decoder.int8.onnx",
            "tokenizer",
          ];
  if (backend === "funasr") {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(model, "installed.json"), "utf8"),
      );
      for (const name of files.slice(0, 2)) {
        const entry = manifest.files.find((x) => x.path === name);
        if (!entry || fs.statSync(path.join(model, name)).size !== entry.size)
          throw Error("size");
      }
    } catch {
      throw Error("Fun-ASR 模型下载不完整，请完成安装后再切换。");
    }
  }
  for (const file of files
    .map((f) => path.join(model, f))
    .concat(backend.startsWith("mlx") ? [python] : [])) {
    try {
      fs.accessSync(file, fs.constants.R_OK);
      if (!fs.statSync(file).size) throw Error("empty");
    } catch {
      throw Error(
        `转写模型文件缺失或不可读：${file}。请在转写设置中选择已安装的模型。`,
      );
    }
  }
}
function available(backend, model, python) {
  try {
    validateModel(backend, model, python);
    return true;
  } catch {
    return false;
  }
}
function resolveModel(
  settings,
  candidates = [
    { backend: "mlx-bf16", model: BF16_MODEL },
    { backend: "mlx", model: MLX_MODEL },
  ],
) {
  if (available(settings.backend, settings.model)) return settings;
  const usable = candidates.find((c) =>
    available(c.backend, c.model, c.python),
  );
  return usable
    ? { ...settings, backend: usable.backend, model: usable.model }
    : settings;
}
module.exports = {
  DEFAULT_MODEL,
  BF16_MODEL,
  FUNASR_MODEL,
  MODEL_LABELS,
  MLX_MODEL,
  MLX_PYTHON,
  validateModel,
  available,
  resolveModel,
};
