const fs = require("node:fs/promises");
function wavHeader(bytes) {
  const b = Buffer.alloc(44);
  b.write("RIFF");
  b.writeUInt32LE(bytes + 36, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
async function fixWav(path) {
  const h = await fs.open(path, "r+");
  try {
    const size = (await h.stat()).size - 44;
    if (size < 0 || size > 0xffffffff - 36)
      throw Error("音频超过 WAV 大小限制");
    await h.write(wavHeader(size), 0, 44, 0);
  } finally {
    await h.close();
  }
}
function stamp(seconds, sep = ",") {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
}
function exportText(record, format) {
  if (format === "json") return JSON.stringify(record, null, 2);
  if (format === "srt")
    return record.segments
      .filter((s) => s.text)
      .map(
        (s, i) =>
          `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}\n`,
      )
      .join("\n");
  return `${format === "md" ? "# " : ""}${record.title}\n\n${record.segments.map((s) => `[${stamp(s.start).slice(0, 8)}] ${s.text}`).join("\n\n")}`;
}
async function planSegments(file, duration) {
  const handle = await fs.open(file, "r"),
    segments = [];
  try {
    let start = 0;
    while (start < duration) {
      let end = Math.min(start + 15, duration);
      if (end < duration) {
        const scanStart = end - 2,
          buf = Buffer.alloc(64000);
        const { bytesRead } = await handle.read(
          buf,
          0,
          buf.length,
          44 + Math.round(scanStart * 16000) * 2,
        );
        let best = Infinity,
          cut = bytesRead;
        for (let offset = 0; offset + 640 <= bytesRead; offset += 640) {
          let energy = 0;
          for (let k = offset; k < offset + 640; k += 2) {
            const v = buf.readInt16LE(k);
            energy += v * v;
          }
          if (energy < best) {
            best = energy;
            cut = offset + 320;
          }
        }
        end = scanStart + cut / 32000;
      }
      segments.push({ start, end });
      start = end;
    }
  } finally {
    await handle.close();
  }
  return segments;
}
module.exports = { wavHeader, fixWav, stamp, exportText, planSegments };
