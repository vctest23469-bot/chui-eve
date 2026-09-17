const { Engine } = require("../src/engine.cjs");
const path = require("node:path"),
  os = require("node:os"),
  fs = require("node:fs/promises");
(async () => {
  const backend = process.argv[2] || "sherpa";
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-bench-"));
  const e = new Engine({ root, runtime: path.resolve("runtime") });
  e.on("error", console.error);
  await e.init();
  if (backend === "mlx")
    await e.configure({
      backend: "mlx",
      model: path.join(
        os.homedir(),
        "Library/Application Support/Chui Eve/models/Qwen3-ASR-1.7B-4bit",
      ),
    });
  const samples = process.argv.slice(3);
  if (!samples.length)
    throw Error("Usage: node scripts/bench.cjs mlx sample.wav ...");
  let maxLag = 0,
    last = Date.now();
  const interval = setInterval(() => {
    maxLag = Math.max(maxLag, Date.now() - last - 20);
    last = Date.now();
  }, 20);
  const results = [];
  for (const name of samples) {
    const start = Date.now();
    const id = await e.importFile(path.resolve(name));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("timeout")), 180000);
      function check() {
        const r = e.get(id);
        if (["done", "empty", "failed"].includes(r.state)) {
          clearTimeout(timer);
          e.off("change", check);
          resolve();
        }
      }
      e.on("change", check);
      check();
    });
    const r = e.get(id);
    results.push({
      name,
      seconds: r.duration,
      wallMs: Date.now() - start,
      inferenceMs: r.segments.reduce((a, s) => a + s.ms, 0),
      peakMemoryMB: Math.max(0, ...r.segments.map((s) => s.peakMemoryMB || 0)),
      state: r.state,
      text: r.segments.map((s) => s.text).join(""),
      error: r.error,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  clearInterval(interval);
  await e.close();
  await fs.writeFile(
    `artifacts/bench-${backend}.json`,
    JSON.stringify({ backend, maxEventLoopLagMs: maxLag, results }, null, 2),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
