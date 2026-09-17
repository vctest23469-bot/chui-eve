// Audio-only, LGPL build. No external codec libraries or network protocols.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const version = "8.0.1";
const sha256 =
  "05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41";
const flags = [
  "--prefix=/usr/local",
  "--disable-everything",
  "--disable-autodetect",
  "--disable-network",
  "--disable-doc",
  "--disable-debug",
  "--disable-ffplay",
  "--disable-ffprobe",
  "--disable-avdevice",
  "--disable-iconv",
  "--enable-small",
  "--enable-ffmpeg",
  "--enable-protocol=file,pipe",
  "--enable-demuxer=wav,mp3,mov,matroska,flac,ogg,aac,aiff,asf",
  "--enable-decoder=pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_u8,pcm_s8,pcm_alaw,pcm_mulaw,mp3,mp3float,mp3adu,mp3adufloat,aac,flac,opus,vorbis,wmav1,wmav2,wmapro,alac",
  "--enable-parser=aac,mpegaudio,flac,opus,vorbis",
  "--enable-encoder=pcm_s16le",
  "--enable-muxer=pcm_s16le,wav",
  "--enable-filter=aresample,aformat,anull",
];
async function build() {
  const root = path.resolve(__dirname, "..");
  // The compiler records flags in the binary; avoid per-user temporary paths.
  const buildRoot = process.platform === "darwin" ? "/private/tmp" : "/tmp";
  const dir = await fs.mkdtemp(path.join(buildRoot, "chui-ffmpeg-build-"));
  try {
    const archive = path.join(dir, `ffmpeg-${version}.tar.xz`);
    const cached = path.join(root, "dist", `ffmpeg-${version}-source.tar.xz`);
    const cacheValid = await fs.readFile(cached).then(
      (b) => createHash("sha256").update(b).digest("hex") === sha256,
      () => false,
    );
    if (cacheValid) await fs.copyFile(cached, archive);
    else
      execFileSync(
        "curl",
        [
          "-fsSL",
          "--retry",
          "2",
          "--max-time",
          "120",
          `https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz`,
          "-o",
          archive,
        ],
        { stdio: "inherit" },
      );
    if (
      createHash("sha256")
        .update(await fs.readFile(archive))
        .digest("hex") !== sha256
    )
      throw Error("FFmpeg source checksum mismatch");
    execFileSync("tar", ["-xf", archive, "-C", dir]);
    const source = path.join(dir, `ffmpeg-${version}`);
    execFileSync(
      "./configure",
      [...flags, `--extra-cflags=-ffile-prefix-map=${dir}=.`],
      { cwd: source, stdio: "ignore" },
    );
    const log = await fs.open(path.join(dir, "build.log"), "w");
    try {
      execFileSync(
        "make",
        ["-j", String(Math.min(os.availableParallelism(), 8))],
        { cwd: source, stdio: ["ignore", log.fd, log.fd] },
      );
    } finally {
      await log.close();
    }
    const runtime = path.join(root, "runtime"),
      dist = path.join(root, "dist");
    await fs.mkdir(path.join(runtime, "licenses"), { recursive: true });
    await fs.mkdir(dist, { recursive: true });
    await fs.copyFile(
      path.join(source, "ffmpeg"),
      path.join(runtime, "ffmpeg"),
    );
    await fs.chmod(path.join(runtime, "ffmpeg"), 0o755);
    await fs.copyFile(
      path.join(source, "COPYING.LGPLv2.1"),
      path.join(runtime, "licenses/FFmpeg-LICENSE"),
    );
    await fs.rm(path.join(runtime, "licenses/FFmpeg-license.txt"), {
      force: true,
    });
    const notice = `FFmpeg ${version}\nLGPL-2.1-or-later, audio-only executable, unmodified upstream source.\nSource SHA-256: ${sha256}\nSource URL: https://ffmpeg.org/releases/ffmpeg-${version}.tar.xz\nCorresponding source is included as a release attachment.\nBuild: scripts/build-ffmpeg.cjs\nConfigure: ${flags.join(" ")} --extra-cflags=-ffile-prefix-map=<temporary-build-directory>=.\nNo --enable-gpl or --enable-nonfree.\n`;
    await fs.writeFile(path.join(runtime, "licenses/FFmpeg-BUILD.txt"), notice);
    await fs.copyFile(
      archive,
      path.join(dist, `ffmpeg-${version}-source.tar.xz`),
    );
    console.log("FFmpeg LGPL audio runtime built and source archived.");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
if (require.main === module)
  build().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { build, version, sha256 };
