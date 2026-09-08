const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../src/engine.cjs");
const { wavHeader, fixWav, exportText } = require("../src/audio.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-test-"));
  const e = new Engine({ root, runtime: path.resolve("runtime") });
  e.on("error", () => {});
  await e.init();
  e.ensureWorker = () => {};
  t.after(async () => {
    await e.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return e;
}
test("尾段保存与停止串行，重启可恢复真实 WAV 长度", async (t) => {
  const e = await fixture(t);
  const id = await e.startLive("测试");
  const bytes = Buffer.alloc(32000);
  const save = e.appendLive(id, bytes);
  await e.stopLive(id);
  await save;
  assert.equal(e.get(id).duration, 1);
  assert.equal((await fs.readFile(e.audioPath(id))).readUInt32LE(40), 32000);
  assert.equal(e.queue.length, 1);
  await e.close();
  const reopened = new Engine({ root: e.root, runtime: e.runtime });
  await reopened.init();
  assert.equal(reopened.get(id).state, "interrupted");
  assert.equal(reopened.get(id).duration, 1);
});
test("取消队列任务不会清空其他会议，重试重建而非重复追加", async (t) => {
  const e = await fixture(t);
  const a = await e.startLive("A");
  await e.appendLive(a, Buffer.alloc(32000));
  await e.stopLive(a);
  const b = await e.startLive("B");
  await e.appendLive(b, Buffer.alloc(32000));
  await e.stopLive(b);
  await e.cancel(a);
  assert.equal(e.queue.length, 1);
  assert.equal(e.queue[0].record, b);
  e.get(a).segments = [{ start: 0, end: 1, text: "旧结果" }];
  await e.retry(a);
  assert.equal(e.get(a).segments.length, 0);
  assert.equal(e.queue.filter((j) => j.record === a).length, 1);
});
test("有效文本、空音频与失败严格分开", async (t) => {
  const e = await fixture(t);
  for (const [msg, expected] of [
    [{ text: "你好" }, "done"],
    [{ text: "", silent: true }, "empty"],
    [{ error: "模型异常" }, "failed"],
  ]) {
    const id = await e.startLive("验收");
    await e.appendLive(id, Buffer.alloc(32000));
    await e.stopLive(id);
    const j = e.queue.shift();
    e.active = j;
    await e.finish(msg);
    assert.equal(e.get(id).state, expected);
  }
});
test("字幕毫秒格式、编辑内容导出与路径边界", async (t) => {
  const e = await fixture(t);
  assert.throws(() => e.dir("../etc"));
  const r = {
    title: "会议",
    segments: [{ start: 1.25, end: 61.5, text: "这是一段。" }],
  };
  assert.match(exportText(r, "srt"), /00:00:01,250 --> 00:01:01,500/);
  assert.match(exportText(r, "md"), /^# 会议/);
  assert.equal(wavHeader(100).readUInt32LE(4), 136);
});
test("无效输入文件进入失败态且没有伪成功文本", async (t) => {
  const e = await fixture(t);
  const file = path.join(e.root, "broken.mp3");
  await fs.writeFile(file, "not audio");
  const id = await e.importFile(file);
  assert.equal(e.get(id).state, "failed");
  assert.equal(e.get(id).segments.length, 0);
  assert.ok(e.get(id).error);
});
test("回听协议支持 Range 与准确长度，拒绝越界请求", async (t) => {
  const e = await fixture(t);
  const id = await e.startLive("audio");
  await e.appendLive(id, Buffer.alloc(32000));
  await e.stopLive(id);
  const { audioResponse } = require("../src/media.cjs");
  let response = await audioResponse(
    e.audioPath(id),
    new Request("https://localhost/audio", {
      headers: { range: "bytes=44-143" },
    }),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Length"), "100");
  assert.equal((await response.arrayBuffer()).byteLength, 100);
  response = await audioResponse(
    e.audioPath(id),
    new Request("https://localhost/audio", {
      headers: { range: "bytes=999999-" },
    }),
  );
  assert.equal(response.status, 416);
});
test("识别故障时继续保存录音，结束后明确失败并允许重试", async (t) => {
  const e = await fixture(t);
  const id = await e.startLive("ASR失效");
  await e.appendLive(id, Buffer.alloc(32000));
  e.active = e.queue.shift();
  await e.finish({ error: "推理异常" });
  assert.equal(e.get(id).state, "recording");
  await e.appendLive(id, Buffer.alloc(16000));
  assert.equal(e.get(id).duration, 1.5);
  await e.stopLive(id);
  assert.equal(e.get(id).state, "failed");
  await e.retry(id);
  assert.equal(e.get(id).asrFailed, false);
});
test("分段覆盖原音频且优先选择低能量位置", async (t) => {
  const e = await fixture(t);
  const id = await e.startLive("分段");
  const b = Buffer.alloc(32000 * 18);
  for (let i = 0; i < b.length; i += 2) b.writeInt16LE(3000, i);
  b.fill(0, 32000 * 14, 32000 * 14.5);
  await fs.writeFile(e.audioPath(id), Buffer.concat([wavHeader(b.length), b]));
  const { planSegments } = require("../src/audio.cjs");
  const segments = await planSegments(e.audioPath(id), 18);
  assert.equal(segments[0].start, 0);
  assert.ok(segments[0].end >= 14 && segments[0].end < 14.5);
  assert.equal(segments[1].start, segments[0].end);
  assert.equal(segments.at(-1).end, 18);
});
test("实时会议分段优先于尚未执行的文件分段", async (t) => {
  const e = await fixture(t);
  const file = await e.startLive("已有文件");
  await e.appendLive(file, Buffer.alloc(32000));
  await e.stopLive(file);
  e.queue[0].live = false;
  const live = await e.startLive("新会议");
  await e.appendLive(live, Buffer.alloc(32000));
  e.ready = true;
  e.child = { stdin: { write: () => {} }, kill: () => {} };
  await e.pump();
  assert.equal(e.active.record, live);
});
test("录制开始时模型加载失败仍能保存后续音频", async (t) => {
  const e = await fixture(t);
  const id = await e.startLive("模型加载失败");
  e.failWorker("模型文件缺失");
  assert.equal(e.get(id).asrFailed, true);
  await e.appendLive(id, Buffer.alloc(32000));
  assert.equal(e.queue.length, 0);
  await e.stopLive(id);
  assert.equal(e.get(id).state, "failed");
  assert.equal((await fs.stat(e.audioPath(id))).size, 32044);
});
test("多文件导入只有一个解码子进程同时运行", async (t) => {
  const e = await fixture(t);
  const runtime = path.join(e.root, "runtime");
  await fs.mkdir(runtime);
  const log = path.join(runtime, "calls");
  await fs.writeFile(
    path.join(runtime, "ffmpeg"),
    `#!/usr/bin/env node\nconst fs=require('fs');const log=${JSON.stringify(log)};fs.appendFileSync(log,'start\\n');setTimeout(()=>{fs.writeFileSync(process.argv.at(-1),Buffer.alloc(32000));fs.appendFileSync(log,'end\\n');},80);`,
    { mode: 0o755 },
  );
  e.runtime = runtime;
  const input = path.join(e.root, "input");
  await fs.writeFile(input, "fixture");
  await Promise.all([e.importFile(input), e.importFile(input)]);
  assert.equal(await fs.readFile(log, "utf8"), "start\nend\nstart\nend\n");
});
