const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const {
  Insights,
  fingerprint,
  validateResult,
  chunksFor,
} = require("../src/insights.cjs");
const result = {
  summary: "发布延期，预算待议。",
  topics: [{ title: "发布", points: ["九月二十日发布"] }],
  actions: [],
};
async function fixture(t, fail = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chui-insights-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const binary = path.join(dir, "cli");
  await fs.writeFile(
    binary,
    `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>{${fail ? "process.exit(1)" : `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(JSON.stringify(result))}}}))`}},150));`,
  );
  await fs.chmod(binary, 0o755);
  const r = {
    id: "test",
    title: "发布会议",
    state: "done",
    segments: [{ start: 0, text: "九月二十日发布，预算待议。" }],
  };
  const engine = { get: () => r, save: async () => {}, emitState: () => {} };
  return { r, worker: new Insights(engine, { binary }) };
}
async function idle(w) {
  for (let i = 0; i < 100 && w.active; i++)
    await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.active, null);
}
test("摘要完成、缓存复用与编辑后失效", async (t) => {
  const { r, worker } = await fixture(t);
  await worker.start(r.id);
  await assert.rejects(worker.start(r.id), /正在生成/);
  await idle(worker);
  assert.equal(r.insights.status, "done");
  assert.equal(r.insights.sourceHash, fingerprint(r));
  await worker.start(r.id);
  assert.equal(worker.active, null);
  r.segments[0].text += "追加内容";
  assert.notEqual(r.insights.sourceHash, fingerprint(r));
});
test("取消和 CLI 失败不能伪报生成成功", async (t) => {
  const { r, worker } = await fixture(t);
  await worker.start(r.id);
  worker.cancel(r.id);
  await idle(worker);
  assert.equal(r.insights.status, "cancelled");
  const other = await fixture(t, true);
  await other.worker.start("test");
  await idle(other.worker);
  assert.equal(other.r.insights.status, "failed");
  assert.equal(other.r.insights.result, undefined);
});
test("长分段不截断，非法结构被拒绝", () => {
  const text = "转写文字".repeat(20000);
  const chunks = chunksFor({ segments: [{ start: 0, text }] });
  assert.ok(chunks.every((c) => c.length <= 24000));
  assert.equal(chunks.join(""), "[00:00] " + text + "\n");
  assert.throws(() =>
    validateResult({ summary: "有摘要", topics: [{ title: "错误" }] }),
  );
});
