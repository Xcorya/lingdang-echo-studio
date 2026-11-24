const DB_NAME = "lingdang-echo-studio";
const STORE = "state";
const KEY = "current";
const text = (value, limit) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const clone = (value) => structuredClone(value);
const shapes = ["rabbit", "fox", "bird", "pebble"];

function appearance(value) {
  const input = typeof value === "string" ? { shape: value } : value || {};
  return {
    shape: shapes.includes(input.shape) ? input.shape : "rabbit",
    color: /^#[0-9a-f]{6}$/i.test(input.color || "") ? input.color : "#b4c9b1",
  };
}
function normalize(input) {
  const old = input && typeof input === "object" ? input : {};
  const p = old.profile || {};
  return {
    version: 3,
    profile: {
      name: text(p.name, 32) || "拾叶",
      stance: text(p.stance, 600),
      anchor: text(p.anchor, 1800),
      bio: text(p.bio, 2400),
      appearance: appearance(p.appearance),
    },
    libraries: Array.isArray(old.libraries)
      ? old.libraries
          .filter(
            (row) =>
              row &&
              typeof row.id === "string" &&
              typeof row.content === "string" &&
              typeof row.name === "string",
          )
          .slice(0, 32)
          .map((row) => ({
            id: row.id,
            name: text(row.name, 120),
            content: row.content,
            scope: ["private", "room", "off"].includes(row.scope)
              ? row.scope
              : "private",
          }))
      : [],
    echoes: Array.isArray(old.echoes)
      ? old.echoes
          .filter(
            (row) =>
              row &&
              typeof row.id === "string" &&
              typeof row.insight === "string" &&
              row.source,
          )
          .map((row) => ({
            id: row.id,
            type: ["方法", "观点", "事实线索"].includes(row.type)
              ? row.type
              : "观点",
            insight: row.insight,
            quote: typeof row.quote === "string" ? row.quote : "",
            source: clone(row.source),
            status: ["pending", "accepted", "rejected", "revoked"].includes(
              row.status,
            )
              ? row.status
              : "pending",
            scope: row.scope === "room" ? "room" : "private",
            ...(row.at ? { at: row.at } : {}),
            ...(row.changedAt ? { changedAt: row.changedAt } : {}),
            ...(row.autoAccepted ? { autoAccepted: true } : {}),
          }))
      : [],
  };
}
function legacyState() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`lingdang-echo-demo-v1:${location.pathname}`) ||
        "null",
    );
    return saved?.version === 1 ? normalize(saved) : null;
  } catch {
    return null;
  }
}
function storageError(error) {
  const quota = error?.name === "QuotaExceededError";
  return new Error(
    quota
      ? "浏览器存储空间不足，这次改动没有保存。请释放空间后重试。"
      : "浏览器没有完成保存，这次改动尚未生效。请检查网站存储权限后重试。",
    { cause: error },
  );
}
async function database() {
  if (!globalThis.indexedDB) throw new Error("当前浏览器不支持 IndexedDB。");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("浏览器存储被其他页面占用，请关闭旧页面后重试。"));
    }, 8000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(request.error);
      }
    };
  });
}
function transaction(db, mode, operation) {
  return new Promise((resolve, reject) => {
    let value, request, tx;
    try {
      tx = db.transaction(STORE, mode);
      request = operation(tx.objectStore(STORE));
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(storageError(tx.error || request.error));
      tx.onerror = () => {
        /* onabort reports a single, persistent failure. */
      };
    } catch (error) {
      try {
        tx?.abort();
      } catch {
        /* transaction may already be inactive */
      }
      reject(storageError(error));
    }
  });
}

export async function openStudio() {
  let db;
  try {
    db = await database();
  } catch (error) {
    // Reading and looking around still works; mutations fail explicitly.
    return {
      state: legacyState() || normalize(),
      persistent: false,
      warning: "浏览器存储不可用。请允许网站保存数据，才能编辑资料或记忆。",
      async save() {
        throw storageError(error);
      },
    };
  }
  const current = await transaction(db, "readonly", (store) => store.get(KEY));
  const state = current ? normalize(current) : legacyState() || normalize();
  if (!current)
    await transaction(db, "readwrite", (store) => store.put(state, KEY));
  const result = {
    state,
    persistent: true,
    async save(next) {
      if (
        !next ||
        typeof next !== "object" ||
        !next.profile ||
        !Array.isArray(next.libraries) ||
        !Array.isArray(next.echoes)
      ) {
        throw new Error("资料格式无效，本次改动没有保存。");
      }
      const value = normalize(next);
      await transaction(db, "readwrite", (store) => store.put(value, KEY));
      result.state = clone(value);
      return clone(value);
    },
    close() {
      db.close();
    },
  };
  return result;
}
