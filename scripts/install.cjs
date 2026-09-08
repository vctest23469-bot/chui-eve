const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  { execFileSync } = require("node:child_process");
(async () => {
  const source = path.resolve("dist/Chui Eve-darwin-arm64/Chui Eve.app"),
    target = "/Applications/Chui Eve.app";
  await fs.access(source);
  try {
    await fs.access(target);
    const backup = path.join(
      os.homedir(),
      "Library/Application Support/Chui Eve/backups",
      String(Date.now()),
      "Chui Eve.app",
    );
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.rename(target, backup);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.cp(source, target, { recursive: true, verbatimSymlinks: true });
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", target], {
    stdio: "inherit",
  });
  execFileSync("codesign", ["--verify", "--deep", target], {
    stdio: "inherit",
  });
  console.log(target);
})();
