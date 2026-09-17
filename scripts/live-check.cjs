const { _electron: electron } = require("playwright"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-live-"));
  const file = process.env.CHUI_TEST_AUDIO;
  if (!file) throw Error("Set CHUI_TEST_AUDIO to a spoken WAV fixture");
  const app = await electron.launch({
    executablePath: process.env.CHUI_TEST_EXECUTABLE,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      `--user-data-dir=${root}/profile`,
      ".",
    ],
    env: { ...process.env, CHUI_DATA_DIR: root },
    timeout: 60000,
  });
  try {
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
      (await fs.readFile(file)).toString("base64"),
    );
    if (process.env.CHUI_TEST_HOTWORDS || process.env.CHUI_TEST_BACKEND)
      await page.evaluate((settings) => window.eve.settings(settings), {
        backend: process.env.CHUI_TEST_BACKEND || "mlx",
        language: "Chinese",
        hotwords: process.env.CHUI_TEST_HOTWORDS || "",
      });
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
    const deadline = Date.now() + 120000;
    let live;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      live = (await page.evaluate(() => window.eve.state())).records[0];
      if (live?.error) throw Error(live.error);
    } while (
      (!live?.segments.length || live.state !== "recording") &&
      Date.now() < deadline
    );
    if (!live?.segments.length || live.state !== "recording")
      throw Error("No transcript while recording: " + JSON.stringify(live));
    const visibleText = await page.locator("#segments").innerText();
    if (!visibleText.includes(live.segments[0].text))
      throw Error("Live transcript was not rendered");
    console.log(
      "PASS: transcript arrived before recording stopped",
      JSON.stringify({
        duration: live.duration,
        segments: live.segments.length,
      }),
    );
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
    console.log(
      "RESULT",
      JSON.stringify({
        state: r.state,
        duration: r.duration,
        segments: r.segments.length,
      }),
    );
    if (r.duration < 2 || !r.segments.length)
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
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
