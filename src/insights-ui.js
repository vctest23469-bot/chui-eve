/* Results are rendered as text nodes; model output is never executable markup. */
(() => {
  const views = new Map(),
    collapsed = new Map();
  let current,
    signature = "",
    zoom = 1;
  const $ = (s) => document.querySelector(s);
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const fail = (e) => {
    const status = $("#insights-status");
    if (status)
      status.textContent = e.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      );
  };
  function show(view) {
    if (!current) return;
    views.set(current.id, view);
    signature = "";
    render(current);
  }
  async function generate(view, force = false) {
    show(view);
    try {
      await window.eve.insights(current.id, force);
    } catch (e) {
      fail(e);
    }
  }
  async function fullscreen(active) {
    await window.eve["map-fullscreen"](active);
    document.body.classList.toggle("map-presentation", active);
    const button = $("#map-fullscreen");
    if (button) {
      button.textContent = active ? "⛶ 退出全屏 · Esc" : "⛶ 全屏查看";
      button.setAttribute("aria-pressed", String(active));
      button.title = active ? "退出全屏（Esc）" : "全屏查看思维导图";
      button.focus({ preventScroll: true });
    }
  }
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      document.body.classList.contains("map-presentation")
    ) {
      event.preventDefault();
      fullscreen(false).catch(fail);
    }
  });
  function bind() {
    $("#map-fullscreen").onclick = () =>
      fullscreen(!document.body.classList.contains("map-presentation")).catch(
        fail,
      );
    $("#summary").onclick = () => generate("summary");
    $("#mindmap").onclick = () => generate("map");
    document
      .querySelectorAll("[data-insights-view]")
      .forEach((b) => (b.onclick = () => show(b.dataset.insightsView)));
    $("#insights-regenerate").onclick = () =>
      generate(views.get(current.id) || "summary", true);
    $("#insights-cancel").onclick = () =>
      window.eve["insights-cancel"](current.id).catch(fail);
    $("#insights-copy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(
          await window.eve["insights-text"](current.id),
        );
        $("#insights-status").textContent = "已复制摘要与导图大纲";
      } catch (e) {
        fail(e);
      }
    };
    $("#insights-export").onclick = () =>
      window.eve["insights-export"](current.id).catch(fail);
    $("#map-expand").onclick = () => {
      current.insights.result.topics.forEach((_, i) =>
        collapsed.set(current.id + ":" + i, false),
      );
      signature = "";
      render(current);
    };
    $("#map-collapse").onclick = () => {
      current.insights.result.topics.forEach((_, i) =>
        collapsed.set(current.id + ":" + i, true),
      );
      signature = "";
      render(current);
    };
    $("#map-plus").onclick = () => setZoom(0.1);
    $("#map-minus").onclick = () => setZoom(-0.1);
    $("#map-reset").onclick = () => {
      zoom = 1;
      setZoom(0);
    };
  }
  function setZoom(delta) {
    zoom = Math.max(0.5, Math.min(1.5, zoom + delta));
    const map = $(".mindmap-tree");
    if (map) map.style.zoom = zoom;
    $("#map-reset").textContent = Math.round(zoom * 100) + "%";
  }
  function render(r) {
    current = r;
    const v = r.insights,
      view = views.get(r.id) || "transcript";
    const busy = v?.status === "running";
    const unavailable =
      !r.segments.some((s) => s.text.trim()) ||
      ["recording", "processing", "queued", "converting", "waiting"].includes(
        r.state,
      );
    $("#summary").disabled = unavailable;
    $("#mindmap").disabled = unavailable;
    $("#summary").classList.toggle("insights-active", view === "summary");
    $("#mindmap").classList.toggle("insights-active", view === "map");
    $("#result-tabs").hidden = !v && view === "transcript";
    document.querySelectorAll("[data-insights-view]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.insightsView === view);
      b.setAttribute("aria-selected", String(b.dataset.insightsView === view));
    });
    $(".transcript").hidden = view !== "transcript";
    $("#insights-panel").hidden = view === "transcript";
    if (view === "transcript") return;
    $("#insights-status").textContent = busy
      ? v.progress
      : v?.error ||
        (v?.stale
          ? "原文已修改，当前结果需要重新提炼。"
          : v?.result
            ? "已保存 · GPT-5.5 云端提炼 · 请结合原文核对"
            : "将转写文字提交至 GPT-5.5，生成摘要与思维导图。");
    $("#insights-regenerate").disabled = busy || unavailable;
    $("#insights-cancel").hidden = !busy;
    $("#insights-copy").disabled = !v?.result;
    $("#insights-export").disabled = !v?.result;
    $("#map-controls").hidden = view !== "map" || !v?.result;
    const key = r.id + r.title + view + v?.status + JSON.stringify(v?.result);
    if (signature === key) return;
    signature = key;
    const body = $("#insights-content");
    body.replaceChildren();
    if (!v?.result) {
      body.append(
        node(
          "p",
          busy
            ? "正在整理主题、关键观点与行动项，你可以继续查看其他记录。"
            : "点击“重新提炼”开始生成。",
          "insights-placeholder",
        ),
      );
      return;
    }
    const result = v.result;
    if (view === "summary") {
      body.append(
        node("h2", "摘要"),
        node("p", result.summary, "summary-lead"),
      );
      for (const t of result.topics) {
        const section = node("section", undefined, "summary-topic");
        section.append(node("h3", t.title));
        const list = node("ul");
        t.points.forEach((p) => list.append(node("li", p)));
        section.append(list);
        body.append(section);
      }
      body.append(node("h3", "明确行动项"));
      if (result.actions.length) {
        const list = node("ul");
        result.actions.forEach((a) => list.append(node("li", a)));
        body.append(list);
      } else body.append(node("p", "原文未明确行动项。", "muted"));
    } else {
      body.append(
        node("p", "点击主题展开 / 收起 · 可横向滚动与缩放", "map-hint"),
      );
      const tree = node("div", undefined, "mindmap-tree");
      tree.setAttribute("role", "tree");
      tree.append(node("div", r.title, "map-root"));
      const branches = node("div", undefined, "map-branches");
      result.topics.forEach((t, i) => {
        const branch = node("div", undefined, "map-branch");
        const key = r.id + ":" + i;
        if (!collapsed.has(key)) collapsed.set(key, true);
        const title = node("button", t.title, "map-topic");
        title.setAttribute("aria-expanded", String(!collapsed.get(key)));
        const leaves = node("div", undefined, "map-leaves");
        leaves.hidden = !!collapsed.get(key);
        for (const p of t.points) leaves.append(node("div", p, "map-leaf"));
        title.onclick = () => {
          collapsed.set(key, !collapsed.get(key));
          leaves.hidden = !!collapsed.get(key);
          title.setAttribute("aria-expanded", String(!collapsed.get(key)));
        };
        branch.append(title, leaves);
        branches.append(branch);
      });
      tree.append(branches);
      body.append(tree);
      setZoom(0);
    }
  }
  window.chuiInsights = { bind, render };
})();
