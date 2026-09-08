const path = require("node:path");
(async () => {
  const { packager } = await import("@electron/packager");
  const paths = await packager({
    dir: ".",
    out: "dist",
    name: "Chui Eve",
    platform: "darwin",
    arch: "arm64",
    appBundleId: "local.chui.eve",
    appVersion: require("../package.json").version,
    icon: path.resolve("src/icon.icns"),
    overwrite: true,
    asar: false,
    prune: true,
    ignore: [
      /^\/runtime/,
      /^\/artifacts/,
      /^\/tests/,
      /^\/scripts/,
      /^\/output/,
      /^\/dist/,
      /^\/\.git/,
    ],
    extraResource: [path.resolve("runtime")],
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Chui Eve 需要麦克风来录制会议并在本机转写。",
      NSAudioCaptureUsageDescription:
        "Chui Eve 需要录制电脑声音以转写线上会议。",
      NSScreenCaptureUsageDescription: "Chui Eve 需要获取会议软件的系统音频。",
    },
    osxSign: false,
  });
  console.log(paths);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
