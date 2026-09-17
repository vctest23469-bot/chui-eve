// Synthetic demonstration library; never reads the user's meeting records.
const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const { randomUUID } = require("node:crypto");
const { wavHeader } = require("../src/audio.cjs");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-release-check-"));
  const output = "docs/assets";
  await fs.mkdir(output, { recursive: true });
  let requests = 0,
    fail = false;
  const syntheticKey = randomUUID();
  let sawAuthenticatedRequest = false;
  const result = {
    summary:
      "本次会议明确了导入体验与摘要配置两个重点。先完成接口验证，再核对安装和权限流程；预算另行评审。",
    topics: [
      {
        title: "体验优化",
        points: ["完善音频导入与时间戳回听。", "支持自选模型 API 生成摘要。"],
      },
      {
        title: "发布准备",
        points: ["核对安装与权限流程。", "完成接口测试，记录验证结果。"],
      },
      {
        title: "后续安排",
        points: ["预算另行评审。", "不确定事项进入待确认清单。"],
      },
    ],
    decisions: ["优先完善音频导入体验和摘要配置。"],
    uncertainties: ["预算安排待下一次评审确认。"],
    actions: [
      {
        task: "完成接口测试并同步结果",
        owner: "开发组",
        deadline: "周五前",
        evidenceIds: ["s1"],
      },
    ],
  };
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const part of req) text += part;
    const body = JSON.parse(text);
    requests++;
    if (req.headers.authorization === `Bearer ${syntheticKey}`)
      sawAuthenticatedRequest = true;
    assert.equal(body.model, "demo-summary");
    if (fail) {
      res.writeHead(429);
      res.end("demo error");
      return;
    }
    const test = body.messages.at(-1).content.includes("连接测试");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(test ? { ok: true } : result) },
          },
        ],
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let app;
  try {
    const library = path.join(root, "library");
    const titles = [
      "产品周会 · 体验与发布",
      "阅读笔记 · 设计与表达",
      "课程记录 · 语音技术基础",
    ];
    for (const [i, title] of titles.entries()) {
      const id = randomUUID(),
        dir = path.join(library, "records", id);
      await fs.mkdir(dir, { recursive: true });
      const record = {
        id,
        title,
        kind: i === 0 ? "live" : "file",
        state: "done",
        created: `2026-09-${17 - i}T07:00:00.000Z`,
        duration: 204,
        processed: 204,
        model: "Qwen3-ASR 1.7B · MLX",
        segments: [
          {
            start: 0,
            end: 14,
            text: "今天确认两个重点：完善音频导入体验，补齐摘要配置。",
          },
          {
            start: 14,
            end: 28,
            text: "开发组在周五前完成接口测试，并把结果同步到项目看板。",
          },
          {
            start: 28,
            end: 43,
            text: "发布前先核对权限与安装流程，发现问题就进入待确认清单。",
          },
          { start: 43, end: 60, text: "本次不讨论预算，后续安排单独的评审。" },
        ],
      };
      await fs.writeFile(path.join(dir, "record.json"), JSON.stringify(record));
      await fs.writeFile(
        path.join(dir, "audio.wav"),
        Buffer.concat([wavHeader(204 * 32000), Buffer.alloc(204 * 32000)]),
      );
    }
    app = await _electron.launch({
      executablePath: process.env.CHUI_TEST_EXECUTABLE,
      args: [`--user-data-dir=${path.join(root, "profile")}`, "."],
      env: { ...process.env, CHUI_DATA_DIR: library },
      timeout: 60000,
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator(".record-item").first().click();
    await page.evaluate(() => {
      localStorage.setItem("theme", "light");
      applyTheme();
    });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setVibrancy(null);
      win.setBackgroundColor("#edf3f9");
      win.setSize(1440, 1080);
    });
    await page.locator("#playback").evaluate((p) => (p.muted = true));
    await page.locator("#segments button").nth(1).click();
    await page.waitForFunction(
      () => document.querySelector("audio").currentTime >= 14,
    );
    await page.waitForFunction(() => !document.querySelector("audio").paused);
    await page.locator("audio").evaluate((p) => p.pause());
    await page.locator("#toast").evaluate((p) => (p.textContent = ""));
    await page.screenshot({ path: `${output}/workspace.png` });
    await page.locator("#open-model-settings").click();
    await page.locator("#insights-mode").selectOption("api");
    await page
      .locator("#api-base")
      .fill(`http://127.0.0.1:${server.address().port}/v1`);
    await page.locator("#api-model").fill("demo-summary");
    await page.locator("#api-key").fill(syntheticKey);
    await page.locator("#test-model").click();
    await page.waitForFunction(() =>
      document.querySelector("#model-status").textContent.includes("连接成功"),
    );
    const saved = await page.evaluate(() => window.eve["model-settings"]());
    assert.equal(saved.model, "demo-summary");
    assert.equal(saved.hasKey, true);
    assert.ok(sawAuthenticatedRequest);
    assert.ok(!JSON.stringify(saved).includes(syntheticKey));
    assert.ok(
      !(
        await fs.readFile(path.join(library, "model-api.json"), "utf8")
      ).includes(syntheticKey),
    );
    assert.equal(await page.locator("#api-key").inputValue(), "");
    await page.locator("#clear-api-key").click();
    await page.locator("#save-model").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#model-status")
        .textContent.includes("配置已保存"),
    );
    await page.locator("#api-base").fill("https://api.example.com/v1");
    await page
      .locator("#model-status")
      .evaluate((p) => (p.textContent = "演示配置 · 在此填写你自己的模型服务"));
    await page.screenshot({ path: `${output}/api-settings.png` });
    await page.locator("#close-model-settings").click();
    await page.locator("#summary").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#insights-status")
          ?.textContent.includes("已保存"),
      null,
      { timeout: 15000 },
    );
    assert.ok(
      (await page.locator(".action-list").innerText()).includes("周五前"),
    );
    await page.screenshot({ path: `${output}/summary.png` });
    await page.locator("#mindmap").click();
    await page.locator(".map-topic").first().waitFor();
    await page.locator("#map-collapse").click();
    assert.equal(
      await page.locator(".map-topic").first().getAttribute("aria-expanded"),
      "false",
    );
    await page.locator("#map-expand").click();
    await page.locator("#map-plus").click();
    assert.equal(await page.locator("#map-reset").innerText(), "110%");
    await page.locator("#map-reset").click();
    await page.screenshot({ path: `${output}/mindmap.png` });
    await page.locator("#map-fullscreen").click();
    await page.waitForFunction(() =>
      document.body.classList.contains("map-presentation"),
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.body.classList.contains("map-presentation"),
    );
    fail = true;
    await page.locator("#insights-regenerate").click();
    await page.waitForFunction(() =>
      document.querySelector("#insights-status").textContent.includes("限流"),
    );
    assert.equal(await page.locator(".map-topic").count(), 3);
    fail = false;
    await page.locator("#insights-regenerate").click();
    await page.waitForFunction(() =>
      document.querySelector("#insights-status").textContent.includes("已保存"),
    );
    await page.locator("[data-insights-view=summary]").click();
    const exportFile = path.join(root, "summary.md");
    await app.evaluate(({ dialog, shell }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      shell.showItemInFolder = () => {};
    }, exportFile);
    await page.locator("#insights-export").click();
    await page.waitForTimeout(150);
    assert.ok((await fs.readFile(exportFile, "utf8")).includes("完成接口测试"));
    await page.locator("#theme").click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBackgroundColor("#17212e"),
    );
    await page.screenshot({ path: `${output}/workspace-dark.png` });
    await page.locator("#open-model-settings").click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const box = await page.locator("#model-dialog").boundingBox();
    assert.ok(box.width <= 390);
    await page.screenshot({ path: "artifacts/api-narrow.png" });
    assert.deepEqual(errors, []);
    assert.ok(requests >= 4);
    // Reload the app with the same isolated library to verify persisted API settings.
    await app.close();
    app = null;
    app = await _electron.launch({
      executablePath: process.env.CHUI_TEST_EXECUTABLE,
      args: [`--user-data-dir=${path.join(root, "profile")}`, "."],
      env: { ...process.env, CHUI_DATA_DIR: library },
    });
    const reloaded = await app.firstWindow();
    assert.equal(
      (await reloaded.evaluate(() => window.eve["model-settings"]())).model,
      "demo-summary",
    );
    assert.equal(
      (await reloaded.evaluate(() => window.eve.state())).records[0].insights
        .status,
      "done",
    );
    console.log(
      JSON.stringify({
        api: true,
        persisted: true,
        summary: true,
        map: true,
        errors: true,
        replay: true,
        export: true,
        narrow: true,
        requests,
      }),
    );
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
