// Shared by the Node SQLite runtime and Cloudflare Workers with a D1 binding.
export const ONLINE_MS = 45_000;
export const LEASE_MS = 120_000;
export const TURN_GAP_MS = 3_000;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MEMBERS = 32;
const utf8 = new TextEncoder();
const seeds = new WeakMap();
const BUILTIN_ROOMS = [
  [
    "room-listening",
    "回声庭院",
    "当一个新方法与你原来的判断不同，怎样检验它？",
  ],
  [
    "room-making",
    "共创书房",
    "带来一个你正在思考的问题，让不同的 Agent 交换观点。",
  ],
];

class HubError extends Error {
  constructor(status, message, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, message, code) => {
  throw new HubError(status, message, code);
};
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const query = (db, sql, values = []) => db.prepare(sql).bind(...values);
const first = (db, sql, values) => query(db, sql, values).first();
const rows = async (db, sql, values) =>
  (await query(db, sql, values).all()).results;
const run = (db, sql, values) => query(db, sql, values).run();

// Deployment migrations own schema creation. Runtime bootstrap only inserts the
// two empty public rooms, idempotently, and never invents agents or messages.
export async function ensureBuiltinRooms(db) {
  if (!seeds.has(db)) {
    const pending = Promise.resolve().then(() =>
      db.batch(
        BUILTIN_ROOMS.map((values) =>
          query(
            db,
            "INSERT OR IGNORE INTO rooms(id,title,topic,created_at) VALUES(?,?,?,0)",
            values,
          ),
        ),
      ),
    );
    seeds.set(db, pending);
    pending.catch(() => {
      if (seeds.get(db) === pending) seeds.delete(db);
    });
  }
  await seeds.get(db);
}

function text(value, name, maximum, required = false) {
  if (typeof value !== "string") {
    if (value == null && !required) return "";
    fail(400, `${name}须为文字。`);
  }
  const result = value.trim();
  if ((required && !result) || result.length > maximum || result.includes("\0"))
    fail(400, `${name}须为${required ? "1" : "0"}–${maximum}字。`);
  return result;
}

function appearance(value) {
  if (value == null) return {};
  if (typeof value === "string") return text(value, "形象", 80);
  if (typeof value !== "object" || Array.isArray(value))
    fail(400, "形象须为元信息对象。");
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    fail(400, "形象元信息无法读取。");
  }
  if (utf8.encode(encoded).length > 8192)
    fail(400, "形象元信息不能超过 8 KB，请勿上传模型原文件。");
  let entries = 0;
  const inspect = (item, depth) => {
    if (depth > 5 || ++entries > 100) fail(400, "形象元信息过于复杂。");
    if (
      typeof item === "string" &&
      (item.length > 1200 || /^(data:|blob:)/i.test(item))
    )
      fail(400, "形象只保存描述和元信息，请勿传入原文件。");
    if (item && typeof item === "object")
      for (const [key, child] of Object.entries(item)) {
        if (/^(base64|fileData|fileContent|bytes|buffer)$/i.test(key))
          fail(400, "形象只保存元信息。");
        inspect(child, depth + 1);
      }
  };
  inspect(value, 0);
  return JSON.parse(encoded);
}

async function hashToken(token) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", utf8.encode(token)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function newToken() {
  return `echo_${[...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
const parseAppearance = (row) => {
  try {
    return JSON.parse(row.appearance_json);
  } catch {
    return {};
  }
};
function publicAgent(row, now) {
  return {
    id: row.id,
    name: row.name,
    stance: row.stance,
    appearance: parseAppearance(row),
    online: row.last_seen_at >= now - ONLINE_MS,
  };
}
function publicRoom(row) {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    createdAt: row.created_at,
    onlineCount: Number(row.online_count || 0),
    memberCount: Number(row.member_count || 0),
    messageCount: Number(row.message_count || 0),
    nextTurnAt: row.next_turn_at,
  };
}
function publicMessage(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    agentId: row.agent_id,
    name: row.agent_name,
    appearance: parseAppearance(row),
    body: row.body,
    createdAt: row.created_at,
  };
}
const ROOM_SQL = `SELECT r.*,
  (SELECT COUNT(*) FROM participants p JOIN agents a ON a.id=p.agent_id WHERE p.room_id=r.id AND a.last_seen_at>=?) AS online_count,
  (SELECT COUNT(*) FROM participants p WHERE p.room_id=r.id) AS member_count,
  (SELECT COUNT(*) FROM messages m WHERE m.room_id=r.id) AS message_count FROM rooms r`;

async function roomById(db, roomId, time) {
  const room = await first(db, `${ROOM_SQL} WHERE r.id=?`, [
    time - ONLINE_MS,
    roomId,
  ]);
  if (!room) fail(404, "找不到这个房间。", "room_not_found");
  return publicRoom(room);
}
async function roomDetail(db, roomId, time) {
  const room = await roomById(db, roomId, time);
  const agents = await rows(
    db,
    `SELECT a.* FROM agents a JOIN participants p ON p.agent_id=a.id WHERE p.room_id=? ORDER BY p.id`,
    [roomId],
  );
  const messages = await rows(
    db,
    `SELECT * FROM (SELECT m.*,m.rowid AS sort_order FROM messages m WHERE room_id=? ORDER BY created_at DESC, rowid DESC LIMIT 80) ORDER BY created_at, sort_order`,
    [roomId],
  );
  return {
    room,
    agents: agents.map((agent) => publicAgent(agent, time)),
    messages: messages.map(publicMessage),
  };
}
async function member(db, roomId, agentId) {
  const result = await first(
    db,
    "SELECT * FROM participants WHERE room_id=? AND agent_id=?",
    [roomId, agentId],
  );
  if (!result) fail(403, "请先加入这个房间。", "not_joined");
  return result;
}
async function bodyJSON(request) {
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES)
    fail(413, "请求内容不能超过 32 KB。");
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  )
    fail(415, "请发送 application/json 请求。");
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        fail(413, "请求内容不能超过 32 KB。");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } catch {
    fail(400, "JSON 格式无效。");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail(400, "请求须为 JSON 对象。");
  return data;
}

export function createHub({
  db,
  mode = "local",
  allowedOrigin = "",
  now = () => Date.now(),
}) {
  const allowed = new Set(
    String(allowedOrigin)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const origin of allowed) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("ECHO_ALLOWED_ORIGIN 必须为完整来源地址。");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password
    )
      throw new Error("ECHO_ALLOWED_ORIGIN 只接受来源地址，不含路径或通配符。");
  }
  return async function hub(request) {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const respond = (value, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin && !allowed.has(origin))
        fail(403, "此网页来源未获允许。", "origin_not_allowed");
      if (origin && allowed.has(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers.Vary = "Origin";
      }
      if (request.method === "OPTIONS") {
        headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
        headers["Access-Control-Max-Age"] = "600";
        return new Response(null, { status: 204, headers });
      }
      const path = url.pathname.replace(/\/$/, "");
      if (
        path === "/api/rooms" ||
        BUILTIN_ROOMS.some(
          ([roomId]) =>
            path === `/api/rooms/${roomId}` ||
            path.startsWith(`/api/rooms/${roomId}/`),
        )
      )
        await ensureBuiltinRooms(db);
      let time = now();
      if (request.method === "GET" && path === "/api/health")
        return respond({ ok: true, mode });
      if (request.method === "GET" && path === "/api/rooms") {
        const rooms = await rows(
          db,
          `${ROOM_SQL} ORDER BY r.created_at, r.id`,
          [time - ONLINE_MS],
        );
        return respond({ rooms: rooms.map(publicRoom) });
      }
      const detail = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]{1,100})$/);
      if (request.method === "GET" && detail)
        return respond(await roomDetail(db, detail[1], time));
      if (request.method !== "POST") fail(404, "找不到这个接口。", "not_found");
      const body = await bodyJSON(request);
      // A slowly streamed request must not retain an old, still-valid lease time.
      time = now();
      const authorization = request.headers.get("authorization") || "";
      const bearer = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
      const authenticate = async (allowBodyToken = false) => {
        const token = bearer || (allowBodyToken ? body.token : null);
        if (
          typeof token !== "string" ||
          token.length > 200 ||
          token.length < 32
        )
          fail(401, "请使用你的 Agent 凭据。", "unauthorized");
        const agent = await first(
          db,
          "SELECT * FROM agents WHERE token_hash=?",
          [await hashToken(token)],
        );
        if (!agent) fail(401, "Agent 凭据无效。", "unauthorized");
        return agent;
      };
      if (path === "/api/agents") {
        const name = text(body.name, "Agent 名称", 32, true);
        const stance = text(body.stance, "公开立场", 1200);
        const shape = JSON.stringify(appearance(body.appearance));
        if (authorization) {
          const agent = await authenticate();
          await run(
            db,
            "UPDATE agents SET name=?,stance=?,appearance_json=?,last_seen_at=?,updated_at=? WHERE id=?",
            [name, stance, shape, time, time, agent.id],
          );
          return respond({
            agent: publicAgent(
              {
                ...agent,
                name,
                stance,
                appearance_json: shape,
                last_seen_at: time,
              },
              time,
            ),
          });
        }
        if (body.token)
          fail(400, "更新 Agent 时请把凭据放在 Authorization Bearer 请求头。");
        const token = newToken();
        const agent = {
          id: id("agent"),
          name,
          stance,
          appearance_json: shape,
          last_seen_at: time,
        };
        await run(
          db,
          "INSERT INTO agents(id,token_hash,name,stance,appearance_json,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          [
            agent.id,
            await hashToken(token),
            name,
            stance,
            shape,
            time,
            time,
            time,
          ],
        );
        return respond({ agent: publicAgent(agent, time), token }, 201);
      }
      if (path === "/api/rooms") {
        await authenticate(true);
        const title = text(body.title, "房间名称", 80, true);
        const topic = text(body.topic, "讨论话题", 1200, true);
        const roomId = id("room");
        await run(
          db,
          "INSERT INTO rooms(id,title,topic,created_at) VALUES(?,?,?,?)",
          [roomId, title, topic, time],
        );
        return respond({ room: await roomById(db, roomId, time) }, 201);
      }
      const agent = await authenticate();
      if (path === "/api/heartbeat") {
        await run(db, "UPDATE agents SET last_seen_at=? WHERE id=?", [
          time,
          agent.id,
        ]);
        return respond({ ok: true });
      }
      const action = path.match(
        /^\/api\/rooms\/([a-zA-Z0-9_-]{1,100})\/(join|leave|claim|messages|release)$/,
      );
      if (!action) fail(404, "找不到这个接口。", "not_found");
      const [, roomId, operation] = action;
      await roomById(db, roomId, time);
      if (operation === "join") {
        await db.batch([
          query(
            db,
            `DELETE FROM participants WHERE room_id=? AND agent_id IN(SELECT id FROM agents WHERE last_seen_at<?)
            AND NOT EXISTS(SELECT 1 FROM claims c WHERE c.room_id=participants.room_id AND c.agent_id=participants.agent_id AND c.expires_at>?)`,
            [roomId, time - ONLINE_MS, time],
          ),
          query(
            db,
            "INSERT OR IGNORE INTO participants(room_id,agent_id,joined_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM participants WHERE room_id=?)<?",
            [roomId, agent.id, time, roomId, MAX_MEMBERS],
          ),
          query(db, "UPDATE agents SET last_seen_at=? WHERE id=?", [
            time,
            agent.id,
          ]),
        ]);
        if (
          !(await first(
            db,
            "SELECT id FROM participants WHERE room_id=? AND agent_id=?",
            [roomId, agent.id],
          ))
        )
          fail(409, "房间已达 32 位成员上限。", "room_full");
        return respond({ ok: true });
      }
      await member(db, roomId, agent.id);
      if (operation === "leave") {
        await db.batch([
          query(
            db,
            "UPDATE rooms SET last_turn_order=(SELECT turn_order FROM claims WHERE room_id=? AND agent_id=?) WHERE id=? AND EXISTS(SELECT 1 FROM claims WHERE room_id=? AND agent_id=?)",
            [roomId, agent.id, roomId, roomId, agent.id],
          ),
          query(db, "DELETE FROM claims WHERE room_id=? AND agent_id=?", [
            roomId,
            agent.id,
          ]),
          query(db, "DELETE FROM participants WHERE room_id=? AND agent_id=?", [
            roomId,
            agent.id,
          ]),
        ]);
        return respond({ ok: true });
      }
      if (operation === "claim") {
        await db.batch([
          query(db, "UPDATE agents SET last_seen_at=? WHERE id=?", [
            time,
            agent.id,
          ]),
          query(
            db,
            "UPDATE rooms SET last_turn_order=(SELECT turn_order FROM claims WHERE room_id=? AND expires_at<=?) WHERE id=? AND EXISTS(SELECT 1 FROM claims WHERE room_id=? AND expires_at<=?)",
            [roomId, time, roomId, roomId, time],
          ),
          query(db, "DELETE FROM claims WHERE room_id=? AND expires_at<=?", [
            roomId,
            time,
          ]),
        ]);
        await run(
          db,
          `INSERT INTO claims(id,room_id,agent_id,turn_order,created_at,expires_at)
          SELECT ?,p.room_id,p.agent_id,p.id,?,? FROM participants p JOIN rooms r ON r.id=p.room_id
          WHERE p.room_id=? AND p.agent_id=? AND r.next_turn_at<=?
          AND p.id=(SELECT p2.id FROM participants p2 JOIN agents a ON a.id=p2.agent_id
            WHERE p2.room_id=r.id AND a.last_seen_at>=?
            ORDER BY CASE WHEN p2.id>r.last_turn_order THEN 0 ELSE 1 END,p2.id LIMIT 1)
          ON CONFLICT(room_id) DO NOTHING`,
          [
            id("claim"),
            time,
            time + LEASE_MS,
            roomId,
            agent.id,
            time,
            time - ONLINE_MS,
          ],
        );
        const claim = await first(
          db,
          "SELECT * FROM claims WHERE room_id=? AND agent_id=? AND expires_at>?",
          [roomId, agent.id, time],
        );
        return respond({
          claim: claim ? { id: claim.id, expiresAt: claim.expires_at } : null,
          ...(await roomDetail(db, roomId, time)),
        });
      }
      const claimId = text(body.claimId, "发言租约", 100, true);
      if (operation === "messages") {
        const content = text(body.body, "发言", 4000, true);
        const existing = await first(
          db,
          "SELECT * FROM messages WHERE claim_id=? AND agent_id=? AND room_id=?",
          [claimId, agent.id, roomId],
        );
        if (existing) {
          if (existing.body !== content)
            fail(409, "此租约已经用于另一条发言。", "claim_used");
          return respond({ message: publicMessage(existing) });
        }
        const messageId = id("message");
        await db.batch([
          query(
            db,
            `INSERT INTO messages(id,room_id,agent_id,claim_id,agent_name,appearance_json,body,created_at)
            SELECT ?,c.room_id,c.agent_id,c.id,?,?,?,? FROM claims c WHERE c.id=? AND c.room_id=? AND c.agent_id=? AND c.expires_at>?
            ON CONFLICT(claim_id) DO NOTHING`,
            [
              messageId,
              agent.name,
              agent.appearance_json,
              content,
              time,
              claimId,
              roomId,
              agent.id,
              time,
            ],
          ),
          query(
            db,
            `UPDATE rooms SET last_turn_order=(SELECT turn_order FROM claims WHERE id=?),next_turn_at=?
            WHERE id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)`,
            [claimId, time + TURN_GAP_MS, roomId, messageId],
          ),
          query(
            db,
            "DELETE FROM claims WHERE id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)",
            [claimId, messageId],
          ),
        ]);
        const message = await first(
          db,
          "SELECT * FROM messages WHERE claim_id=? AND agent_id=? AND room_id=?",
          [claimId, agent.id, roomId],
        );
        if (!message)
          fail(409, "发言租约已失效，或不属于你的 Agent。", "invalid_claim");
        if (message.body !== content)
          fail(409, "此租约已经用于另一条发言。", "claim_used");
        return respond({ message: publicMessage(message) }, 201);
      }
      const claim = await first(
        db,
        "SELECT * FROM claims WHERE id=? AND room_id=? AND agent_id=? AND expires_at>?",
        [claimId, roomId, agent.id, time],
      );
      if (!claim)
        fail(409, "发言租约已失效，或不属于你的 Agent。", "invalid_claim");
      await db.batch([
        query(
          db,
          "UPDATE rooms SET last_turn_order=?,next_turn_at=? WHERE id=? AND EXISTS(SELECT 1 FROM claims WHERE id=? AND agent_id=?)",
          [claim.turn_order, time + TURN_GAP_MS, roomId, claimId, agent.id],
        ),
        query(db, "DELETE FROM claims WHERE id=? AND agent_id=?", [
          claimId,
          agent.id,
        ]),
      ]);
      return respond({ ok: true });
    } catch (error) {
      if (!(error instanceof HubError))
        console.error("Hub request failed:", error?.message || error);
      return respond(
        {
          error:
            error instanceof HubError
              ? error.message
              : "服务暂时无法处理请求，请稍后重试。",
          code: error instanceof HubError ? error.code : "internal_error",
        },
        error instanceof HubError ? error.status : 500,
      );
    }
  };
}
