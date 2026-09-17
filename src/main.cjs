const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  session,
  desktopCapturer,
  systemPreferences,
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
  protocol,
  net,
  powerSaveBlocker,
  safeStorage,
} = require("electron");
// CoreAudio Tap fails with Invalid capture constraints on this macOS host.
// Use Electron's supported ScreenCaptureKit loopback path with the granted
// Screen & System Audio Recording permission instead.
if (process.platform === "darwin") {
  app.commandLine.appendSwitch(
    "disable-features",
    "MacCatapLoopbackAudioForScreenShare",
  );
}
const path = require("node:path"),
  os = require("node:os"),
  fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { Insights, markdown: insightsMarkdown } = require("./insights.cjs");
const { Engine } = require("./engine.cjs");
const { exportText } = require("./audio.cjs");
const { audioResponse } = require("./media.cjs");
const { ModelSettings, completion } = require("./model-api.cjs");
app.setName("Chui Eve");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "chui-audio",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);
let windowControls;
let win,
  engine,
  insights,
  tray,
  quitting = false,
  power,
  shutdownResolve;
const runtime = app.isPackaged
  ? path.join(process.resourcesPath, "runtime")
  : path.join(__dirname, "../runtime");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    windowControls?.show();
  });
  app.whenReady().then(async () => {
    engine = new Engine({
      root:
        process.env.CHUI_DATA_DIR ||
        path.join(app.getPath("userData"), "library"),
      runtime,
    });
    engine.on("error", (e) => console.error(e));
    await engine.init();
    const modelSettings = new ModelSettings(
      path.join(engine.root, "model-api.json"),
      safeStorage,
    );
    let modelConfigError = "";
    await modelSettings.init().catch((e) => {
      modelConfigError = e.message;
    });
    insights = new Insights(engine, {
      settings: modelSettings,
      fetchImpl: net.fetch,
    });
    protocol.handle("chui-audio", async (req) => {
      try {
        const id = new URL(req.url).hostname;
        engine.get(id);
        return await audioResponse(engine.audioPath(id), req);
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler(
      (wc, permission, callback) =>
        callback(
          wc === win?.webContents &&
            ["media", "display-capture"].includes(permission),
        ),
    );
    session.defaultSession.setPermissionCheckHandler(
      (wc, permission) =>
        wc === win?.webContents &&
        ["media", "display-capture"].includes(permission),
    );
    session.defaultSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 0, height: 0 },
          });
          if (sources[0]) callback({ video: sources[0], audio: "loopback" });
          else callback({});
        } catch {
          callback({});
        }
      },
      // Use the explicit source handler after macOS grants capture permission.
      // The experimental system picker can fail before returning a stream.
      { useSystemPicker: false },
    );
    win = new BrowserWindow({
      width: 1140,
      height: 790,
      minWidth: 700,
      minHeight: 580,
      title: "Chui Eve",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 20, y: 20 },
      transparent: true,
      vibrancy: "popover",
      visualEffectState: "active",
      backgroundColor: "#00000000",
      roundedCorners: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    windowControls = require("./window-lifecycle.cjs").windowLifecycle(win);
    win.webContents.on("render-process-gone", () => {
      for (const r of engine.records)
        if (r.state === "recording") engine.stopLive(r.id).catch(console.error);
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());

    engine.on("change", (data) => {
      if (win && !win.isDestroyed()) win.webContents.send("state", data);
    });
    const handle = (name, fn) =>
      ipcMain.handle(name, async (event, ...args) => {
        if (event.sender !== win.webContents) throw Error("未知调用来源");
        return fn(...args);
      });
    handle("shutdown-complete", () => {
      shutdownResolve?.();
      return true;
    });
    let mapOwnsFullscreen = false;
    handle("map-fullscreen", (active) => {
      if (typeof active !== "boolean") throw Error("无效全屏参数");
      if (active && !win.isFullScreen() && !win.isSimpleFullScreen()) {
        mapOwnsFullscreen = true;
        win.setSimpleFullScreen(true);
      } else if (!active && mapOwnsFullscreen) {
        win.setSimpleFullScreen(false);
        mapOwnsFullscreen = false;
      }
      return active;
    });
    handle("appearance", (theme) => {
      if (!["light", "dark", "system"].includes(theme)) throw Error("未知外观");
      nativeTheme.themeSource = theme;
      return true;
    });
    handle("state", () => engine.snapshot());
    handle("model-settings", () => ({
      ...modelSettings.public(),
      error: modelConfigError,
    }));
    handle("model-settings-save", async (value) => {
      if (insights.active) throw Error("请等待摘要生成完成或取消后再修改配置");
      const result = await modelSettings.save(value);
      modelConfigError = "";
      return result;
    });
    let testingModel = false;
    handle("model-test", async () => {
      if (testingModel) throw Error("连接测试正在进行");
      testingModel = true;
      try {
        const config = modelSettings.credentials();
        if (config.mode === "codex") {
          await insights.resolveBinary();
          return "已找到 Codex CLI；实际生成仍需有效登录、模型权限及额度。";
        }
        const value = await completion(
          { ...config, timeout: Math.min(config.timeout, 30) },
          '连接测试，不包含录音或转写数据。只返回 JSON：{"ok":true}',
          {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
          { fetchImpl: net.fetch },
        );
        if (value.ok !== true)
          throw Error("服务可连接，但未按要求返回 JSON，请检查模型兼容性");
        return "连接成功：模型可返回有效 JSON。";
      } finally {
        testingModel = false;
      }
    });
    handle("warm", () => {
      engine.ensureWorker();
      return true;
    });
    handle("import", async () => {
      const result = await dialog.showOpenDialog(win, {
        title: "导入音频或视频",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "音频与视频",
            extensions: [
              "wav",
              "flac",
              "mp3",
              "m4a",
              "aac",
              "ogg",
              "opus",
              "webm",
              "mp4",
              "mov",
              "wma",
              "aiff",
            ],
          },
        ],
      });
      if (result.canceled) return [];
      for (const file of result.filePaths)
        engine
          .importFile(file)
          .catch((e) => dialog.showErrorBox("导入失败", e.message));
      return result.filePaths.map((p) => path.basename(p));
    });
    handle("drop", async (files) => {
      for (const file of files)
        engine
          .importFile(file)
          .catch((e) => dialog.showErrorBox("导入失败", e.message));
      return true;
    });
    handle("start", async (title) => {
      const allowed = await systemPreferences.askForMediaAccess("microphone");
      if (!allowed)
        throw Error("请在系统设置 → 隐私与安全性 → 麦克风中允许 Chui Eve");
      const id = await engine.startLive(title);
      power = powerSaveBlocker.start("prevent-app-suspension");
      return id;
    });
    handle("chunk", (id, b) => engine.appendLive(id, b));
    handle("stop", async (id) => {
      await engine.stopLive(id);
      if (power !== undefined && powerSaveBlocker.isStarted(power))
        powerSaveBlocker.stop(power);
    });
    handle("insights", (id, force) => insights.start(id, !!force));
    handle("insights-cancel", (id) => insights.cancel(id));
    handle("insights-text", (id) => insightsMarkdown(engine.get(id)));
    handle("insights-export", async (id) => {
      const r = engine.get(id);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: path.join(
          app.getPath("documents"),
          r.title.replace(/[\\/:*?"<>|]/g, "_") + "-摘要与导图.md",
        ),
      });
      if (!canceled) await fs.writeFile(filePath, insightsMarkdown(r));
      return !canceled;
    });
    handle("cancel", (id) => engine.cancel(id));
    handle("retry", (id) => {
      if (insights.active?.id === id) throw Error("请先取消摘要任务");
      return engine.retry(id);
    });
    handle("edit", (id, fields) => engine.edit(id, fields));
    handle("remove", async (id) => {
      if (insights.active?.id === id) throw Error("请先取消摘要任务");
      const result = await dialog.showMessageBox(win, {
        type: "question",
        message: "将这条记录移入应用废纸篓？",
        detail: "音频与文字仍保留在本地 library/trash 目录。",
        buttons: ["保留", "移入废纸篓"],
        cancelId: 0,
        defaultId: 0,
      });
      if (result.response === 1) await engine.remove(id);
    });
    handle("export", async (id, format) => {
      if (!["txt", "md", "srt", "json"].includes(format))
        throw Error("未知导出格式");
      const r = engine.get(id);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: path.join(
          app.getPath("documents"),
          r.title.replace(/[\\/:*?"<>|]/g, "_") + "." + format,
        ),
      });
      if (!canceled) {
        await fs.writeFile(filePath, exportText(r, format));
        shell.showItemInFolder(filePath);
        return filePath;
      }
      return null;
    });
    handle("folder", (id) => shell.openPath(id ? engine.dir(id) : engine.root));
    handle("settings", async (value) => {
      const model =
        value.backend === "mlx-bf16"
          ? require("./models.cjs").BF16_MODEL
          : value.backend === "funasr"
            ? require("./models.cjs").FUNASR_MODEL
            : value.backend === "mlx"
              ? path.join(
                  os.homedir(),
                  "Library/Application Support/Chui Eve/models/Qwen3-ASR-1.7B-4bit",
                )
              : require("./engine.cjs").DEFAULT_MODEL;
      await engine.configure({ ...value, model });
      return engine.snapshot();
    });
    handle("availability", async () => {
      const {
        available,
        DEFAULT_MODEL,
        MLX_MODEL,
        BF16_MODEL,
        FUNASR_MODEL,
      } = require("./models.cjs");
      return {
        sherpa: available("sherpa", DEFAULT_MODEL),
        "mlx-bf16": available("mlx-bf16", BF16_MODEL),
        mlx: available("mlx", MLX_MODEL),
        funasr: available("funasr", FUNASR_MODEL),
      };
    });
    const icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVR4nGNgGAWjYBSMglEwCkgAAAUQAAHPZc50AAAAAElFTkSuQmCC",
    );
    tray = new Tray(icon);
    tray.setTitle("◉");
    tray.setToolTip("Chui Eve");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "打开 Chui Eve", click: () => windowControls.show() },
        { label: "退出", click: () => app.quit() },
      ]),
    );
    tray.on("click", () => {
      windowControls.show();
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Chui Eve",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "quit" },
          ],
        },
        {
          label: "编辑",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "窗口",
          submenu: [
            { role: "minimize" },
            { label: "显示主窗口", click: () => windowControls.show() },
            { role: "toggleDevTools" },
          ],
        },
      ]),
    );
    await win.loadFile(path.join(__dirname, "index.html"));
    win.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        windowControls.hide();
      }
    });
    app.on("activate", () => windowControls.show());
  });
  app.on("before-quit", (event) => {
    if (!quitting && engine) {
      event.preventDefault();
      quitting = true;
      insights?.close();
      const flushed = new Promise((resolve) => {
        shutdownResolve = resolve;
        setTimeout(resolve, 6000);
        win?.webContents.send("shutdown");
      });
      flushed.then(() => engine.close()).finally(() => app.quit());
    }
  });
}
