const { chromium } = require("playwright");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
(async () => {
  const browser = await chromium.launch();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chui-icon-"));
  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 1024 },
    });
    await page.setContent(
      `<style>body{margin:0}</style>${await fs.readFile("docs/assets/icon.svg", "utf8")}`,
    );
    await page.screenshot({ path: "src/icon.png", omitBackground: true });
    const iconset = path.join(dir, "Chui.iconset");
    await fs.mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        execFileSync(
          "sips",
          [
            "-z",
            String(size * scale),
            String(size * scale),
            "src/icon.png",
            "--out",
            path.join(
              iconset,
              `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
            ),
          ],
          { stdio: "ignore" },
        );
      }
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", "src/icon.icns"]);
    console.log("Original Chui Eve icon generated.");
  } finally {
    await browser.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
