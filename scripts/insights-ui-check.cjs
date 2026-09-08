const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { randomUUID } = require("node:crypto");
const { fingerprint } = require("../src/insights.cjs");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-insights-ui-")),
    id = randomUUID();
  const record = {
    id,
    title: "发布评审 · 功能验收",
    kind: "file",
    created: new Date().toISOString(),
    state: "done",
    duration: 12,
    processed: 12,
    model: "测试样本",
    segments: [
      {
        start: 0,
        text: "九月二十日发布，小李九月十五日前完成性能测试，预算下次讨论。",
      },
    ],
  };
  record.insights = {
    status: "done",
    model: "GPT-5.5 · Codex CLI",
    sourceHash: fingerprint(record),
    result: {
      summary: "发布延期至九月二十日，性能测试由小李负责，预算未定。",
      topics: [
        {
          title: "发布计划",
          points: ["九月二十日发布。", "预算下次会议讨论。"],
        },
        {
          title: "性能测试",
          points: ["小李九月十五日前完成。", "启动时间目标三秒以内。"],
        },
      ],
      actions: ["小李完成性能测试。"],
    },
  };
  await fs.mkdir(path.join(root, "library/records", id), { recursive: true });
  await fs.writeFile(
    path.join(root, "library/records", id, "record.json"),
    JSON.stringify(record),
  );
  const app = await electron.launch({
    args: ["--user-data-dir=" + path.join(root, "profile"), "."],
    env: { ...process.env, CHUI_DATA_DIR: path.join(root, "library") },
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator(".record-item").click();
    await page.locator("#summary").click();
    await page.locator(".summary-lead").waitFor();
    await page.screenshot({ path: "artifacts/insights-summary.png" });
    const s = await page.locator("#summary").boundingBox(),
      e = await page.locator("#export-format").boundingBox();
    if (s.x >= e.x) throw Error("按钮位置错误");
    await page.locator("#mindmap").click();
    await page.locator(".map-topic").first().waitFor();
    await page.locator("#map-expand").click();
    await page.locator(".map-topic").first().click();
    if (
      (await page
        .locator(".map-topic")
        .first()
        .getAttribute("aria-expanded")) !== "false"
    )
      throw Error("折叠失败");
    await page.locator(".map-topic").first().click();
    await page.locator("#map-plus").click();
    if ((await page.locator("#map-reset").innerText()) !== "110%")
      throw Error("缩放失败");
    await page.screenshot({ path: "artifacts/insights-map.png" });
    await page.locator("#map-fullscreen").click();
    await page.waitForFunction(() =>
      document.body.classList.contains("map-presentation"),
    );
    const full = await page.locator("#insights-panel").boundingBox();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    if (full.width < viewport.width - 2 || full.height < viewport.height - 2)
      throw Error("导图未占满全屏");
    await page.locator("#map-collapse").click();
    await page.locator("#map-expand").click();
    await page.screenshot({ path: "artifacts/insights-fullscreen.png" });
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.body.classList.contains("map-presentation"),
    );
    if ((await page.locator("#map-reset").innerText()) !== "110%")
      throw Error("全屏退出后缩放丢失");
    await page.locator("#map-fullscreen").click();
    await page.waitForFunction(
      () => !!document.body.classList.contains("map-presentation"),
    );
    await page.locator("#map-fullscreen").click();
    await page.waitForFunction(
      () => !document.body.classList.contains("map-presentation"),
    );
    console.log(
      "Fullscreen enter, full viewport, Escape, exit button and retained zoom: PASS",
    );
    await page.locator("[data-insights-view=transcript]").click();
    await page.locator("#segments p").fill("编辑后的原文");
    await page.locator("#search").click();
    await page.waitForFunction(
      async () => (await window.eve.state()).records[0].insights.stale,
    );
    await page.locator("[data-insights-view=summary]").click();
    if (
      !(await page.locator("#insights-status").innerText()).includes(
        "需要重新提炼",
      )
    )
      throw Error("未提示过期");
    const output = path.join(root, "export.md");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, output);
    await page.locator("#insights-export").click();
    await page.waitForTimeout(200);
    if (!(await fs.readFile(output, "utf8")).includes("发布计划"))
      throw Error("导出失败");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(700, 580),
    );
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("窄窗口溢出");
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      JSON.stringify({
        buttons: true,
        summary: true,
        map: true,
        collapse: true,
        zoom: true,
        stale: true,
        export: true,
        errors,
      }),
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
