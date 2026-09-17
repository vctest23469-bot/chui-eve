// Normalize upstream diagnostic build prefixes without changing string lengths.
// Remove unused absolute build rpaths before editing. Sign only after this step.
const fs = require("node:fs/promises"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
async function sanitizeNative(root) {
  let count = 0;
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!entry.isFile()) continue;
      let bytes = await fs.readFile(file);
      if (
        bytes.length < 4 ||
        ![0xfeedfacf, 0xfeedface, 0xcafebabe, 0xbebafeca].includes(
          bytes.readUInt32LE(0),
        )
      )
        continue;
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), "chui-native-"));
      const working = path.join(temp, "binary");
      await fs.copyFile(file, working);
      try {
        const commands = execFileSync("otool", ["-l", working], {
          encoding: "utf8",
        });
        for (const match of commands.matchAll(
          /cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset/g,
        )) {
          if (/^\/(Users|home)\//.test(match[1])) {
            if (!commands.includes("path @loader_path "))
              throw Error(
                "Native binary has an absolute build dependency; refusing to package",
              );
            execFileSync(
              "install_name_tool",
              ["-delete_rpath", match[1], working],
              { stdio: "ignore" },
            );
          }
        }
        execFileSync("strip", ["-S", working], { stdio: "ignore" });
        bytes = await fs.readFile(working);
        const text = bytes.toString("latin1");
        let changed = false;
        for (const m of text.matchAll(/\/(?:Users|home)\/[^/\s"'<>\x00]+/g)) {
          const replacement = "/build/" + "_".repeat(m[0].length - 7);
          bytes.write(replacement, m.index, m[0].length, "latin1");
          changed = true;
          count++;
        }
        await fs.writeFile(file, bytes);
        execFileSync(
          "codesign",
          ["--force", "--sign", "-", "--timestamp=none", file],
          { stdio: "ignore" },
        );
        execFileSync("codesign", ["--verify", "--strict", file], {
          stdio: "ignore",
        });
      } finally {
        await fs.rm(temp, { recursive: true, force: true });
      }
    }
  }
  await walk(root);
  console.log(`Normalized ${count} upstream diagnostic build prefixes.`);
}
module.exports = { sanitizeNative };
