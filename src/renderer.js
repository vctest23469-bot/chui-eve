const $ = (s) => document.querySelector(s),
  api = window.eve;
let state,
  selected = null,
  filter = "all",
  liveId = null,
  audioContext,
  streams = [],
  worklet,
  chunkChain = Promise.resolve(),
  stopping = false,
  flushDone,
  toastTimer,
  startTime = 0;
const labels = {
  waiting: "等待解码",
  recording: "录制中",
  converting: "解码中",
  queued: "等待转写",
  processing: "转写中",
  done: "已完成",
  empty: "未识别到语音",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").style.display = "none"), 6500);
}
async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(
      e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
    );
  }
}
function applyTheme() {
  const saved = localStorage.getItem("theme");
  window.eve
    .appearance(saved === "dark" || saved === "light" ? saved : "system")
    .catch(console.error);
  document.body.classList.toggle(
    "dark",
    saved
      ? saved === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches,
  );
}
$("#theme").onclick = () => {
  localStorage.setItem(
    "theme",
    document.body.classList.contains("dark") ? "light" : "dark",
  );
  applyTheme();
  drawWave();
};
applyTheme();
function receive(s) {
  state = s;
  $("#count").textContent = s.records.length;
  $("#queue-count").textContent = s.engine.pending
    ? `${s.engine.pending} 段待处理`
    : "";
  $("#engine-state").textContent = s.engine.state;
  $("#engine-model").textContent =
    s.settings.backend === "funasr"
      ? "Fun-ASR-Nano 800M · 本地"
      : s.settings.backend.startsWith("mlx")
        ? "Qwen3-ASR 1.7B · MLX GPU"
        : "Qwen3-ASR 0.6B · CPU";
  $("#engine-dot").classList.toggle("ok", s.engine.ready);
  renderList();
  renderDetail();
}
function renderList() {
  const search = $("#search").value.toLowerCase();
  const rows = state.records.filter(
    (r) =>
      (filter === "all" || r.kind === filter) &&
      `${r.title} ${new Date(r.created).toLocaleDateString("zh-CN")} ${r.segments.map((s) => s.text).join(" ")}`
        .toLowerCase()
        .includes(search),
  );
  $("#records").innerHTML = rows.length
    ? rows
        .slice(0, 200)
        .map(
          (r) =>
            `<button class="record-item ${r.id === selected ? "active" : ""}" data-id="${r.id}"><strong>${esc(r.title)}</strong><div class="record-meta"><span>${new Date(r.created).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} · ${clock(r.duration)}</span><span class="badge ${r.state}">${labels[r.state]}</span></div><div class="record-preview">${esc(
              r.error ||
                r.segments
                  .map((s) => s.text)
                  .join(" ")
                  .slice(0, 100) ||
                (r.kind === "live" ? "会议录音" : "导入音频"),
            )}</div></button>`,
        )
        .join("")
    : '<div class="empty-list">' +
      (search ? "没有匹配的记录" : "还没有记录<br>从一段声音开始") +
      "</div>";
  $("#records")
    .querySelectorAll("button")
    .forEach((b) => (b.onclick = () => choose(b.dataset.id)));
}
function choose(id) {
  selected = id;
  $(".shell").classList.add("has-detail");
  renderList();
  renderDetail();
}
function renderDetail() {
  const r = state.records.find((r) => r.id === selected);
  if (!r) return;
  const main = $("#detail");
  if (main.dataset.id !== r.id) {
    main.dataset.id = r.id;
    main.innerHTML = `<div class="detail-head"><div class="detail-kicker"><button class="back">← 返回</button><span>${r.kind === "live" ? "会议记录" : "音频转写"}</span><span class="badge" id="detail-state"></span></div><input class="detail-title" aria-label="记录标题" maxlength="200"><div class="detail-sub" id="detail-sub"></div><div class="toolbar"><button id="retry">↻ 重新转写</button><button id="cancel" class="danger">取消任务</button><button id="copy">复制全文</button><button id="summary" class="insights-first" title="通过 Codex CLI 调用 GPT-5.5 提炼转写文字">✦ 提炼摘要</button><button id="mindmap" title="生成并查看思维导图">⌘ 思维导图</button><select id="export-format" class="export" aria-label="导出格式"><option value="txt">TXT 文本</option><option value="md">Markdown</option><option value="srt">SRT 字幕</option><option value="json">JSON</option></select><button id="export">导出 ↗</button><button id="remove" aria-label="移入应用废纸篓" title="移入应用废纸篓">⌫</button></div><div class="progress-line"><div id="progress"></div></div></div><div class="audio-wrap"><audio id="playback" controls preload="metadata"></audio></div><div id="result-tabs" class="result-tabs" role="tablist" aria-label="记录视图" hidden><button role="tab" data-insights-view="transcript">转写正文</button><button role="tab" data-insights-view="summary">摘要</button><button role="tab" data-insights-view="map">思维导图</button></div><section id="insights-panel" hidden><div class="insights-tools"><span id="insights-status" role="status"></span><button id="insights-cancel" hidden>取消生成</button><button id="insights-regenerate">重新提炼</button><button id="insights-copy">复制</button><button id="insights-export">导出 MD ↗</button></div><div id="map-controls" hidden><button id="map-minus" aria-label="缩小导图">−</button><button id="map-reset" title="恢复原始大小">100%</button><button id="map-plus" aria-label="放大导图">＋</button><button id="map-expand">展开全部</button><button id="map-collapse">收起全部</button><button id="map-fullscreen" title="全屏查看思维导图">⛶ 全屏查看</button></div><div id="insights-content"></div></section><article class="transcript"><div class="transcript-label"><span>转写正文</span><span>点击时间回听 · 点击文字编辑</span></div><div id="notice"></div><div id="segments"></div></article><footer class="detail-footer"><span id="segment-count"></span><span>音频分段时间戳</span></footer>`;
    window.chuiInsights.bind();
    $(".detail-title").value = r.title;
    $(".detail-title").onchange = (e) =>
      safe(() => api.edit(r.id, { title: e.target.value }));
    $(".back").onclick = () => $(".shell").classList.remove("has-detail");
    $("#retry").onclick = () => safe(() => api.retry(r.id));
    $("#cancel").onclick = () => safe(() => api.cancel(r.id));
    $("#copy").onclick = () =>
      safe(async () => {
        await navigator.clipboard.writeText(
          state.records
            .find((x) => x.id === r.id)
            .segments.map((s) => s.text)
            .join("\n\n"),
        );
        toast("已复制转写正文");
      });
    $("#export").onclick = () =>
      safe(() => api.export(r.id, $("#export-format").value));
    $("#remove").onclick = () =>
      safe(async () => {
        await api.remove(r.id);
        if (!state.records.some((x) => x.id === r.id)) location.reload();
      });
  }
  window.chuiInsights.render(r);
  $("#detail-state").textContent = labels[r.state];
  $("#detail-state").className = "badge " + r.state;
  $("#detail-sub").textContent =
    `${new Date(r.created).toLocaleString("zh-CN")}  ·  ${clock(r.duration)}  ·  ${r.model}`;
  const pending = [
    "recording",
    "processing",
    "queued",
    "converting",
    "waiting",
  ].includes(r.state);
  $("#retry").hidden = pending || !r.duration;
  $("#cancel").hidden = !pending || r.state === "recording";
  $("#remove").disabled = pending;
  $("#export").disabled = !r.segments.length;
  $("#copy").disabled = !r.segments.length;
  $("#progress").style.width =
    (r.duration ? Math.min(100, (r.processed / r.duration) * 100) : 0) + "%";
  $("#segment-count").textContent =
    `${r.segments.length} 段文字 · ${Math.round(r.duration ? (100 * r.processed) / r.duration : 0)}% 已处理`;
  if (
    !["recording", "converting", "waiting"].includes(r.state) &&
    !$("#playback").getAttribute("src")
  )
    $("#playback").src = `chui-audio://${r.id}/audio.wav`;
  let notice =
    r.error ||
    {
      waiting: "等待前一个文件解码，音频导入按顺序处理。",
      recording: "正在录制，语音分段完成后会显示在这里。",
      converting: "正在转换音频格式，你可以继续使用界面。",
      queued: "已加入队列，会议实时转写优先。",
      processing: "后台转写中，已完成的文字会逐段保存。",
      empty:
        "处理完成，但没有识别到有效语音。请回听音频检查音量，或切换模型后重试。",
      cancelled: "任务已取消，已保存的音频与文字仍然保留。",
    }[r.state] ||
    "";
  $("#notice").innerHTML = notice
    ? `<div class="notice ${r.error ? "error" : ""}">${esc(notice)}</div>`
    : "";
  const container = $("#segments");
  if (container.children.length > r.segments.length)
    container.replaceChildren();
  r.segments.forEach((s, i) => {
    let row = container.children[i];
    if (!row) {
      row = document.createElement("div");
      row.className = "segment";
      const b = document.createElement("button");
      b.textContent = clock(s.start);
      b.title = "从此处回听";
      b.onclick = () =>
        safe(async () => {
          const p = $("#playback");
          if (!p.src) {
            toast("结束录制后可回听");
            return;
          }
          p.currentTime = s.start;
          await p.play().catch((e) => {
            if (e.name !== "AbortError") throw e;
          });
        });
      const p = document.createElement("p");
      p.contentEditable = "true";
      p.setAttribute("role", "textbox");
      p.setAttribute("aria-label", `第 ${i + 1} 段转写`);
      p.spellcheck = false;
      p.onblur = () => {
        if (
          p.textContent !==
          state.records.find((x) => x.id === r.id).segments[i]?.text
        )
          safe(() => api.edit(r.id, { segment: i, text: p.textContent }));
      };
      row.append(b, p);
      container.append(row);
    }
    if (
      document.activeElement !== row.children[1] &&
      row.children[1].textContent !== s.text
    )
      row.children[1].textContent = s.text;
  });
}
$("#search").oninput = () => renderList();
document.querySelectorAll("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((x) => x.classList.toggle("selected", x === b));
      renderList();
    }),
);
$("#all").onclick = () => {
  filter = "all";
  $("#search").value = "";
  document.querySelector("[data-filter=all]").click();
  $(".shell").classList.remove("has-detail");
};
async function importFiles() {
  await safe(() => api.import());
}
$("#import").onclick = importFiles;
$("#empty-import").onclick = importFiles;
$("#open-folder").onclick = () => safe(() => api.folder());
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#drop-overlay").style.display = "grid";
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) $("#drop-overlay").style.display = "none";
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").style.display = "none";
  safe(() => api.drop(e.dataTransfer.files));
});
$("#open-settings").onclick = () =>
  safe(async () => {
    const avail = await api.availability();
    document.querySelectorAll("[name=backend]").forEach((x) => {
      x.checked = x.value === state.settings.backend;
      x.disabled = !avail[x.value];
    });
    $("#settings-status").textContent =
      avail.mlx && avail["mlx-bf16"]
        ? ""
        : "未安装或文件缺失的模型不可选；请使用当前可用引擎。";
    $("#asr-hotwords").value = state.settings.hotwords || "";
    $("#asr-hotwords").disabled = !state.settings.backend.startsWith("mlx");
    $("#asr-language").value = state.settings.language || "";
    $("#settings-dialog").showModal();
  });
document.querySelectorAll("[name=backend]").forEach((x) =>
  x.addEventListener("change", () => {
    $("#asr-hotwords").disabled = !$(
      "[name=backend]:checked",
    )?.value.startsWith("mlx");
  }),
);
$("#close-settings").onclick = () => $("#settings-dialog").close();
$("#save-settings").onclick = () =>
  safe(async () => {
    const backend = $("[name=backend]:checked").value;
    await api.settings({
      backend,
      hotwords: $("#asr-hotwords").value,
      language: $("#asr-language").value,
    });
    $("#settings-dialog").close();
    toast("模型正在后台加载");
  });
async function devices() {
  const list = await navigator.mediaDevices.enumerateDevices();
  const selectedDevice = $("#device").value;
  $("#device").innerHTML =
    '<option value="">系统默认麦克风</option>' +
    list
      .filter((d) => d.kind === "audioinput" && d.deviceId !== "default")
      .map(
        (d, i) =>
          `<option value="${esc(d.deviceId)}">${esc(d.label || "麦克风 " + (i + 1))}</option>`,
      )
      .join("");
  $("#device").value = selectedDevice;
  updateDeviceLabel();
}
function updateDeviceLabel() {
  const track = streams?.[0]?.getAudioTracks()[0];
  const label =
    track?.label ||
    $("#device").selectedOptions[0]?.textContent ||
    "系统默认麦克风";
  $("#monitor-device").textContent =
    label + (liveId && streams.length > 1 ? " + 电脑声音" : "");
  $("#monitor-device").title = $("#monitor-device").textContent;
}
$("#device").addEventListener("change", updateDeviceLabel);
function updateMonitor(level, speaking) {
  $("#monitor-db").textContent =
    level == null
      ? "— dB"
      : Math.max(-80, 20 * Math.log10(Math.max(level, 0.0001))).toFixed(1) +
        " dB";
  $("#monitor-speech").textContent =
    level == null ? "未录制" : speaking ? "有说话声" : "无说话声";
  $("#monitor-speech-dot").classList.toggle("ok", level != null && speaking);
}
navigator.mediaDevices.addEventListener("devicechange", () => devices());
devices().catch(() => {});
let levels = Array(64).fill(0);
function drawWave() {
  const canvas = $("#wave"),
    ctx = canvas.getContext("2d"),
    w = canvas.clientWidth,
    h = 90;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted");
  const gap = w / levels.length;
  levels.forEach((level, i) => {
    const bh = Math.max(4, Math.min(64, Math.sqrt(level) * 155));
    ctx.beginPath();
    ctx.roundRect(
      i * gap,
      (h - bh) / 2,
      Math.max(1.5, gap * 0.6),
      bh,
      gap * 0.3,
    );
    ctx.fill();
  });
}
drawWave();
window.addEventListener("resize", drawWave);
async function begin() {
  let id;
  try {
    $("#record").disabled = true;
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: $("#device").value
          ? { exact: $("#device").value }
          : undefined,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    streams = [mic];
    updateDeviceLabel();
    if ($("#system-audio").checked) {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      if (!display.getAudioTracks().length) {
        display.getTracks().forEach((t) => t.stop());
        throw Error(
          "没有取得系统音频，请检查 macOS 屏幕与系统音频录制权限，或取消该选项",
        );
      }
      streams.push(display);
    }
    id = await api.start(
      $("#meeting-title").value ||
        `会议 · ${new Date().toLocaleString("zh-CN")}`,
    );
    liveId = id;
    startTime = Date.now();
    stopping = false;
    chunkChain = Promise.resolve();
    audioContext = new AudioContext({ sampleRate: 16000 });
    if (audioContext.sampleRate !== 16000)
      throw Error("当前设备不支持 16 kHz 音频处理");
    await audioContext.audioWorklet.addModule("capture-worklet.js");
    worklet = new AudioWorkletNode(audioContext, "chui-capture");
    const mute = audioContext.createGain();
    mute.gain.value = 0;
    worklet.connect(mute).connect(audioContext.destination);
    streams.forEach((stream) => {
      const audioOnly = new MediaStream(stream.getAudioTracks());
      audioContext.createMediaStreamSource(audioOnly).connect(worklet);
      stream.getTracks().forEach(
        (t) =>
          (t.onended = () => {
            if (liveId && !stopping) {
              toast("音频来源已断开，正在保存录音");
              end();
            }
          }),
      );
    });
    worklet.port.onmessage = (e) => {
      if (e.data.pcm) {
        const current = liveId;
        chunkChain = chunkChain
          .then(() => api.chunk(current, e.data.pcm))
          .catch((err) => {
            toast("录音保存失败：" + err.message);
            if (!stopping) end();
          });
      }
      if (e.data.level !== undefined) {
        updateMonitor(e.data.level, e.data.speaking);
        levels.shift();
        levels.push(e.data.level);
        drawWave();
      }
      if (e.data.flushed) flushDone?.();
    };
    await audioContext.resume();
    choose(id);
    $("#record").innerHTML = "■ 结束并保存";
    $("#record").classList.add("stop");
    $("#live-status").innerHTML = '<i class="dot live"></i>正在录制';
    $("#device").disabled = true;
    $("#system-audio").disabled = true;
    await devices();
  } catch (e) {
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await audioContext?.close();
    audioContext = null;
    liveId = null;
    streams = [];
    updateMonitor(null, false);
    updateDeviceLabel();
    if (id) await api.stop(id);
    toast(e.message);
  } finally {
    $("#record").disabled = false;
  }
}
async function end() {
  if (!liveId || stopping) return;
  stopping = true;
  $("#record").disabled = true;
  const id = liveId;
  try {
    if (worklet)
      await Promise.race([
        new Promise((resolve) => {
          flushDone = resolve;
          worklet.port.postMessage("flush");
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("音频尾段保存超时")), 3000),
        ),
      ]);
    await chunkChain;
    await api.stop(id);
  } catch (e) {
    toast(e.message);
  } finally {
    liveId = null;
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams = [];
    await audioContext?.close();
    audioContext = null;
    worklet = null;
    $("#record").innerHTML = "<span>●</span> 开始会议";
    $("#record").classList.remove("stop");
    $("#record").disabled = false;
    $("#live-status").innerHTML = '<i class="dot"></i>准备就绪';
    $("#device").disabled = false;
    $("#system-audio").disabled = false;
    updateMonitor(null, false);
    updateDeviceLabel();
    levels = Array(64).fill(0);
    drawWave();
    stopping = false;
  }
}
$("#record").onclick = () => (liveId ? end() : begin());
setInterval(() => {
  if (liveId) $("#timer").textContent = clock((Date.now() - startTime) / 1000);
}, 500);
api.onState(receive);
api
  .state()
  .then(receive)
  .catch((e) => toast(e.message));

api.onShutdown(() => end());
