const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chui-theme-"));
  const app = await electron.launch({
    args: ["--user-data-dir=" + path.join(root, "profile"), "."],
    env: { ...process.env, CHUI_DATA_DIR: path.join(root, "library") },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector(".brand-icon");
    await page.evaluate(() => {
      localStorage.setItem("theme", "light");
      applyTheme();
    });
    await page.waitForSelector(".brand-icon");
    await page.screenshot({ path: "artifacts/theme-light.png" });
    const light = await app.evaluate(
      ({ nativeTheme }) => nativeTheme.themeSource,
    );
    const icon = await page
      .locator(".brand-icon")
      .evaluate((i) => i.complete && i.naturalWidth > 0);
    await page.locator("#theme").click();
    await page.waitForFunction(() => document.body.classList.contains("dark"));
    await page.screenshot({ path: "artifacts/theme-dark.png" });
    const dark = await app.evaluate(
      ({ nativeTheme }) => nativeTheme.themeSource,
    );
    await page.locator("#open-settings").click();
    await page.screenshot({ path: "artifacts/theme-settings.png" });
    await page.locator("#close-settings").click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(700, 580),
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    await page.screenshot({ path: "artifacts/theme-narrow.png" });
    if (
      !icon ||
      light !== "light" ||
      dark !== "dark" ||
      overflow ||
      errors.length
    )
      throw Error(JSON.stringify({ icon, light, dark, overflow, errors }));
    console.log(JSON.stringify({ icon, light, dark, overflow, errors }));
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
