const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-ui-"));
  const app = await electron.launch({
    executablePath: process.env.CHUI_TEST_EXECUTABLE,
    args: ["--user-data-dir=" + path.join(root, "profile"), "."],
    env: { ...process.env, CHUI_DATA_DIR: root },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("#engine-state");
    if (process.env.CHUI_TEST_BACKEND)
      await page.evaluate(
        (backend) => window.eve.settings({ backend }),
        process.env.CHUI_TEST_BACKEND,
      );
    await page.screenshot({ path: "artifacts/ui-empty.png" });
    await app.evaluate(
      ({ dialog }, files) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: files,
        });
      },
      [
        process.env.CHUI_TEST_AUDIO ||
          (() => {
            throw Error("Set CHUI_TEST_AUDIO to a spoken WAV fixture");
          })(),
      ],
    );
    console.log("IMPORT", await page.evaluate(() => window.eve.import()));
    await page.locator(".record-item").first().waitFor();
    await page
      .locator(".record-item")
      .first()
      .evaluate((b) => b.click());
    await page.waitForFunction(
      () =>
        ["已完成", "失败", "未识别到语音"].includes(
          document.querySelector("#detail-state")?.textContent,
        ),
      null,
      { timeout: 90000 },
    );
    if ((await page.locator("#detail-state").innerText()) !== "已完成")
      throw Error("转写失败，请检查隔离测试库中的失败状态");
    await page.screenshot({ path: "artifacts/ui-transcript.png" });
    const text = await page.locator("#segments").innerText();
    console.log("TRANSCRIPT", text);
    await page.locator(".detail-title").fill("界面验收 · 中文快语速");
    await page.locator(".detail-title").press("Tab");
    await page
      .locator("#segments p")
      .first()
      .fill("编辑验证：这段文字已保存。");
    await page.locator("#search").click();
    await page.waitForTimeout(200);
    const persisted = JSON.parse(
      await fs.readFile(
        path.join(
          root,
          "records",
          (await fs.readdir(path.join(root, "records")))[0],
          "record.json",
        ),
        "utf8",
      ),
    );
    if (persisted.segments[0].text !== "编辑验证：这段文字已保存。")
      throw Error("Edit persistence failed");
    await page.locator("#segments button").first().click();
    await page.waitForTimeout(500);
    console.log(
      "AUDIO",
      await page.locator("audio").evaluate((a) => ({
        error: a.error?.message,
        duration: a.duration,
        paused: a.paused,
      })),
    );
    await page.locator("#theme").click();
    await page.screenshot({ path: "artifacts/ui-dark.png" });
    await page.locator("#open-settings").click();
    await page.screenshot({ path: "artifacts/ui-settings.png" });
    await page.locator("#close-settings").click();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: "artifacts/ui-mobile.png" });
    console.log(
      "OVERFLOW",
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      "ERRORS",
      errors,
    );
    await fs.writeFile(
      "artifacts/ui-result.json",
      JSON.stringify({ text, errors }, null, 2),
    );
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
