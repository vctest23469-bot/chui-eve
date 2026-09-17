const fs = require("node:fs/promises"),
  path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { sanitizeNative } = require("./sanitize-native.cjs");
(async () => {
  const root = path.resolve(__dirname, "..");
  const version = require("../package.json").version;
  const stage = path.join(root, "dist/package-input");
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  await fs.cp(path.join(root, "src"), path.join(stage, "src"), {
    recursive: true,
    filter: (p) => !p.includes("__pycache__") && !p.endsWith(".pyc"),
  });
  const pkg = require("../package.json");
  await fs.writeFile(
    path.join(stage, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        productName: pkg.productName,
        version,
        main: pkg.main,
        description: pkg.description,
        private: true,
      },
      null,
      2,
    ),
  );
  const resources = path.join(root, "dist/runtime-input");
  await fs.rm(resources, { recursive: true, force: true });
  await fs.mkdir(resources, { recursive: true });
  for (const name of [
    "node",
    "ffmpeg",
    "sherpa-runtime",
    "silero_vad.onnx",
    "licenses",
  ])
    await fs.cp(path.join(root, "runtime", name), path.join(resources, name), {
      recursive: true,
      verbatimSymlinks: true,
    });
  const check = spawnSync(path.join(resources, "ffmpeg"), ["-buildconf"], {
    encoding: "utf8",
  });
  if (
    check.status !== 0 ||
    /--enable-(nonfree|gpl)/.test(check.stdout + check.stderr)
  )
    throw Error(
      "Non-redistributable FFmpeg runtime; run npm run runtime:ffmpeg first",
    );
  const { packager } = await import("@electron/packager");
  const paths = await packager({
    dir: stage,
    out: path.join(root, "dist"),
    name: "Chui Eve",
    platform: "darwin",
    arch: "arm64",
    appBundleId: "local.chui.eve",
    appVersion: version,
    icon: path.join(root, "src/icon.icns"),
    electronVersion: require("../node_modules/electron/package.json").version,
    overwrite: true,
    asar: false,
    prune: true,
    extraResource: [resources],
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Chui Eve 需要麦克风来录制会议并在本机转写。",
      NSAudioCaptureUsageDescription:
        "Chui Eve 需要录制电脑声音以转写线上会议。",
      NSScreenCaptureUsageDescription: "Chui Eve 需要获取会议软件的系统音频。",
    },
    osxSign: false,
  });
  const app = path.join(paths[0], "Chui Eve.app");
  await fs.rename(
    path.join(app, "Contents/Resources/runtime-input"),
    path.join(app, "Contents/Resources/runtime"),
  );
  await sanitizeNative(app);
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", app],
    { stdio: "ignore" },
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
    stdio: "ignore",
  });
  const fixture = path.join(stage, "native-check.wav");
  await fs.writeFile(
    fixture,
    Buffer.concat([
      require("../src/audio.cjs").wavHeader(32000),
      Buffer.alloc(32000),
    ]),
  );
  const nativeRuntime = path.join(app, "Contents/Resources/runtime");
  const gate = JSON.parse(
    execFileSync(
      path.join(nativeRuntime, "node"),
      [path.join(app, "Contents/Resources/app/src/speech-gate.cjs"), fixture],
      {
        encoding: "utf8",
        env: { ...process.env, CHUI_RUNTIME: nativeRuntime },
        timeout: 20000,
      },
    ),
  );
  if (gate.speech !== false) throw Error("Native VAD smoke check failed");
  const zip = path.join(root, `dist/Chui-Eve-${version}-macOS-arm64.zip`);
  execFileSync("ditto", [
    "-c",
    "-k",
    "--norsrc",
    "--noextattr",
    "--noqtn",
    "--noacl",
    "--keepParent",
    app,
    zip,
  ]);
  execFileSync("unzip", ["-tq", zip], { stdio: "ignore" });
  await fs.rm(stage, { recursive: true, force: true });
  await fs.rm(resources, { recursive: true, force: true });
  console.log(`Packaged Chui Eve ${version}: ${path.basename(zip)}`);
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
