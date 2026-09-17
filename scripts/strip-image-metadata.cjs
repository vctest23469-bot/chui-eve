// Keep pixel/color chunks; discard text, EXIF and embedded workflow metadata.
const fs = require("node:fs/promises");
async function strip(file) {
  const b = await fs.readFile(file);
  if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw Error("Expected PNG");
  const pieces = [b.subarray(0, 8)];
  const keep = new Set([
    "IHDR",
    "PLTE",
    "IDAT",
    "IEND",
    "tRNS",
    "sRGB",
    "gAMA",
    "cHRM",
  ]);
  for (let i = 8; i < b.length;) {
    const size = b.readUInt32BE(i),
      end = i + size + 12;
    if (end > b.length) throw Error("Invalid PNG chunk");
    if (keep.has(b.subarray(i + 4, i + 8).toString("ascii")))
      pieces.push(b.subarray(i, end));
    i = end;
  }
  await fs.writeFile(file, Buffer.concat(pieces));
}
if (require.main === module)
  Promise.all(process.argv.slice(2).map(strip)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { strip };
