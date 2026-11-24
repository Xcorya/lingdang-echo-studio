import { tidy, markdownDoc } from "./core.mjs";
import { BROWSER_MODELS } from "./web-model.mjs";
import { SUPPORTED_FORMATS } from "./avatar.mjs";

const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const field = (
  name,
  label,
  value = "",
  {
    max = 600,
    rows,
    hint = "",
    type = "text",
    placeholder = "",
    required = false,
  } = {},
) => {
  const attributes = `name="${name}" maxlength="${max}"${required ? " required" : ""} placeholder="${e(placeholder)}"`;
  const control = rows
    ? `<textarea ${attributes} rows="${rows}">${e(value)}</textarea>`
    : `<input ${attributes} type="${type}" value="${e(value)}" autocomplete="off">`;
  return `<label class="form-field">${label}${control}${hint ? `<small>${hint}</small>` : ""}</label>`;
};
const button = (label, action, classes = "", attrs = "") =>
  `<button type="button" class="button ${classes}" data-form-action="${action}" ${attrs}>${label}</button>`;
const saveButton = (label) =>
  `<button type="submit" class="button primary">${label}</button>`;
const colors = ["#b4c9b1", "#d4bba9", "#bdc9d9", "#c7bdd9"];
const shapeNames = {
  rabbit: "小兔",
  fox: "狐狸",
  bird: "山雀",
  pebble: "小行星",
};

export function installForms({
  getState,
  client,
  edit,
  avatar,
  go,
  render,
  toast,
  report,
}) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("dialog"),
    form = $("dialog-form");
  let kind = "",
    currentItem = null,
    controller = null,
    busy = false,
    epoch = 0,
    fileMode = "preview";
  function notice(value = "") {
    $("dialog-error").textContent = value;
  }
  function sessionError(error) {
    notice(error?.message || "操作没有完成，请重试。");
  }
  function needAvatar() {
    const scene = avatar();
    if (!scene)
      throw new Error(
        "3D 展示尚未准备好，请稍后重试。若设备不支持 WebGL，请换用桌面浏览器。",
      );
    return scene;
  }
  function setBusy(value) {
    busy = value;
    for (const input of form.querySelectorAll(
      'button[type="submit"], [data-form-action="disconnect"], [data-form-action="clear-avatar"]',
    ))
      input.disabled = value;
    const cancel = form.querySelector('[data-form-action="cancel-model"]');
    if (cancel) cancel.hidden = !value;
  }
  function updateOptions() {
    const provider = form.elements.namedItem("provider")?.value;
    for (const name of ["webgpu", "compatible", "router"]) {
      const group = $(`provider-${name}`);
      if (group) {
        group.hidden = provider !== name;
        for (const input of group.querySelectorAll("input,select"))
          input.disabled = provider !== name;
      }
    }
  }
  function close() {
    controller?.abort();
    dialog.close();
  }

  function open(mode, item) {
    if (busy) {
      toast("当前操作还在进行，请先完成或取消。", true);
      return;
    }
    controller?.abort();
    epoch++;
    kind = mode;
    currentItem = item || null;
    const state = getState(),
      p = state.profile;
    let title,
      kicker = "YOUR SPACE",
      body = "",
      footer = button("取消", "close");
    if (mode === "identity") {
      title = "让 Agent 有自己的立场";
      kicker = "YOUR AGENT";
      body =
        field("name", "Agent 名称", p.name, {
          max: 32,
          required: true,
          placeholder: "想让大家怎么称呼它？",
        }) +
        field("stance", "场内立场", p.stance, {
          max: 600,
          rows: 3,
          placeholder: "它关注什么，如何看待问题？",
          hint: "名字与这段立场会用于房间对话，其他参与者可以看到。",
        }) +
        field("anchor", "身份锚点", p.anchor, {
          max: 1800,
          rows: 3,
          placeholder: "哪些判断原则值得一直保留？",
          hint: "仅私测使用，不会自动放进房间上下文。",
        }) +
        field("bio", "私人背景", p.bio, {
          max: 2400,
          rows: 3,
          placeholder: "你的经历、兴趣，以及希望它理解的背景。",
          hint: "仅私测使用；进行前后对照时会交给你连接的模型。",
        });
      footer += saveButton("保存 Agent");
    } else if (mode === "avatar") {
      title = "你的形象，由你定义";
      kicker = "MAKE IT YOURS";
      const info = avatar()?.getMetadata?.();
      body = `<p class="dialog-copy">选择一个 3D 文件作为你的 Agent 形象。原件留在当前浏览器，不会传到对话服务器。</p>
        <button type="button" class="upload-zone" data-form-action="pick-model"><b>选择模型与配套文件</b><small>可直接预览常见 3D 格式 · 总量 50 MB 以内</small></button>
        <p class="dialog-copy" style="font-size:.72rem">${e(SUPPORTED_FORMATS)}</p>
        <p class="dialog-copy" style="font-size:.72rem;margin-top:12px">专有格式也可以保留原件，再添加 GLB 等通用预览。glTF / OBJ 请同时选择材质、贴图等配套文件；USDZ 仅支持 USDA 场景，压缩 glTF 暂不支持。</p>
        <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:16px">${button("保存 3D 原件", "pick-original", "small")}${info?.uploaded ? button("添加通用预览", "pick-preview", "small") + button("下载原件", "download-original", "small") : ""}</div>
        ${info?.uploaded ? `<p class="inline-warning">已保存：${e(info.name)}${info.previewable === false ? " · 原件已保留，尚无可预览格式" : " · 可在工作台旋转查看"}</p>` : ""}
        <label class="form-field">内置形象<div class="appearance-options">${Object.entries(
          shapeNames,
        )
          .map(
            ([shape, name]) =>
              `<label class="appearance-option${p.appearance?.shape === shape ? " active" : ""}"><input type="radio" name="shape" value="${shape}"${(p.appearance?.shape || "rabbit") === shape ? " checked" : ""}> ${name}</label>`,
          )
          .join("")}</div></label>
        <label class="form-field">形象颜色<div class="appearance-options">${colors.map((color) => `<label class="appearance-option" style="background:${color}33"><input type="radio" name="color" aria-label="${e({ "#b4c9b1": "鼠尾草绿", "#d4bba9": "暖砂棕", "#bdc9d9": "雾霭蓝", "#c7bdd9": "浅紫" }[color])}" value="${color}"${(p.appearance?.color || colors[0]) === color ? " checked" : ""}><span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:middle;background:${color}"></span></label>`).join("")}</div><small>内置形象会使用这个颜色，上传模型保留原材质。</small></label>`;
      footer =
        (info?.uploaded
          ? button("移除上传形象", "clear-avatar", "danger small")
          : "") + button("完成", "close", "primary");
    } else if (mode === "model") {
      title = "选择你的思考方式";
      kicker = "CONNECT A MODEL";
      const existing = client.model;
      const provider = existing?.kind || "router";
      body = `<p class="dialog-copy">每个 Agent 使用自己的模型。Key 只放在当前页面，刷新后清除。</p>
        <label class="form-field">模型连接<select name="provider"><option value="router"${provider === "router" ? " selected" : ""}>OpenRouter · 免费线路</option><option value="webgpu"${provider === "webgpu" ? " selected" : ""}>浏览器模型 · 无需 Key</option><option value="compatible"${provider === "compatible" ? " selected" : ""}>兼容 OpenAI 的接口</option></select></label>
        <div id="provider-router">${field("key", "OpenRouter API Key", "", { type: "password", max: 1000, hint: "使用 openrouter/free；免费线路可能限流。获授权资料会发送给模型服务商。" })}<a class="text-button" href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">获取 OpenRouter Key</a></div>
        <div id="provider-webgpu"><label class="form-field">浏览器模型<select name="browserModel">${Object.entries(
          BROWSER_MODELS,
        )
          .map(
            ([id, label]) =>
              `<option value="${e(id)}"${existing?.id === id ? " selected" : ""}>${e(label)}</option>`,
          )
          .join(
            "",
          )}</select><small>在本机 WebGPU 推理。首次使用需要下载权重；建议桌面版 Chrome 或 Edge。</small></label></div>
        <div id="provider-compatible">${field("base", "API 地址", "", { max: 500, placeholder: "https://你的服务商/v1", hint: "服务需兼容 Chat Completions，并允许当前网页的浏览器跨域请求。" })}${field("model", "模型名称", existing?.kind === "compatible" ? existing.id : "", { max: 180, placeholder: "服务商提供的模型 ID" })}${field("key", "API Key", "", { type: "password", max: 1000, hint: "本机模型可留空，远程模型请填写自己的 Key。" })}</div>`;
      footer =
        (existing ? button("断开模型", "disconnect", "danger small") : "") +
        button("取消下载", "cancel-model", "small", "hidden") +
        saveButton("启用模型");
    } else if (mode === "settings") {
      title = "连接同一个对话世界";
      kicker = "YOUR CONNECTION";
      body =
        `<p class="dialog-copy">网页和房间服务可以在同一地址，也可以分开部署。朋友们连接相同服务，才能在房间中相遇。</p>` +
        field("base", "对话服务器地址", client.base || "", {
          max: 500,
          placeholder: "留空使用当前网站",
          hint: "填写完整 HTTPS 地址；本机开发可以使用 http://127.0.0.1:4173。",
        }) +
        `<p class="inline-warning">当前${client.connected ? "已连接" : "尚未连接"}。切换服务会退出正在参与的房间。</p>`;
      footer += saveButton("保存并连接");
    } else if (mode === "newroom") {
      title = "给对话一个开始";
      kicker = "A NEW CONVERSATION";
      body =
        field("title", "房间名称", "", {
          max: 80,
          required: true,
          placeholder: "一个值得一起聊的话题",
        }) +
        field("topic", "讨论什么", "", {
          max: 1200,
          rows: 4,
          required: true,
          placeholder: "描述问题、分歧，或想让 Agent 一起探索的方向。",
          hint: "房间与发言会保存在对话服务器，服务中的其他人可以读取。",
        });
      footer += saveButton("创建房间");
    } else if (mode === "compare") {
      title = "看看回声改变了什么";
      kicker = "BEFORE & AFTER";
      body =
        field("question", "用同一道问题，比较两次回答", "", {
          max: 1000,
          rows: 3,
          required: true,
          placeholder: "面对一个不同意的观点时，你会怎么做？",
          hint: "使用相同模型与资料，分别不带回声、带已接纳回声。每次对照调用模型两次；私测身份与资料会交给当前模型。",
        }) + '<div id="comparison-result"></div>';
      footer += saveButton("生成对照");
    } else if (mode === "read") {
      const library =
        typeof item === "string"
          ? state.libraries.find((row) => row.id === item)
          : item;
      if (!library) {
        toast("找不到这份资料。", true);
        return;
      }
      currentItem = library;
      title = library.name;
      kicker = "YOUR KNOWLEDGE";
      body = `<p class="dialog-copy">${e({ private: "仅私测", room: "场内可用", off: "已关闭" }[library.scope] || "")}</p><label class="form-field">Markdown 原文<textarea readonly rows="14" aria-label="Markdown 原文">${e(library.content)}</textarea></label>`;
      footer = button("关闭", "close", "primary");
    } else return;
    $("dialog-title").textContent = title;
    $("dialog-kicker").textContent = kicker;
    $("dialog-body").innerHTML = body;
    $("dialog-footer").innerHTML = footer;
    notice();
    updateOptions();
    if (!dialog.open) dialog.showModal();
  }

  async function action(verb, id) {
    if (verb === "import") {
      if (busy) return;
      $("markdown-input").click();
    } else if (verb === "read") open("read", id);
    else if (verb === "settings") open("settings");
    else if (verb === "close") close();
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const mode = kind,
      ticket = epoch;
    const data = Object.fromEntries(new FormData(form));
    controller = new AbortController();
    setBusy(true);
    notice(mode === "model" ? "正在准备模型…" : "处理中…");
    try {
      if (mode === "identity") {
        const name = tidy(data.name, 32);
        if (!name) throw new Error("请给 Agent 一个名称。");
        await edit((next) => {
          next.profile = {
            ...next.profile,
            name,
            stance: tidy(data.stance, 600),
            anchor: tidy(data.anchor, 1800),
            bio: tidy(data.bio, 2400),
          };
        });
        if (client.myId && client.syncProfile) {
          try {
            await client.syncProfile();
          } catch (error) {
            toast(
              `身份已在本地保存，但房间资料尚未同步：${error.message}`,
              true,
            );
            close();
            return;
          }
        }
        close();
        toast("Agent 已保存。");
      } else if (mode === "model") {
        await client.connectModel(data, {
          signal: controller.signal,
          progress: (text) => {
            if (epoch === ticket && dialog.open) notice(text);
          },
        });
        if (controller.signal.aborted) return;
        close();
        toast(`${client.model?.label || "模型"}已连接。`);
      } else if (mode === "settings") {
        await client.setBase(tidy(data.base, 500));
        close();
        toast(
          client.connected ? "已连接对话服务。" : "地址已保存，服务暂未连接。",
          !client.connected,
        );
      } else if (mode === "newroom") {
        const title = tidy(data.title, 80),
          topic = tidy(data.topic, 1200);
        if (!title || !topic) throw new Error("请填写房间名称和讨论主题。");
        const result = await client.create(title, topic);
        const id = result?.room?.id || result?.id;
        if (id) await client.select(id);
        close();
        go("rooms");
        toast("房间已创建，可以邀请其他人的 Agent 加入。");
      } else if (mode === "compare") {
        const question = tidy(data.question, 1000);
        if (!question) throw new Error("请输入对照问题。");
        const result = await client.compare(question, {
          signal: controller.signal,
        });
        if (ticket === epoch && dialog.open && !controller.signal.aborted) {
          $("comparison-result").innerHTML =
            `<div class="comparison"><article><h3>不带回声</h3><p>${e(result.before)}</p></article><article><h3>带已接纳回声</h3><p>${e(result.after)}</p></article></div>`;
          notice("两次生成也会受采样影响，这个对照用于观察变化。");
        }
      }
    } catch (error) {
      if (ticket === epoch && dialog.open) sessionError(error);
      else report?.(error);
    } finally {
      if (ticket === epoch) {
        setBusy(false);
        render();
      }
    }
  });

  form.addEventListener("change", async (event) => {
    if (event.target.name === "provider") {
      updateOptions();
      return;
    }
    if (!["shape", "color"].includes(event.target.name)) return;
    if (busy) return;
    const nextAppearance = {
      ...(getState().profile.appearance || {}),
      [event.target.name]: event.target.value,
    };
    setBusy(true);
    try {
      await edit((next) => {
        next.profile.appearance = nextAppearance;
      });
      needAvatar().setAppearance(nextAppearance);
      for (const option of form.querySelectorAll(".appearance-option"))
        option.classList.toggle(
          "active",
          Boolean(option.querySelector("input:checked")),
        );
      if (client.myId && client.syncProfile) await client.syncProfile();
      notice("形象设置已保存。");
      render();
    } catch (error) {
      sessionError(error);
    } finally {
      setBusy(false);
    }
  });
  form.addEventListener("click", async (event) => {
    const trigger = event.target.closest(
      '[data-form-action], [data-action="close"]',
    );
    if (!trigger) return;
    event.preventDefault();
    const verb = trigger.dataset.formAction || trigger.dataset.action;
    if (verb === "close") {
      close();
      return;
    }
    if (verb === "cancel-model") {
      controller?.abort();
      notice("正在取消…");
      return;
    }
    if (busy) return;
    if (["pick-model", "pick-original", "pick-preview"].includes(verb)) {
      fileMode =
        verb === "pick-original"
          ? "original"
          : verb === "pick-preview"
            ? "attachment"
            : "preview";
      const input = $("model-input");
      input.value = "";
      input.removeAttribute("accept");
      input.click();
      return;
    }
    setBusy(true);
    try {
      if (verb === "disconnect") {
        await client.disconnectModel();
        close();
        toast("模型已断开，当前页面不再持有这份连接。");
      } else if (verb === "clear-avatar") {
        await needAvatar().clearUpload();
        setBusy(false);
        open("avatar");
        toast("上传形象已移除。");
      } else if (verb === "download-original") {
        await needAvatar().downloadOriginal();
        notice("已准备原件下载。");
      }
      render();
    } catch (error) {
      sessionError(error);
    } finally {
      setBusy(false);
    }
  });
  $("markdown-input").addEventListener("change", async (event) => {
    const input = event.currentTarget,
      files = [...input.files];
    input.value = "";
    if (!files.length) return;
    if (busy) {
      toast("当前操作还在进行，请稍后导入。", true);
      return;
    }
    setBusy(true);
    const imported = [],
      errors = [];
    for (const file of files) {
      try {
        if (file.size > 1024 * 1024) throw new Error("超过 1 MB。");
        const doc = markdownDoc(file.name, await file.text());
        await edit((next) => {
          if (next.libraries.length >= 32)
            throw new Error("最多保存 32 份资料，请先移除不用的文件。");
          next.libraries.unshift(doc);
        });
        imported.push(file.name);
      } catch (error) {
        errors.push(`${file.name}：${error.message}`);
      }
    }
    go("library");
    render();
    setBusy(false);
    toast(
      `已保存 ${imported.length} 份资料，默认仅私测。${errors.length ? ` ${errors[0]}` : ""}`,
      Boolean(errors.length),
    );
  });
  $("model-input").addEventListener("change", async (event) => {
    const input = event.currentTarget,
      files = [...input.files];
    input.value = "";
    if (!files.length || busy) return;
    const mode = fileMode;
    setBusy(true);
    notice(mode === "original" ? "正在保存原件…" : "正在解析并保存形象…");
    try {
      const scene = needAvatar();
      if (mode === "original") await scene.saveOriginalFiles(files);
      else if (mode === "attachment") await scene.loadPreviewFiles(files);
      else await scene.loadFiles(files);
      render();
      setBusy(false);
      open("avatar");
      toast(
        mode === "original"
          ? "3D 原件已保存在当前浏览器，可继续添加通用预览。"
          : "3D 形象已保存。",
      );
    } catch (error) {
      sessionError(error);
    } finally {
      setBusy(false);
    }
  });
  dialog.addEventListener("close", () => {
    controller?.abort();
    epoch++;
    busy = false;
    for (const input of form.querySelectorAll('input[type="password"]'))
      input.value = "";
  });
  dialog.addEventListener("cancel", () => controller?.abort());
  return { open, action };
}
