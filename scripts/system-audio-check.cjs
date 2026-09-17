const { _electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-system-check-"));
  const app = await _electron.launch({
    executablePath: "/Applications/Chui Eve.app/Contents/MacOS/Chui Eve",
    args: [
      ...(process.env.CHUI_REAL_PROFILE
        ? []
        : [`--user-data-dir=${root}/profile`]),
      ...(process.env.CHUI_CAPTURE_FLAGS
        ? [process.env.CHUI_CAPTURE_FLAGS]
        : []),
    ],
    env: { ...process.env, CHUI_DATA_DIR: root },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    console.log(
      await app.evaluate(({ systemPreferences, app }) => ({
        argv: process.argv,
        command: app.commandLine.hasSwitch("no-sandbox"),
        screen: systemPreferences.getMediaAccessStatus("screen"),
        version: app.getVersion(),
        features: app.commandLine.getSwitchValue("disable-features"),
      })),
    );
    const result = await page.evaluate(async () => {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        const s = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
        const tracks = s
          .getTracks()
          .map((t) => ({
            kind: t.kind,
            state: t.readyState,
            settings: t.getSettings(),
          }));
        s.getTracks().forEach((t) => t.stop());
        mic.getTracks().forEach((t) => t.stop());
        return { tracks };
      } catch (e) {
        return { error: e.message, name: e.name };
      }
    });
    console.log(JSON.stringify(result));
    if (result.error || !result.tracks.some((t) => t.kind === "audio"))
      process.exitCode = 1;
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
