const fs = require("node:fs/promises"),
  fss = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawn } = require("node:child_process"),
  { randomUUID } = require("node:crypto"),
  { EventEmitter } = require("node:events"),
  { createInterface } = require("node:readline"),
  { pipeline } = require("node:stream/promises");
const { wavHeader, fixWav, planSegments } = require("./audio.cjs");
const {
  DEFAULT_MODEL,
  validateModel,
  resolveModel,
  MODEL_LABELS,
} = require("./models.cjs");
class Engine extends EventEmitter {
  constructor({ root, runtime }) {
    super();
    this.root = root;
    this.runtime = runtime;
    this.records = [];
    this.queue = [];
    this.child = null;
    this.active = null;
    this.ready = false;
    this.stopping = false;
    this.state = "未加载";
    this.saveChain = Promise.resolve();
    this.saved = new Map();
    this.captureChain = Promise.resolve();
    this.decodeChain = Promise.resolve();
    this.conversions = new Map();
    this.settings = {
      backend: "sherpa",
      model: DEFAULT_MODEL,
      theme: "system",
    };
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(path.join(this.root, "records"), { recursive: true });
    try {
      Object.assign(
        this.settings,
        JSON.parse(
          await fs.readFile(path.join(this.root, "settings.json"), "utf8"),
        ),
      );
    } catch {}
    const resolved = resolveModel(this.settings);
    if (resolved !== this.settings) {
      this.settings = resolved;
      await fs.writeFile(
        path.join(this.root, "settings.json"),
        JSON.stringify(this.settings, null, 2),
      );
    }
    for (const id of await fs.readdir(path.join(this.root, "records"))) {
      try {
        const r = JSON.parse(
          await fs.readFile(
            path.join(this.root, "records", id, "record.json"),
            "utf8",
          ),
        );
        if (
          [
            "recording",
            "processing",
            "queued",
            "converting",
            "waiting",
          ].includes(r.state)
        ) {
          r.state = "interrupted";
          r.error = "上次任务中断，已保留录音，可重新转写";
          await fixWav(this.audioPath(r.id)).catch(() => {});
        }
        if (r.insights?.status === "running") {
          r.insights.status = "failed";
          r.insights.error = "上次提炼中断，请重试";
        }
        this.records.push(r);
      } catch {}
    }
    this.records.sort((a, b) => b.created.localeCompare(a.created));
    await this.save();
    return this.snapshot();
  }
  dir(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("无效记录");
    return path.join(this.root, "records", id);
  }
  audioPath(id) {
    return path.join(this.dir(id), "audio.wav");
  }
  get(id) {
    const r = this.records.find((r) => r.id === id);
    if (!r) throw Error("记录不存在");
    return r;
  }
  snapshot() {
    return {
      records: this.records.map(({ ...r }) => ({
        ...r,
        insights: r.insights
          ? {
              ...r.insights,
              stale:
                !!r.insights.result &&
                r.insights.sourceHash !==
                  require("./insights.cjs").fingerprint(r),
            }
          : undefined,
      })),
      settings: this.settings,
      engine: {
        state: this.state,
        ready: this.ready,
        pending: this.queue.length,
        busy: !!this.active,
      },
    };
  }
  emitState() {
    this.emit("change", this.snapshot());
  }
  save() {
    const records = this.records.map((r) => ({
      id: r.id,
      text: JSON.stringify(r, null, 2),
    }));
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(async () => {
        for (const r of records) {
          if (this.saved.get(r.id) === r.text) continue;
          const file = path.join(this.dir(r.id), "record.json");
          await fs.writeFile(file + ".tmp", r.text);
          await fs.rename(file + ".tmp", file);
          this.saved.set(r.id, r.text);
        }
      });
    return this.saveChain;
  }
  async newRecord(title, kind) {
    const r = {
      id: randomUUID(),
      title: title || new Date().toLocaleString("zh-CN"),
      kind,
      created: new Date().toISOString(),
      state: kind === "live" ? "recording" : "converting",
      duration: 0,
      processed: 0,
      segments: [],
      model: MODEL_LABELS[this.settings.backend],
      error: null,
    };
    await fs.mkdir(this.dir(r.id));
    this.records.unshift(r);
    await this.save();
    this.emitState();
    return r;
  }
  async configure(settings) {
    if (
      this.active ||
      this.queue.length ||
      this.records.some((r) => r.state === "recording") ||
      this.conversions.size ||
      this.records.some((r) => r.state === "waiting")
    )
      throw Error("请等待当前任务结束后切换模型");
    const backend = settings.backend || this.settings.backend;
    if (!["sherpa", "mlx", "mlx-bf16", "funasr"].includes(backend))
      throw Error("未知引擎");
    const model = settings.model || this.settings.model;
    validateModel(backend, model);
    const hotwords = String(
      settings.hotwords ?? this.settings.hotwords ?? "",
    ).slice(0, 1200);
    const language = settings.language ?? this.settings.language ?? "";
    if (!["", "Chinese"].includes(language)) throw Error("不支持的识别语言");
    this.shutdownWorker();
    this.settings = {
      ...this.settings,
      ...settings,
      backend,
      model,
      hotwords,
      language,
    };
    await fs.writeFile(
      path.join(this.root, "settings.json"),
      JSON.stringify(this.settings, null, 2),
    );
    this.ensureWorker();
    this.emitState();
  }
  ensureWorker() {
    if (this.child || this.stopping) return;
    try {
      validateModel(this.settings.backend, this.settings.model);
    } catch (error) {
      this.failWorker(error.message);
      return;
    }
    this.state = "正在加载模型";
    this.emitState();
    const mlx = this.settings.backend.startsWith("mlx");
    const executable = mlx
      ? path.join(
          os.homedir(),
          "Library/Application Support/Chui Eve/mlx-env/bin/python",
        )
      : path.join(this.runtime, "node");
    const c = spawn(
      executable,
      [
        path.join(
          __dirname,
          mlx
            ? "mlx-worker.py"
            : this.settings.backend === "funasr"
              ? "funasr-worker.cjs"
              : "asr-worker.cjs",
        ),
      ],
      {
        env: {
          ...process.env,
          CHUI_RUNTIME: this.runtime,
          CHUI_MODEL: this.settings.model,
          HF_HUB_OFFLINE: "1",
          TOKENIZERS_PARALLELISM: "false",
          CHUI_NODE_PATH: path.join(this.runtime, "node"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = c;
    let errors = "";
    c.stderr.on("data", (b) => {
      errors = (errors + b.toString()).slice(-5000);
    });
    const timer = setTimeout(() => {
      if (!this.ready && this.child === c) {
        this.failWorker("模型加载超时");
      }
    }, 120000);
    c.once("error", (e) => {
      if (this.child === c) this.failWorker(e.message);
    });
    c.once("exit", () => {
      clearTimeout(timer);
      if (this.child !== c) return;
      this.child = null;
      this.ready = false;
      if (!this.stopping)
        this.failWorker("识别进程退出：" + errors.slice(-600));
    });
    createInterface({ input: c.stdout }).on("line", (line) => {
      if (this.child !== c) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.ready) {
        clearTimeout(timer);
        this.ready = true;
        this.state = "模型就绪";
        this.emitState();
        this.pump();
      } else if (msg.fatal) this.failWorker(msg.fatal);
      else
        this.finish(msg).catch((e) =>
          this.failWorker("保存转写失败：" + e.message),
        );
    });
  }
  failWorker(message) {
    this.shutdownWorker();
    this.state = "引擎异常";
    const affected = new Set(this.queue.map((j) => j.record));
    for (const record of this.records) {
      if (record.state === "recording") affected.add(record.id);
    }
    if (this.active) {
      affected.add(this.active.record);
      clearTimeout(this.active.timer);
      this.active = null;
    }
    this.queue = [];
    for (const id of affected) {
      const r = this.get(id);
      if (r.state === "recording") r.asrFailed = true;
      else r.state = "failed";
      r.error = message;
    }
    this.save().catch((e) => this.emit("error", e));
    this.emitState();
  }
  shutdownWorker() {
    const c = this.child;
    this.child = null;
    this.ready = false;
    if (c) c.kill();
  }
  async importFile(file) {
    const st = await fs.stat(file);
    if (!st.isFile()) throw Error("请选择音频文件");
    const r = await this.newRecord(
      path.basename(file, path.extname(file)),
      "file",
    );
    r.originalName = path.basename(file);
    const previous = this.decodeChain;
    let release;
    this.decodeChain = new Promise((resolve) => (release = resolve));
    r.state = "waiting";
    this.emitState();
    await previous;
    if (r.state === "cancelled" || this.stopping) {
      release();
      return r.id;
    }
    r.state = "converting";
    this.emitState();
    const raw = path.join(this.dir(r.id), "convert.pcm");
    try {
      await new Promise((resolve, reject) => {
        const c = spawn(path.join(this.runtime, "ffmpeg"), [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          file,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "s16le",
          raw,
        ]);
        this.conversions.set(r.id, c);
        let err = "";
        c.stderr.on("data", (b) => (err = (err + b).slice(-1200)));
        c.on("error", reject);
        c.on("close", (code) =>
          code === 0 ? resolve() : reject(Error(err || "音频解码失败")),
        );
      });
      if (r.state === "cancelled") return r.id;
      const size = (await fs.stat(raw)).size;
      if (!size) throw Error("文件没有可识别的音轨");
      if (size > 0xffffffff - 36)
        throw Error("音频过长，请拆分为小于 24 小时的文件");
      await fs.writeFile(this.audioPath(r.id), wavHeader(size));
      await pipeline(
        fss.createReadStream(raw),
        fss.createWriteStream(this.audioPath(r.id), { flags: "a" }),
      );
      r.duration = size / 32000;
      await this.enqueueFile(r);
    } catch (e) {
      if (r.state !== "cancelled") {
        r.state = "failed";
        r.error = e.message;
      }
    } finally {
      this.conversions.delete(r.id);
      release();
      await fs.rm(raw, { force: true });
      await this.save();
      this.emitState();
    }
    return r.id;
  }
  async enqueueFile(r) {
    r.state = "queued";
    r.asrFailed = false;
    r.segments = [];
    r.processed = 0;
    r.error = null;
    r.model = MODEL_LABELS[this.settings.backend];
    const segments = await planSegments(this.audioPath(r.id), r.duration);
    if (r.state === "cancelled" || this.stopping) return;
    for (const { start, end } of segments)
      this.queue.push({
        id: randomUUID(),
        record: r.id,
        start,
        end,
        live: false,
      });
    await this.save();
    this.ensureWorker();
    this.pump();
  }
  async startLive(title) {
    if (this.records.some((r) => r.state === "recording"))
      throw Error("已有正在录制的会议");
    const r = await this.newRecord(title, "live");
    await fs.writeFile(this.audioPath(r.id), wavHeader(0));
    this.ensureWorker();
    return r.id;
  }
  appendLive(id, array) {
    const task = this.captureChain.then(async () => {
      const r = this.get(id);
      if (r.state !== "recording") throw Error("录制已停止");
      const b = Buffer.from(array);
      if (!b.length || b.length % 2 || b.length > 32000 * 20)
        throw Error("无效音频分段");
      const start = r.duration;
      await fs.appendFile(this.audioPath(id), b);
      r.duration += b.length / 32000;
      await fixWav(this.audioPath(id));
      if (!r.asrFailed)
        this.queue.push({
          id: randomUUID(),
          record: id,
          start,
          end: r.duration,
          live: true,
        });
      await this.save();
      this.emitState();
      this.pump();
      return true;
    });
    this.captureChain = task.catch(() => {});
    return task;
  }
  async stopLive(id) {
    await this.captureChain;
    const r = this.get(id);
    if (r.state !== "recording") return;
    r.state = r.asrFailed ? "failed" : "processing";
    await fixWav(this.audioPath(id));
    this.completeIfDone(r);
    await this.save();
    this.emitState();
  }
  completeIfDone(r) {
    if (["recording", "failed", "cancelled"].includes(r.state)) return;
    if (
      !this.queue.some((j) => j.record === r.id) &&
      this.active?.record !== r.id
    ) {
      r.state = r.segments.length ? "done" : "empty";
      r.processed = r.duration;
    }
  }
  async pump() {
    if (this.active || !this.ready || !this.queue.length || this.stopping)
      return;
    let idx = this.queue.findIndex((j) => j.live);
    if (idx < 0) idx = 0;
    const j = this.queue.splice(idx, 1)[0];
    this.active = j;
    const r = this.get(j.record);
    if (r.state !== "recording") r.state = "processing";
    this.emitState();
    try {
      const start = Math.round(j.start * 16000) * 2,
        end = Math.round(j.end * 16000) * 2,
        b = Buffer.alloc(end - start);
      const f = await fs.open(this.audioPath(r.id), "r");
      try {
        await f.read(b, 0, b.length, 44 + start);
      } finally {
        await f.close();
      }
      j.path = path.join(this.dir(r.id), `chunk-${j.id}.wav`);
      await fs.writeFile(j.path, Buffer.concat([wavHeader(b.length), b]));
      if (this.active !== j) return;
      j.timer = setTimeout(
        () => this.failWorker("单段识别超过 90 秒，任务已停止，可重试"),
        90000,
      );
      this.child.stdin.write(
        JSON.stringify({
          id: j.id,
          path: j.path,
          language: this.settings.language || null,
          hotwords: String(this.settings.hotwords || "")
            .split(/[,，、;；\n]+/)
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 60),
        }) + "\n",
      );
    } catch (e) {
      if (this.active === j) {
        await this.finish({ id: j.id, error: e.message });
      }
    }
  }
  async finish(msg) {
    const j = this.active;
    if (!j || (msg.id && msg.id !== j.id)) return;
    clearTimeout(j.timer);
    this.active = null;
    const r = this.get(j.record);
    if (r.state !== "cancelled") {
      if (msg.error) {
        if (r.state === "recording") r.asrFailed = true;
        else r.state = "failed";
        r.error = msg.error;
        this.queue = this.queue.filter((q) => q.record !== r.id);
      } else {
        if (msg.suppressed) {
          r.qualityIssues ||= [];
          r.qualityIssues.push({
            start: j.start,
            end: j.end,
            reason: msg.suppressed,
            rejectedText: msg.rejectedText || null,
          });
        }
        if (msg.text)
          r.segments.push({
            start: j.start,
            end: j.end,
            text: msg.text,
            ms: msg.ms || 0,
            peakMemoryMB: msg.peakMemoryMB,
          });
        r.processed = j.end;
        this.completeIfDone(r);
      }
    }
    if (j.path) await fs.rm(j.path, { force: true }).catch(() => {});
    try {
      await this.save();
    } catch (error) {
      r.error = "保存转写失败：" + error.message;
      if (r.state === "recording") r.asrFailed = true;
      else r.state = "failed";
      this.emitState();
      throw error;
    }
    this.emitState();
    this.pump();
  }
  async cancel(id) {
    const r = this.get(id);
    if (r.state === "recording") throw Error("请先结束录制");
    r.state = "cancelled";
    this.queue = this.queue.filter((j) => j.record !== id);
    this.conversions.get(id)?.kill();
    if (this.active?.record === id) {
      clearTimeout(this.active.timer);
      this.active = null;
      this.shutdownWorker();
      if (this.queue.length) this.ensureWorker();
    }
    await this.save();
    this.emitState();
  }
  async retry(id) {
    const r = this.get(id);
    if (
      !["failed", "interrupted", "cancelled", "done", "empty"].includes(r.state)
    )
      throw Error("任务正在进行");
    await fs.access(this.audioPath(id));
    await fixWav(this.audioPath(id));
    r.duration = ((await fs.stat(this.audioPath(id))).size - 44) / 32000;
    await this.enqueueFile(r);
    this.emitState();
  }
  async edit(id, fields) {
    const r = this.get(id);
    if (fields.title !== undefined)
      r.title = String(fields.title).slice(0, 200);
    if (fields.segment !== undefined) {
      const s = r.segments[fields.segment];
      if (!s) throw Error("分段不存在");
      s.text = String(fields.text).slice(0, 20000);
    }
    await this.save();
    this.emitState();
  }
  async remove(id) {
    const r = this.get(id);
    if (
      ["recording", "processing", "queued", "converting", "waiting"].includes(
        r.state,
      )
    )
      throw Error("请先停止或取消任务");
    await this.saveChain;
    await fs.rename(this.dir(id), path.join(this.root, `trash-${id}`));
    this.records = this.records.filter((r) => r.id !== id);
    this.emitState();
  }
  async close() {
    this.stopping = true;
    for (const c of this.conversions.values()) c.kill();
    if (this.active) clearTimeout(this.active.timer);
    this.shutdownWorker();
    await this.captureChain;
    for (const r of this.records)
      if (
        ["recording", "queued", "processing", "converting", "waiting"].includes(
          r.state,
        )
      ) {
        r.state = "interrupted";
        r.error = "任务已中断，可重新转写";
        await fixWav(this.audioPath(r.id)).catch(() => {});
      }
    await this.save();
  }
}
module.exports = { Engine, DEFAULT_MODEL };
