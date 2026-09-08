const { _electron: electron } = require("playwright"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-live-"));
  const file = path.join(
    os.homedir(),
    "Library/Application Support/Eve Recorder/models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/test_wavs/fast1.wav",
  );
  const app = await electron.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "."],
    env: { ...process.env, CHUI_DATA_DIR: root },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].hide(),
  );
  await app.evaluate(({ systemPreferences }) => {
    systemPreferences.askForMediaAccess = async () => true;
  });
  await page.evaluate(
    async (b64) => {
      const ctx = new AudioContext();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const dest = ctx.createMediaStreamDestination();
      source.connect(dest);
      source.start();
      await ctx.resume();
      window.__fixture = { ctx, source, dest };
      navigator.mediaDevices.getUserMedia = async () => dest.stream;
    },
    (await fs.readFile("/tmp/chui-fake.wav")).toString("base64"),
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("#record").waitFor();
  await page
    .locator("#meeting-title")
    .evaluate((e) => (e.value = "实时会议链路验收"));
  await page.locator("#record").evaluate((b) => b.click());
  await page.waitForFunction(() =>
    document.querySelector("#live-status").textContent.includes("正在录制"),
  );
  await page.waitForTimeout(14500);
  await page.locator("#record").evaluate((b) => b.click());
  await page.waitForFunction(
    () =>
      ["已完成", "未识别到语音", "失败"].includes(
        document.querySelector("#detail-state")?.textContent,
      ),
    null,
    { timeout: 90000 },
  );
  const result = await page.evaluate(() => window.eve.state());
  const r = result.records[0];
  console.log("RESULT", JSON.stringify(r));
  if (r.duration < 13 || !r.segments.length)
    throw Error("Live capture validation failed");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].show(),
  );
  await page.screenshot({ path: "artifacts/ui-live.png" });
  await fs.writeFile(
    "artifacts/live-result.json",
    JSON.stringify({ errors, record: r }, null, 2),
  );
  console.log(
    JSON.stringify({
      duration: r.duration,
      segments: r.segments.length,
      text: r.segments.map((s) => s.text),
      errors,
    }),
  );
  await app.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
