const test = require("node:test");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
test("异常重复输出被拦截，正常重复术语保留", () => {
  execFileSync("python3", [
    "-c",
    `
import sys
sys.path.insert(0,${JSON.stringify(path.resolve("src"))})
from asr_quality import repetitive
assert repetitive("I'm gonna make you "+'a little bit of '*90)
assert repetitive('Oh, '*90)
assert not repetitive('对，对。这个指标需要明天再确认，先记录下来。')
assert not repetitive('1.7B 和 4B 的模型，1.7B 和 4B 都需要测试。')
`,
  ]);
});
