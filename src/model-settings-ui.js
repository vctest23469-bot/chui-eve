(() => {
  const $ = (selector) => document.querySelector(selector);
  let clearKey = false;
  let busy = false;
  const toggle = () => {
    const api = $("#insights-mode").value === "api";
    $("#api-fields").hidden = !api;
    $("#codex-note").hidden = api;
  };
  function fill(config) {
    $("#insights-mode").value = config.mode;
    $("#api-base").value = config.baseURL;
    $("#api-model").value = config.model;
    $("#api-key").value = "";
    $("#api-key").placeholder = config.hasKey
      ? "已安全保存，留空保留原密钥"
      : "本机无鉴权服务可留空";
    $("#key-state").textContent = config.hasKey
      ? "已加密保存 · 不显示原密钥"
      : "未保存密钥";
    $("#api-timeout").value = config.timeout;
    $("#api-chunk").value = config.chunkChars;
    $("#api-json").checked = config.jsonMode;
    $("#model-status").textContent = config.error || "";
    clearKey = false;
    toggle();
  }
  $("#open-model-settings").onclick = async () => {
    try {
      fill(await window.eve["model-settings"]());
      $("#model-dialog").showModal();
    } catch {
      $("#toast").textContent = "摘要配置读取失败";
    }
  };
  $("#insights-mode").onchange = toggle;
  $("#close-model-settings").onclick = () => {
    if (!busy) $("#model-dialog").close();
  };
  $("#model-dialog").addEventListener("close", () => {
    $("#api-key").value = "";
  });
  $("#clear-api-key").onclick = () => {
    clearKey = true;
    $("#api-key").value = "";
    $("#key-state").textContent = "保存后清除密钥";
  };
  $("#api-key").oninput = () => {
    if ($("#api-key").value) clearKey = false;
  };
  async function save(test = false) {
    if (busy) return;
    busy = true;
    $("#save-model").disabled = $("#test-model").disabled = true;
    $("#model-status").textContent = test ? "正在保存并测试连接…" : "正在保存…";
    try {
      const config = await window.eve["model-settings-save"]({
        mode: $("#insights-mode").value,
        baseURL: $("#api-base").value,
        model: $("#api-model").value,
        apiKey: $("#api-key").value,
        clearKey,
        jsonMode: $("#api-json").checked,
        timeout: Number($("#api-timeout").value),
        chunkChars: Number($("#api-chunk").value),
      });
      fill(config);
      $("#model-status").textContent = test
        ? await window.eve["model-test"]()
        : "配置已保存，后续提炼使用此服务。";
    } catch (e) {
      $("#model-status").textContent = e.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      );
    } finally {
      busy = false;
      $("#save-model").disabled = $("#test-model").disabled = false;
    }
  }
  $("#save-model").onclick = () => save();
  $("#test-model").onclick = () => save(true);
})();
