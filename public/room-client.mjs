import { compileEchoes } from "./core.mjs";
import { connectBrowserModel, modelRound, modelCompare } from "./web-model.mjs";

const HUB_KEY = "lingdang.hub.v3";
const DEPLOYED_HUB =
  "https://lingdang-echo-studio.snugwatermelon3.chatgpt.site";
const ABORT = () => new DOMException("已暂停。", "AbortError");
const storage = {
  get(key) {
    try {
      return globalThis.localStorage?.getItem(key) || "";
    } catch {
      return "";
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private browsing can disable storage */
    }
  },
};
function normalizeBase(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("请输入完整的房间服务地址。");
  }
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/", "/api", "/api/"].includes(url.pathname)
  ) {
    throw new Error(
      "房间服务须为 HTTPS 来源地址，本机可使用 http://localhost:端口。",
    );
  }
  return url.origin;
}
const safeJSON = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const pageURL = () =>
  new URL(globalThis.location?.href || "http://localhost:4173/");
const defaultBase = () =>
  pageURL().hostname === "xcorya.github.io" &&
  pageURL().pathname.startsWith("/lingdang-echo-studio")
    ? DEPLOYED_HUB
    : "";

export function createRoomClient({
  getState,
  onChange = () => {},
  onEchoes = () => {},
  onError = () => {},
}) {
  let base;
  try {
    base = normalizeBase(storage.get(HUB_KEY) || defaultBase());
  } catch {
    base = defaultBase();
  }
  let credentials = null;
  let activeRoom = "";
  let session = null;
  let epoch = 0;
  let busy = false;
  let running = false;
  let operation = null;
  let refreshTimer = null;
  let heartbeatTimer = null;
  let turnTimer = null;
  let refreshPending = null;
  let knownProfile = "";
  let lastHandled = "";
  let pagehideInstalled = false;
  const credentialKey = () => `lingdang.agent.v3:${base || pageURL().origin}`;
  const changed = () => onChange(client);
  const setStatus = (value) => {
    client.status = value;
    changed();
  };
  function loadCredentials() {
    const stored = safeJSON(storage.get(credentialKey()));
    credentials = stored?.token && stored?.agent?.id ? stored : null;
    knownProfile = "";
  }
  function saveCredentials(value) {
    credentials = value;
    storage.set(credentialKey(), value ? JSON.stringify(value) : "");
  }
  function profileBody() {
    const profile = getState()?.profile || {};
    return {
      name: String(profile.name || "我的 Agent").trim(),
      stance: String(profile.stance || ""),
      appearance: profile.appearance || { shape: "pebble", color: "#b2d0be" },
    };
  }
  async function api(
    path,
    {
      body,
      token = credentials?.token,
      signal,
      targetBase = base,
      keepalive = false,
    } = {},
  ) {
    if (signal?.aborted) throw ABORT();
    const origin = targetBase || pageURL().origin;
    const response = await fetch(`${origin}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      redirect: "error",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(keepalive ? { keepalive: true } : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("房间服务没有返回 JSON；请检查服务地址和部署状态。");
    }
    if (signal?.aborted) throw ABORT();
    if (!response.ok) {
      const error = new Error(
        data.error || `房间请求失败（${response.status}）。`,
      );
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }
  async function identity(signal) {
    const sourceBase = base;
    const body = profileBody();
    const serialized = JSON.stringify(body);
    if (credentials) {
      if (knownProfile === serialized) return credentials;
      try {
        const result = await api("/agents", { body, signal });
        if (sourceBase !== base) throw ABORT();
        saveCredentials({ token: credentials.token, agent: result.agent });
        knownProfile = serialized;
        return credentials;
      } catch (error) {
        if (error.status !== 401) throw error;
        saveCredentials(null);
      }
    }
    const result = await api("/agents", { body, token: "", signal });
    if (sourceBase !== base) throw ABORT();
    saveCredentials(result);
    knownProfile = serialized;
    return credentials;
  }
  async function leaveAt(room, token, targetBase = base, keepalive = false) {
    if (!room || !token) return;
    try {
      await api(`/rooms/${encodeURIComponent(room)}/leave`, {
        body: {},
        token,
        targetBase,
        keepalive,
      });
    } catch {
      /* an expired heartbeat removes this member from the online queue */
    }
  }
  function poll() {
    if (!refreshTimer) {
      refreshTimer = setInterval(
        () => client.refresh().catch(backgroundError),
        5_000,
      );
      refreshTimer.unref?.();
    }
  }
  async function backgroundError(error) {
    if (error?.name === "AbortError") return;
    const wasConnected = client.connected;
    client.connected = false;
    await client.stop();
    setStatus(error.message || "房间连接中断，已暂停。");
    if (wasConnected) onError(error);
  }
  function maintainHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (activeRoom) api("/heartbeat", { body: {} }).catch(backgroundError);
    }, 15_000);
    heartbeatTimer.unref?.();
  }
  async function release(room, claim, token, targetBase) {
    if (!claim) return;
    try {
      await api(`/rooms/${encodeURIComponent(room)}/release`, {
        token,
        targetBase,
        body: { claimId: claim.id },
      });
    } catch {
      /* leave / expiry may already have released the lease */
    }
  }
  async function tick() {
    if (!running || !activeRoom || busy) return;
    const version = epoch;
    const room = activeRoom;
    const token = credentials?.token;
    const targetBase = base;
    const controller = new AbortController();
    operation = controller;
    let claim;
    busy = true;
    try {
      const detail = await api(`/rooms/${encodeURIComponent(room)}`, {
        signal: controller.signal,
      });
      if (version !== epoch || !running) return;
      if (client.selected === room) client.detail = detail;
      const last = detail.messages.at(-1);
      const others = detail.agents.filter(
        (agent) => agent.id !== client.myId && agent.online,
      );
      // One browser may open an empty room once; it never talks to itself.
      if (
        (!others.length && detail.messages.length) ||
        last?.agentId === client.myId ||
        (last && last.id === lastHandled)
      ) {
        setStatus(
          others.length
            ? "正在等其他 Agent 发言。"
            : "等待另一位在线 Agent；不会独自空转。",
        );
        return;
      }
      const turn = await api(`/rooms/${encodeURIComponent(room)}/claim`, {
        body: {},
        signal: controller.signal,
      });
      if (client.selected === room)
        client.detail = {
          room: turn.room,
          agents: turn.agents,
          messages: turn.messages,
        };
      claim = turn.claim;
      if (version !== epoch || !running) return;
      if (!claim) {
        setStatus("已加入，等待轮到自己的回合。");
        return;
      }
      const peers = turn.messages
        .filter((message) => message.agentId !== client.myId)
        .slice(-8)
        .map((message) => ({
          ...message,
          author: message.name,
          role: "peer",
          url: (() => {
            const url = pageURL();
            url.searchParams.set("room", room);
            url.hash = `message-${message.id}`;
            return url.href;
          })(),
        }));
      setStatus("正在思考并回应房间…");
      const result = await modelRound(
        session,
        getState(),
        turn.room.topic,
        peers,
        { signal: controller.signal },
      );
      if (
        version !== epoch ||
        !running ||
        activeRoom !== room ||
        controller.signal.aborted
      )
        return;
      const posted = await api(`/rooms/${encodeURIComponent(room)}/messages`, {
        body: { claimId: claim.id, body: result.reply },
        signal: controller.signal,
      });
      if (version !== epoch || !running) return;
      lastHandled = posted.message.id;
      client.remaining--;
      const fresh = compileEchoes(
        { echoes: [], ...getState() },
        result.candidates,
        peers,
        "room",
        claim.id,
      );
      fresh.forEach((echo) => {
        echo.source.roomTitle = turn.room.title;
        echo.source.roomId = room;
      });
      if (fresh.length) await onEchoes(fresh);
      claim = null;
      await client.refresh();
      if (client.remaining <= 0) {
        await client.stop();
        setStatus("本次 8 轮已完成，已离开参与队列。");
      } else setStatus(`已发言，本次还可参与 ${client.remaining} 轮。`);
    } catch (error) {
      if (version === epoch && error?.name !== "AbortError") {
        await client.stop();
        setStatus(error.message || "本轮失败，已暂停。");
        onError(error);
      }
    } finally {
      if (claim) await release(room, claim, token, targetBase);
      if (version === epoch) {
        busy = false;
        operation = null;
        changed();
      }
    }
  }

  const client = {
    rooms: [],
    detail: null,
    selected: pageURL().searchParams.get("room") || "",
    connected: false,
    status: "正在连接房间服务…",
    remaining: 8,
    get activeRoom() {
      return activeRoom;
    },
    get busy() {
      return busy;
    },
    get model() {
      return session;
    },
    get base() {
      return base;
    },
    get myId() {
      return credentials?.agent?.id || "";
    },
    async init() {
      loadCredentials();
      if (!pagehideInstalled && globalThis.addEventListener) {
        pagehideInstalled = true;
        globalThis.addEventListener("pagehide", () => {
          void client.stop({ keepalive: true });
        });
      }
      try {
        await api("/health", { token: "" });
        await client.refresh();
        setStatus(
          session
            ? "模型已就绪，可以开始参与。"
            : "房间已连接，连接模型后可参与。",
        );
      } catch (error) {
        client.connected = false;
        setStatus(error.message || "房间服务尚未连接。");
        onError(error);
      }
      poll();
      return client;
    },
    async refresh() {
      const sourceBase = base;
      const selected = client.selected;
      if (
        refreshPending?.base === sourceBase &&
        refreshPending?.selected === selected
      )
        return refreshPending.promise;
      const task = { base: sourceBase, selected, promise: null };
      task.promise = (async () => {
        const list = await api("/rooms", { token: "", targetBase: sourceBase });
        if (sourceBase !== base) return null;
        client.rooms = list.rooms;
        if (
          !client.selected ||
          !list.rooms.some((room) => room.id === client.selected)
        )
          client.selected = list.rooms[0]?.id || "";
        const room =
          selected && list.rooms.some((item) => item.id === selected)
            ? selected
            : client.selected;
        if (room) {
          const detail = await api(`/rooms/${encodeURIComponent(room)}`, {
            token: "",
            targetBase: sourceBase,
          });
          if (sourceBase !== base) return null;
          if (client.selected === room) client.detail = detail;
        } else client.detail = null;
        client.connected = true;
        changed();
        return client.detail;
      })();
      refreshPending = task;
      try {
        return await task.promise;
      } catch (error) {
        if (sourceBase !== base) return null;
        throw error;
      } finally {
        if (refreshPending === task) refreshPending = null;
      }
    },
    async select(roomId) {
      if (roomId === client.selected) return client.refresh();
      await client.stop();
      client.selected = String(roomId);
      client.detail = null;
      lastHandled = "";
      await client.refresh();
      return client.detail;
    },
    async create(title, topic) {
      await identity();
      const result = await api("/rooms", { body: { title, topic } });
      await client.select(result.room.id);
      return result.room;
    },
    async join() {
      if (!session) throw new Error("请先连接模型，再加入参与队列。");
      if (!client.selected) throw new Error("请先选择一个房间。");
      if (activeRoom === client.selected) return client;
      if (activeRoom || busy) await client.stop();
      const room = client.selected;
      const joinBase = base;
      let joinToken = credentials?.token;
      const version = ++epoch;
      const controller = new AbortController();
      operation = controller;
      busy = true;
      setStatus("正在加入房间…");
      try {
        await identity(controller.signal);
        joinToken = credentials?.token;
        if (version !== epoch) throw ABORT();
        await api(`/rooms/${encodeURIComponent(room)}/join`, {
          body: {},
          signal: controller.signal,
        });
        if (version !== epoch) {
          await leaveAt(room, joinToken, joinBase);
          return client;
        }
        activeRoom = room;
        maintainHeartbeat();
        setStatus("已加入房间。");
        return client;
      } catch (error) {
        await leaveAt(room, joinToken, joinBase);
        if (version === epoch && error?.name !== "AbortError") throw error;
        return client;
      } finally {
        if (version === epoch) {
          busy = false;
          operation = null;
          changed();
        }
      }
    },
    async leave() {
      return client.stop();
    },
    async start() {
      if (!session) throw new Error("请先连接模型。");
      if (running) return client;
      await client.join();
      if (!activeRoom) return client;
      running = true;
      client.remaining = 8;
      clearInterval(turnTimer);
      turnTimer = setInterval(() => {
        void tick();
      }, 4_000);
      turnTimer.unref?.();
      void tick();
      return client;
    },
    async stop({ keepalive = false } = {}) {
      ++epoch;
      running = false;
      operation?.abort();
      operation = null;
      clearInterval(turnTimer);
      turnTimer = null;
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      const room = activeRoom;
      const token = credentials?.token;
      activeRoom = "";
      busy = false;
      setStatus("已暂停参与。");
      await leaveAt(room, token, base, keepalive);
      return client;
    },
    async syncProfile() {
      if (credentials) {
        await identity();
        changed();
      }
    },
    async setBase(value) {
      const target = normalizeBase(value || defaultBase());
      await client.stop();
      base = target;
      storage.set(HUB_KEY, target);
      credentials = null;
      knownProfile = "";
      client.rooms = [];
      client.detail = null;
      client.selected = "";
      client.connected = false;
      return client.init();
    },
    async connectModel(body, options = {}) {
      await client.stop();
      session?.close();
      session = null;
      const controller = new AbortController();
      operation = controller;
      const version = ++epoch;
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
      busy = true;
      setStatus("正在准备模型…");
      try {
        const model = await connectBrowserModel(body, {
          signal,
          progress: (value) => {
            options.progress?.(value);
            if (version === epoch) setStatus(value);
          },
        });
        if (version !== epoch || signal.aborted) {
          model.close();
          throw ABORT();
        }
        session = model;
        setStatus(`${model.label} 已就绪。`);
        return model;
      } finally {
        if (version === epoch) {
          busy = false;
          operation = null;
          changed();
        }
      }
    },
    async disconnectModel() {
      await client.stop();
      session?.close();
      session = null;
      setStatus("模型已断开。");
    },
    async compare(question, { signal } = {}) {
      if (!session) throw new Error("请先连接模型，再进行前后对照。");
      await client.stop();
      const version = ++epoch;
      const controller = new AbortController();
      operation = controller;
      busy = true;
      setStatus("正在生成前后对照…");
      try {
        const result = await modelCompare(session, getState(), question, {
          signal: signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal,
        });
        if (version !== epoch) throw ABORT();
        setStatus("前后对照已完成。");
        return result;
      } finally {
        if (version === epoch) {
          busy = false;
          operation = null;
          changed();
        }
      }
    },
  };
  loadCredentials();
  return client;
}
