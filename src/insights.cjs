const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { createHash } = require("node:crypto");
const { DEFAULTS, configHash, completion } = require("./model-api.cjs");
const {
  VERSION,
  INSTRUCTION,
  SCHEMA,
  verifyActions,
} = require("./meeting-template.cjs");
function fingerprint(r) {
  return createHash("sha256")
    .update(JSON.stringify([r.title, r.segments.map((s) => [s.start, s.text])]))
    .digest("hex");
}
function validateResult(v) {
  if (
    !v ||
    typeof v.summary !== "string" ||
    !v.summary.trim() ||
    !Array.isArray(v.topics) ||
    !v.topics.length
  )
    throw Error("模型未返回有效摘要，请重试");
  const clean = (s) => String(s).trim().slice(0, 4000);
  const topics = v.topics.slice(0, 10).map((t) => {
    if (
      typeof t.title !== "string" ||
      !t.title.trim() ||
      !Array.isArray(t.points) ||
      !t.points.some((p) => typeof p === "string" && p.trim())
    )
      throw Error("模型返回的导图结构无效，请重试");
    return {
      title: clean(t.title),
      points: t.points
        .filter((p) => typeof p === "string" && p.trim())
        .slice(0, 6)
        .map(clean),
    };
  });
  return {
    summary: clean(v.summary),
    topics,
    decisions: Array.isArray(v.decisions)
      ? v.decisions.filter((x) => typeof x === "string").map(clean)
      : [],
    uncertainties: Array.isArray(v.uncertainties)
      ? v.uncertainties.filter((x) => typeof x === "string").map(clean)
      : [],
    actionItems: Array.isArray(v.actions)
      ? v.actions
          .filter(
            (a) =>
              a &&
              typeof a.task === "string" &&
              (Array.isArray(a.evidenceIds) ||
                (typeof a.quote === "string" && Number.isFinite(a.start))),
          )
          .map((a) => ({
            task: clean(a.task),
            owner: typeof a.owner === "string" ? clean(a.owner) : null,
            deadline: typeof a.deadline === "string" ? clean(a.deadline) : null,
            evidenceIds: a.evidenceIds,
            start: a.start,
            quote: a.quote,
          }))
      : [],
    actions: Array.isArray(v.actions)
      ? v.actions.filter((a) => typeof a === "string").map(clean)
      : [],
  };
}
function markdown(r) {
  const v = r.insights?.result;
  if (!v) throw Error("请先生成摘要");
  return `# ${r.title}\n\n> AI 提炼，需结合原文核对。${r.insights.sourceHash !== fingerprint(r) ? "原文已修改，此结果基于较早版本。" : ""}模型：${r.insights.model}\n\n## 会议概览\n\n${v.summary}\n\n## 已明确结论\n\n${(v.decisions || []).map((x) => "- " + x).join("\n") || "原文未明确。"}\n\n## 讨论要点\n\n${v.topics.map((t) => `## ${t.title}\n\n${t.points.map((p) => "- " + p).join("\n")}`).join("\n\n")}\n\n## 待办事项（依据转写，需回听核对）\n\n${v.actions.length ? v.actions.map((a) => "- " + a).join("\n") : "原文未明确。"}\n\n## 待确认问题\n\n${(v.uncertainties || []).map((x) => "- " + x).join("\n") || "暂无。"}\n`;
}
function chunksFor(r, limit = 24000, withIds = false) {
  const pieces = [];
  let current = "";
  for (const [index, s] of r.segments.entries()) {
    const line = `${withIds ? `[s${index}] ` : ""}[${Math.floor(s.start / 60)
      .toString()
      .padStart(2, "0")}:${Math.floor(s.start % 60)
      .toString()
      .padStart(2, "0")}] ${s.text}\n`;
    for (let i = 0; i < line.length; i += limit) {
      const part = line.slice(i, i + limit);
      if (current.length + part.length > limit) {
        pieces.push(current);
        current = "";
      }
      current += part;
    }
  }
  if (current.trim()) pieces.push(current);
  return pieces;
}
class Insights {
  constructor(engine, { binary, settings, fetchImpl } = {}) {
    this.engine = engine;
    this.binary = binary;
    this.settings = settings;
    this.fetchImpl = fetchImpl;
    this.active = null;
  }
  async resolveBinary() {
    const candidates = [
      this.binary,
      process.env.CHUI_CODEX_PATH,
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
      "/opt/homebrew/bin/codex",
    ].filter(Boolean);
    for (const file of candidates) {
      if (
        await fs.access(file, 1).then(
          () => true,
          () => false,
        )
      )
        return file;
    }
    throw Error("未找到 Codex CLI，请安装 Codex 或设置 CHUI_CODEX_PATH");
  }
  async available() {
    if (this.settings?.credentials().mode === "api") return true;
    return this.resolveBinary().then(
      () => true,
      () => false,
    );
  }
  async start(id, force = false) {
    const r = this.engine.get(id);
    if (!r.segments.some((s) => s.text.trim()))
      throw Error("还没有可提炼的转写内容");
    if (
      ["recording", "processing", "queued", "converting", "waiting"].includes(
        r.state,
      )
    )
      throw Error("请等转写完成后再提炼");
    const hash = fingerprint(r);
    const config = this.settings?.credentials() || { ...DEFAULTS };
    const providerHash = configHash(config);
    if (
      !force &&
      r.insights?.result?.templateVersion === VERSION &&
      r.insights.sourceHash === hash &&
      r.insights.providerHash === providerHash
    )
      return true;
    if (this.active) throw Error("已有摘要正在生成，请等待完成或取消");
    const job = {
      id,
      cancelled: false,
      child: null,
      controller: new AbortController(),
      config,
    };
    this.active = job;
    let binary;
    try {
      binary = config.mode === "api" ? null : await this.resolveBinary();
    } catch (e) {
      this.active = null;
      throw e;
    }
    const modelLabel =
      config.mode === "api" ? `${config.model} · API` : "GPT-5.5 · Codex CLI";
    const previous = r.insights;
    r.insights = {
      status: "running",
      progress: `正在调用 ${config.mode === "api" ? config.model : "GPT-5.5"}…`,
      sourceHash: previous?.sourceHash,
      result: previous?.result,
      model: modelLabel,
    };
    this.engine.emitState();
    try {
      await this.engine.save();
    } catch (e) {
      r.insights = previous;
      this.active = null;
      throw e;
    }
    const snapshot = {
      title: r.title,
      segments: r.segments.map((s) => ({ ...s })),
    };
    this.process(job, binary, snapshot)
      .then((result) => {
        if (job.cancelled) throw Error("已取消生成");
        r.insights = {
          status: "done",
          progress: "",
          sourceHash: hash,
          providerHash,
          result,
          model: modelLabel,
          created: new Date().toISOString(),
        };
      })
      .catch((e) => {
        r.insights = {
          ...r.insights,
          status: job.cancelled ? "cancelled" : "failed",
          progress: "",
          error: e.message,
        };
      })
      .finally(async () => {
        this.active = null;
        await this.engine.save();
        this.engine.emitState();
      })
      .catch(console.error);
    return true;
  }
  async process(job, binary, r) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chui-insights-"));
    try {
      await fs.writeFile(path.join(dir, "schema.json"), JSON.stringify(SCHEMA));
      const chunks = chunksFor(
        r,
        job.config.mode === "api" ? job.config.chunkChars : 24000,
        true,
      );
      let notes = [];
      for (let i = 0; i < chunks.length; i++) {
        this.progress(
          job,
          chunks.length === 1
            ? "正在提炼摘要与思维导图…"
            : `正在提炼第 ${i + 1} / ${chunks.length} 部分…`,
        );
        notes.push(
          await this.call(
            job,
            binary,
            dir,
            INSTRUCTION +
              "\n标题：" +
              r.title +
              "\n<转写材料>\n" +
              chunks[i] +
              "\n</转写材料>",
          ),
        );
      }
      while (notes.length > 1) {
        const reduced = [];
        for (let i = 0; i < notes.length; i += 4) {
          this.progress(job, "正在合并长录音要点…");
          reduced.push(
            await this.call(
              job,
              binary,
              dir,
              INSTRUCTION +
                "\n合并以下分段摘要，保留每条行动项的全部字段及原样evidenceIds，不得修改段落编号。去重，核对后文是否取消或改变早期任务；完整保留后半段事项。\n<转写材料>\n" +
                JSON.stringify(
                  notes
                    .slice(i, i + 4)
                    .map((n) => ({ ...n, actions: n.actionItems })),
                ) +
                "\n</转写材料>",
            ),
          );
        }
        notes = reduced;
      }
      return await this.auditActions(job, binary, r, notes[0], dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  async auditActions(job, binary, r, result, dir) {
    if (!result.actionItems?.length) return verifyActions(result, r);
    this.progress(job, "正在逐条核对待办承诺、去重及负责人依据…");
    const ids = [
      ...new Set(result.actionItems.flatMap((a) => a.evidenceIds || [])),
    ];
    const closingStart = Math.max(0, (r.segments.at(-1)?.start || 0) - 1200);
    r.segments.forEach((s, index) => {
      if (s.start >= closingStart) ids.push(`s${index}`);
    });
    const evidence = [...new Set(ids)]
      .filter((id) => /^s\d+$/.test(id) && r.segments[Number(id.slice(1))])
      .map((id) => ({ id, ...r.segments[Number(id.slice(1))] }));
    const audit = await this.call(
      job,
      binary,
      dir,
      INSTRUCTION +
        "\n现在是严格的第二轮审校。证据包含会尾20分钟，请同时检查会尾遗漏的明确任务，补入行动项。以下待办只是候选，不能信任其任务表述。逐条对照evidence的实际话语：删除仅建议、询问、条件未满足、不清晰交付物或被会尾改变的项，放到uncertainties；合并同一交付物的早期与会尾复述，优先保留会尾编号。金额型号不清不能写入任务。不要把活动日期填进deadline。负责人可为原文明示承担该任务的团队/部门，身份不能确认则null。不能因为出现人名就认为其负责。只保留有清晰承诺或接受的行动项；完整保留原有概览和主题，修正可疑结论，新增问题并入待确认。\n<候选与证据>\n" +
        JSON.stringify({
          summary: result.summary,
          decisions: result.decisions,
          topics: result.topics,
          uncertainties: result.uncertainties,
          actions: result.actionItems,
          evidence,
        }) +
        "\n</候选与证据>",
    );
    return verifyActions(audit, r);
  }
  progress(job, text) {
    if (job.cancelled) throw Error("已取消生成");
    this.engine.get(job.id).insights.progress = text;
    this.engine.emitState();
  }
  call(job, binary, dir, prompt) {
    if (job.cancelled) return Promise.reject(Error("已取消生成"));
    if (job.config.mode === "api")
      return completion(job.config, prompt, SCHEMA, {
        signal: job.controller.signal,
        fetchImpl: this.fetchImpl,
      }).then(validateResult);
    return new Promise((resolve, reject) => {
      const args = [
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "-m",
        "gpt-5.5",
        "-c",
        'model_reasoning_effort="medium"',
        "-c",
        "project_doc_max_bytes=0",
        "-c",
        'web_search="disabled"',
        "--output-schema",
        path.join(dir, "schema.json"),
        "--json",
        "-",
      ];
      for (const feature of [
        "shell_tool",
        "unified_exec",
        "apps",
        "plugins",
        "hooks",
        "memories",
        "multi_agent",
        "browser_use",
        "computer_use",
        "image_generation",
        "code_mode_host",
        "workspace_dependencies",
      ])
        args.push("--disable", feature);
      const child = spawn(binary, args, {
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CODEX_THREAD_ID: "",
          CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "chui-eve",
        },
      });
      job.child = child;
      let output = "",
        error = "",
        size = 0;
      const timer = setTimeout(
        () => {
          error = "GPT-5.5 请求超时，请重试";
          child.kill();
        },
        10 * 60 * 1000,
      );
      child.stdin.on("error", () => {});
      child.stderr.on("data", (b) => {
        if (/401|unauthorized|not logged/i.test(String(b)))
          error = "Codex 登录失效，请重新登录";
      });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        size += line.length;
        if (size > 2000000) {
          error = "模型输出超过限制";
          child.kill();
          return;
        }
        try {
          const event = JSON.parse(line);
          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message"
          )
            output = event.item.text;
          if (event.type === "error" || event.type === "turn.failed")
            error = "GPT-5.5 调用失败，请检查 Codex 登录、网络和额度";
        } catch {}
      });
      child.once("error", () => {
        clearTimeout(timer);
        reject(Error("无法启动 Codex CLI，请检查安装路径"));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        job.child = null;
        if (job.cancelled) return reject(Error("已取消生成"));
        if (code !== 0 || !output)
          return reject(
            Error(error || "GPT-5.5 未返回结果，请检查 Codex 登录与模型权限"),
          );
        try {
          resolve(validateResult(JSON.parse(output)));
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.end(prompt);
    });
  }
  cancel(id) {
    if (this.active?.id === id) {
      this.active.cancelled = true;
      this.active.controller.abort();
      this.active.child?.kill();
    }
    return true;
  }
  close() {
    if (this.active) {
      this.active.cancelled = true;
      this.active.controller.abort();
      this.active.child?.kill();
    }
  }
}
module.exports = {
  Insights,
  fingerprint,
  validateResult,
  markdown,
  chunksFor,
  SCHEMA,
};
