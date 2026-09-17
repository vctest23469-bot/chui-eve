const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const registrar =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
function unregister(app) {
  try {
    execFileSync(registrar, ["-u", app]);
  } catch {}
}
(async () => {
  const source = path.resolve("dist/Chui Eve-darwin-arm64/Chui Eve.app");
  const target = "/Applications/Chui Eve.app";
  const stage = "/Applications/.Chui Eve-install/Chui Eve.app";
  await fs.access(source);
  await fs.mkdir(path.dirname(stage), { recursive: true });
  await fs.cp(source, stage, { recursive: true, verbatimSymlinks: true });
  // Fail closed: a missing persistent identity must never fall back to ad-hoc.
  const signing = require("./signing/sign.cjs").sign(stage);
  try {
    await fs.access(target);
    try {
      execFileSync(
        "codesign",
        [
          "--verify",
          "-R",
          `=identifier "local.chui.eve" and certificate leaf = H"${signing.identity}"`,
          target,
        ],
        { stdio: "pipe" },
      );
    } catch {
      if (process.env.CHUI_ALLOW_SIGNING_MIGRATION !== "1")
        throw Error(
          "安装版本与固定签名身份不一致，已停止升级。首次签名迁移需显式指定 CHUI_ALLOW_SIGNING_MIGRATION=1。",
        );
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  const backup = path.join(
    os.homedir(),
    "Library/Application Support/Chui Eve/backups",
    `${Date.now()}.zip`,
  );
  let hadTarget = false;
  try {
    await fs.access(target);
    hadTarget = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (hadTarget) {
    await fs.mkdir(path.dirname(backup), { recursive: true });
    execFileSync("/usr/bin/ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      target,
      backup,
    ]);
    execFileSync("/usr/bin/unzip", ["-tq", backup], { stdio: "ignore" });
    unregister(target);
    await fs.rm(target, { recursive: true });
  }
  try {
    await fs.rename(stage, target);
  } catch (e) {
    if (hadTarget)
      execFileSync("/usr/bin/ditto", ["-x", "-k", backup, "/Applications"]);
    throw e;
  }
  await fs.rmdir(path.dirname(stage));
  execFileSync(registrar, ["-f", target]);
  // Keep a distributable archive, not another launchable application bundle.
  const archive = path.resolve("dist/Chui Eve-arm64.zip");
  execFileSync("/usr/bin/ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    target,
    archive,
  ]);
  execFileSync("/usr/bin/unzip", ["-tq", archive], { stdio: "ignore" });
  unregister(source);
  await fs.rm(source, { recursive: true });
  console.log(`Installed ${target}; rollback archive: ${backup}`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
