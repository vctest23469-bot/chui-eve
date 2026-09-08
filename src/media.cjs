const fs = require("node:fs/promises"),
  { createReadStream } = require("node:fs"),
  { Readable } = require("node:stream");
async function audioResponse(file, request) {
  const { size } = await fs.stat(file);
  const headers = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  let start = 0,
    end = size - 1,
    status = 200;
  const range = request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    if (!m[1]) start = Math.max(0, size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(size - 1, Number(m[2]));
    }
    if (start >= size || start > end)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  return new Response(
    request.method === "HEAD"
      ? null
      : Readable.toWeb(createReadStream(file, { start, end })),
    { status, headers },
  );
}
module.exports = { audioResponse };
