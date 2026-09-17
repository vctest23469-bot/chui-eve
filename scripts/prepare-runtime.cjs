// Download only public, version-pinned runtime components. No credentials.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
(async () => {
  const root = path.resolve(__dirname, ".."),
    runtime = path.join(root, "runtime");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "chui-runtime-"));
  try {
    await fs.mkdir(path.join(runtime, "licenses"), { recursive: true });
    const nodeVersion = "22.23.2";
    const nodeArchive = path.join(temp, "node.tar.gz");
    execFileSync("curl", [
      "-fsSL",
      "--retry",
      "2",
      "--max-time",
      "120",
      `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-darwin-arm64.tar.gz`,
      "-o",
      nodeArchive,
    ]);
    const nodeChecksum =
      "61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6";
    if (
      createHash("sha256")
        .update(await fs.readFile(nodeArchive))
        .digest("hex") !== nodeChecksum
    )
      throw Error("Node runtime checksum mismatch");
    execFileSync("tar", ["-xf", nodeArchive, "-C", temp]);
    const nodeRoot = path.join(temp, `node-v${nodeVersion}-darwin-arm64`);
    await fs.copyFile(
      path.join(nodeRoot, "bin/node"),
      path.join(runtime, "node"),
    );
    await fs.chmod(path.join(runtime, "node"), 0o755);
    await fs.copyFile(
      path.join(nodeRoot, "LICENSE"),
      path.join(runtime, "licenses/Node-LICENSE"),
    );
    const version = "1.12.34";
    for (const name of ["sherpa-onnx-node", "sherpa-onnx-darwin-arm64"]) {
      const output = JSON.parse(
        execFileSync(
          "npm",
          [
            "pack",
            `${name}@${version}`,
            "--json",
            "--ignore-scripts",
            "--pack-destination",
            temp,
          ],
          { encoding: "utf8" },
        ),
      );
      const unpack = path.join(temp, name);
      await fs.mkdir(unpack);
      execFileSync("tar", [
        "-xf",
        path.join(temp, output[0].filename),
        "-C",
        unpack,
      ]);
      await fs.mkdir(path.join(runtime, "sherpa-runtime"), { recursive: true });
      await fs.cp(
        path.join(unpack, "package"),
        path.join(runtime, "sherpa-runtime", name),
        { recursive: true, force: true },
      );
    }
    const sources = {
      "sherpa-onnx-LICENSE":
        "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v1.12.34/LICENSE",
      "ONNXRuntime-LICENSE":
        "https://raw.githubusercontent.com/microsoft/onnxruntime/v1.23.2/LICENSE",
      "Silero-VAD-LICENSE":
        "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2/LICENSE",
    };
    const licenseChecksums = {
      "sherpa-onnx-LICENSE":
        "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
      "ONNXRuntime-LICENSE":
        "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c",
      "Silero-VAD-LICENSE":
        "2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b",
    };
    for (const [name, url] of Object.entries(sources)) {
      const target = path.join(runtime, "licenses", name);
      const valid = await fs.readFile(target).then(
        (b) =>
          createHash("sha256").update(b).digest("hex") ===
          licenseChecksums[name],
        () => false,
      );
      if (valid) continue;
      execFileSync("curl", [
        "-fsSL",
        "--retry",
        "2",
        "--max-time",
        "60",
        url,
        "-o",
        path.join(temp, name),
      ]);
      if (
        createHash("sha256")
          .update(await fs.readFile(path.join(temp, name)))
          .digest("hex") !== licenseChecksums[name]
      )
        throw Error("Runtime license checksum mismatch");
      await fs.copyFile(path.join(temp, name), target);
    }
    const expected =
      "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6";
    const vad = path.join(runtime, "silero_vad.onnx");
    const valid = await fs.readFile(vad).then(
      (b) => createHash("sha256").update(b).digest("hex") === expected,
      () => false,
    );
    if (!valid) {
      const response = await fetch(
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
        { signal: AbortSignal.timeout(60000) },
      );
      if (!response.ok) throw Error("VAD download failed");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== expected)
        throw Error("VAD checksum mismatch; runtime not ready");
      await fs.writeFile(path.join(temp, "silero_vad.onnx"), bytes);
      await fs.copyFile(path.join(temp, "silero_vad.onnx"), vad);
    }
    await require("./build-ffmpeg.cjs").build();
    console.log("Pinned runtime prepared.");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
