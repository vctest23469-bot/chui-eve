const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const {
  DEFAULTS,
  normalize,
  ModelSettings,
  completion,
} = require("../src/model-api.cjs");
const { Insights } = require("../src/insights.cjs");
const { VERSION } = require("../src/meeting-template.cjs");
const result = {
  summary: "演示摘要",
  topics: [{ title: "产品计划", points: ["整理反馈"] }],
  decisions: [],
  uncertainties: [],
  actions: [],
};
async function service(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  return {
    ...DEFAULTS,
    mode: "api",
    model: "demo-model",
    baseURL: `http://127.0.0.1:${server.address().port}`,
  };
}
function respond(res, value = result) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(value) } },
      ],
    }),
  );
}
async function idle(worker) {
  for (let i = 0; worker.active && i < 150; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(worker.active, null);
}
test("密钥加密持久化、重启复用、清除与服务域名隔离", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chui-model-settings-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const key = randomUUID();
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s.split("").reverse().join("")),
    decryptString: (b) => b.toString().split("").reverse().join(""),
  };
  const store = new ModelSettings(path.join(dir, "settings.json"), encryption);
  await store.init();
  const config = { ...DEFAULTS, mode: "api", model: "demo-model" };
  const saved = await store.save({ ...config, apiKey: key });
  assert.equal(saved.hasKey, true);
  assert.ok(!JSON.stringify(saved).includes(key));
  assert.ok(!(await fs.readFile(store.file, "utf8")).includes(key));
  assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
  const reopened = new ModelSettings(store.file, encryption);
  await reopened.init();
  assert.equal(reopened.credentials().key, key);
  await reopened.save(config);
  assert.equal(reopened.credentials().key, key);
  await reopened.save({ ...config, baseURL: "https://api.example.com/v1" });
  assert.equal(reopened.credentials().key, "");
  await reopened.save({ ...config, apiKey: key });
  await reopened.save({ ...config, clearKey: true });
  assert.equal(reopened.public().hasKey, false);
  const insecure = new ModelSettings(path.join(dir, "insecure.json"), {
    isEncryptionAvailable: () => false,
  });
  await assert.rejects(
    insecure.save({ ...config, apiKey: key }),
    /安全存储不可用/,
  );
  await assert.rejects(fs.access(insecure.file));
});
test("地址校验拒绝明文远程地址与 URL 内凭据", () => {
  for (const url of [
    "http://api.example.com/v1",
    "https://user:pass@example.com",
    "https://example.com?key=demo",
    "file:///tmp/model",
    "https://example.com/#demo",
  ])
    assert.throws(() => normalize({ ...DEFAULTS, baseURL: url }));
  assert.equal(
    normalize({
      ...DEFAULTS,
      baseURL: "http://localhost:1234/v1/chat/completions/",
    }).baseURL,
    "http://localhost:1234/v1",
  );
});
test("真实 HTTP 协议、JSON 模式和摘要分段/合并/缓存失效", async (t) => {
  const calls = [];
  const config = await service(t, async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    calls.push({ url: req.url, body: JSON.parse(body) });
    respond(res);
  });
  config.chunkChars = 2000;
  const r = {
    id: "demo",
    title: "演示会议",
    state: "done",
    segments: [{ start: 0, text: "合成演示内容。".repeat(600) }],
  };
  const worker = new Insights(
    { get: () => r, save: async () => {}, emitState: () => {} },
    { settings: { credentials: () => ({ ...config }) } },
  );
  await worker.start(r.id);
  await assert.rejects(worker.start(r.id), /正在生成/);
  await idle(worker);
  assert.equal(r.insights.status, "done");
  assert.equal(r.insights.result.templateVersion, VERSION);
  assert.ok(calls.length > 1);
  assert.ok(
    calls.every(
      (c) =>
        c.url === "/chat/completions" &&
        c.body.model === config.model &&
        c.body.response_format.type === "json_object",
    ),
  );
  const count = calls.length;
  await worker.start(r.id);
  assert.equal(worker.active, null);
  assert.equal(calls.length, count);
  config.model = "other-demo-model";
  config.jsonMode = false;
  await worker.start(r.id);
  await idle(worker);
  assert.ok(calls.length > count);
  assert.equal(calls.at(-1).body.response_format, undefined);
  assert.equal(r.insights.model, "other-demo-model · API");
});
test("HTTP 错误不泄露服务返回内容，重定向不携带密钥外发", async (t) => {
  const privateText = randomUUID();
  const config = await service(t, (req, res) => {
    res.writeHead(401);
    res.end(privateText);
  });
  await assert.rejects(
    completion(config, "测试", {}),
    (e) => /API Key/.test(e.message) && !e.message.includes(privateText),
  );
  let redirected = false;
  const target = await service(t, (req, res) => {
    redirected = true;
    respond(res);
  });
  const origin = await service(t, (req, res) => {
    res.writeHead(302, { Location: target.baseURL });
    res.end();
  });
  await assert.rejects(
    completion({ ...origin, key: privateText }, "测试", {}),
    /无法连接/,
  );
  assert.equal(redirected, false);
});
test("请求取消与非法/截断模型输出均进入失败状态，保留已有结果", async (t) => {
  const hanging = await service(t, () => {});
  const r = {
    id: "demo",
    title: "演示",
    state: "done",
    segments: [{ start: 0, text: "合成内容" }],
    insights: { result, sourceHash: "old" },
  };
  const worker = new Insights(
    { get: () => r, save: async () => {}, emitState: () => {} },
    { settings: { credentials: () => hanging } },
  );
  await worker.start(r.id);
  worker.cancel(r.id);
  await idle(worker);
  assert.equal(r.insights.status, "cancelled");
  assert.equal(r.insights.result, result);
  const malformed = await service(t, (req, res) =>
    respond(res, { summary: "无导图" }),
  );
  worker.settings = { credentials: () => malformed };
  await worker.start(r.id);
  await idle(worker);
  assert.equal(r.insights.status, "failed");
  assert.equal(r.insights.result, result);
  const truncated = await service(t, (req, res) =>
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      }),
    ),
  );
  await assert.rejects(completion(truncated, "测试", {}), /截断/);
});
