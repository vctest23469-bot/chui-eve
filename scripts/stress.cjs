const { Engine } = require("../src/engine.cjs"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  { spawnSync } = require("node:child_process");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-stress-"));
  const input = path.join(root, "five-minutes.wav");
  const sample = process.env.CHUI_TEST_AUDIO;
  if (!sample) throw Error("Set CHUI_TEST_AUDIO to a spoken WAV fixture");
  const ff = spawnSync(path.resolve("runtime/ffmpeg"), [
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    sample,
    "-t",
    "300",
    "-c:a",
    "pcm_s16le",
    input,
  ]);
  if (ff.status) throw Error(ff.stderr.toString());
  const e = new Engine({ root, runtime: path.resolve("runtime") });
  e.on("error", console.error);
  await e.init();
  let lag = 0,
    rss = 0,
    last = Date.now();
  const ticker = setInterval(() => {
    lag = Math.max(lag, Date.now() - last - 25);
    last = Date.now();
    rss = Math.max(rss, process.memoryUsage().rss);
  }, 25);
  const t = Date.now();
  const id = await e.importFile(input);
  await new Promise((resolve, reject) => {
    const limit = setTimeout(() => reject(Error("stress timeout")), 240000);
    e.on("change", () => {
      const r = e.get(id);
      if (["done", "empty", "failed"].includes(r.state)) {
        clearTimeout(limit);
        resolve();
      }
    });
  });
  const r = e.get(id);
  clearInterval(ticker);
  const result = {
    audioSeconds: r.duration,
    wallMs: Date.now() - t,
    inferenceMs: r.segments.reduce((sum, s) => sum + s.ms, 0),
    segments: r.segments.length,
    state: r.state,
    maxMainEventLoopLagMs: lag,
    maxMainRSS_MB: Math.round(rss / 1048576),
    error: r.error,
  };
  await fs.writeFile(
    "artifacts/stress-result.json",
    JSON.stringify(result, null, 2),
  );
  await e.close();
  console.log(result);
  if (r.state !== "done") process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
