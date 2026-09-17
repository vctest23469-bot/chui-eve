const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateModel, resolveModel } = require("../src/models.cjs");
test("deleted legacy model falls back to a complete installation; incomplete models are rejected", () => {
  const dir = fs.mkdtempSync("/tmp/chui-model-test-");
  try {
    const settings = {
      backend: "sherpa",
      model: path.join(dir, "deleted-eve-model"),
      theme: "dark",
    };
    assert.throws(
      () => validateModel(settings.backend, settings.model),
      /模型文件缺失/,
    );
    for (const f of ["config.json", "model.safetensors", "python"])
      fs.writeFileSync(path.join(dir, f), "fixture");
    const candidate = {
      backend: "mlx",
      model: dir,
      python: path.join(dir, "python"),
    };
    assert.deepEqual(resolveModel(settings, [candidate]), {
      backend: "mlx",
      model: dir,
      theme: "dark",
    });
    fs.unlinkSync(path.join(dir, "model.safetensors"));
    assert.equal(resolveModel(settings, [candidate]), settings);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("Fun-ASR incomplete downloads cannot be selected", () => {
  const dir = fs.mkdtempSync("/tmp/chui-fun-model-");
  try {
    fs.writeFileSync(
      path.join(dir, "installed.json"),
      JSON.stringify({
        files: [
          { path: "funasr-encoder-f16.gguf", size: 8 },
          { path: "qwen3-0.6b-q8_0.gguf", size: 8 },
        ],
      }),
    );
    fs.writeFileSync(path.join(dir, "funasr-encoder-f16.gguf"), "GGUF1234");
    assert.throws(() => validateModel("funasr", dir), /不完整/);
    fs.writeFileSync(path.join(dir, "qwen3-0.6b-q8_0.gguf"), "GGUF1234");
    assert.doesNotThrow(() => validateModel("funasr", dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("BF16 and 4-bit remain distinct choices and missing BF16 is rejected", () => {
  const { MODEL_LABELS, BF16_MODEL, MLX_MODEL } = require("../src/models.cjs");
  assert.notEqual(BF16_MODEL, MLX_MODEL);
  assert.match(MODEL_LABELS["mlx-bf16"], /BF16/);
  const dir = fs.mkdtempSync("/tmp/chui-bf16-test-");
  try {
    assert.throws(() => validateModel("mlx-bf16", dir), /缺失/);
    for (const file of ["config.json", "model.safetensors", "python"])
      fs.writeFileSync(path.join(dir, file), "fixture");
    assert.doesNotThrow(() =>
      validateModel("mlx-bf16", dir, path.join(dir, "python")),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
