import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHub, ONLINE_MS, LEASE_MS, TURN_GAP_MS } from "../lib/hub.mjs";
import { openSqliteDatabase } from "../server.mjs";

const directory = await mkdtemp(join(tmpdir(), "echo-hub-test-"));
const filename = join(directory, "hub.sqlite");
let db;
let time = 1_800_000_000_000;
let hub;
function open() {
  db = openSqliteDatabase(filename);
  hub = createHub({
    db,
    mode: "test",
    now: () => time,
    allowedOrigin: "https://example.github.io",
  });
}
async function call(
  path,
  {
    method = "POST",
    body = {},
    token,
    status = 200,
    origin,
    headers: extraHeaders = {},
  } = {},
) {
  const headers = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  if (method === "POST") headers["Content-Type"] ||= "application/json";
  const response = await hub(
    new Request(`http://localhost:4173/api${path}`, {
      method,
      headers,
      ...(method === "POST"
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    }),
  );
  const data = response.status === 204 ? null : await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${JSON.stringify(data)}`,
  );
  return { data, response };
}
const get = async (path) => (await call(path, { method: "GET" })).data;
const post = async (path, token, body = {}, status = 200) =>
  (await call(path, { token, body, status })).data;

try {
  open();
  assert.equal((await get("/health")).ok, true);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM rooms").first().count,
    0,
    "schema migration contains no data insertion",
  );
  assert.equal(
    (await get("/rooms/room-listening")).room.title,
    "回声庭院",
    "direct builtin-room links bootstrap empty rooms",
  );
  const initial = await get("/rooms");
  assert.equal(initial.rooms.length, 2);
  assert.ok(
    initial.rooms.every(
      (room) => !room.onlineCount && !room.messageCount && !room.memberCount,
    ),
    "seed rooms must be empty",
  );
  const roomId = initial.rooms[0].id;
  const roomPath = `/rooms/${roomId}`;
  const create = async (name) =>
    (
      await call("/agents", {
        body: {
          name,
          stance: `${name}的立场`,
          appearance: { shape: "pebble", color: "#b2d0be" },
        },
        status: 201,
      })
    ).data;
  const a = await create("甲");
  const b = await create("乙");
  const c = await create("丙");
  assert.notEqual(a.token, b.token);
  assert.equal(a.token.length, 69);
  assert.ok(!JSON.stringify(a.agent).includes("token"));
  const rawAgent = db
    .prepare("SELECT * FROM agents WHERE id=?")
    .bind(a.agent.id)
    .first();
  assert.equal(rawAgent.token_hash.length, 64);
  assert.notEqual(rawAgent.token_hash, a.token);
  await call("/agents", {
    body: { name: "冒用", token: a.token },
    status: 400,
  });
  await call("/agents", {
    body: { name: "冒用" },
    token: "x".repeat(69),
    status: 401,
  });
  await call("/agents", {
    token: a.token,
    body: {
      name: "甲",
      stance: "更新后的公开立场",
      appearance: {
        shape: "fox",
        model: { name: "fox.glb", format: "glb", uploaded: true },
      },
    },
  });
  await call("/rooms", {
    body: { title: "新房间", topic: "测试话题" },
    status: 401,
  });
  const created = await post(
    "/rooms",
    a.token,
    { title: "新房间", topic: "测试话题" },
    201,
  );
  assert.equal(created.room.messageCount, 0);
  await post(`${roomPath}/claim`, a.token, {}, 403);
  for (const agent of [a, b, c]) await post(`${roomPath}/join`, agent.token);
  await post(`${roomPath}/join`, a.token);
  assert.equal(
    (await get(roomPath)).agents.length,
    3,
    "joining must be idempotent",
  );
  assert.equal(
    (await post(`${roomPath}/claim`, b.token)).claim,
    null,
    "later joiner cannot take first turn",
  );
  const first = (await post(`${roomPath}/claim`, a.token)).claim;
  assert.equal(first.expiresAt, time + LEASE_MS);
  assert.equal(
    (await post(`${roomPath}/claim`, a.token)).claim.id,
    first.id,
    "claim retries keep the same lease",
  );
  assert.equal((await post(`${roomPath}/claim`, b.token)).claim, null);
  await post(
    `${roomPath}/messages`,
    b.token,
    { claimId: first.id, body: "冒用租约" },
    409,
  );
  await post(`${roomPath}/release`, b.token, { claimId: first.id }, 409);
  const message = (
    await post(
      `${roomPath}/messages`,
      a.token,
      { claimId: first.id, body: "这是第一条真实发言。" },
      201,
    )
  ).message;
  const retry = (
    await post(`${roomPath}/messages`, a.token, {
      claimId: first.id,
      body: message.body,
    })
  ).message;
  assert.equal(
    retry.id,
    message.id,
    "lost-response retry must not duplicate a message",
  );
  await post(
    `${roomPath}/messages`,
    a.token,
    { claimId: first.id, body: "使用旧租约发新消息" },
    409,
  );
  assert.equal(
    (await post(`${roomPath}/claim`, b.token)).claim,
    null,
    "server enforces turn spacing",
  );
  time += TURN_GAP_MS;
  const second = (await post(`${roomPath}/claim`, b.token)).claim;
  assert.ok(second, "the second member gets the next turn");
  await post(`${roomPath}/release`, b.token, { claimId: second.id });
  time += TURN_GAP_MS;
  const third = (await post(`${roomPath}/claim`, c.token)).claim;
  assert.ok(third, "releasing advances to the next member");
  time += LEASE_MS + 1;
  for (const agent of [a, b, c]) await post("/heartbeat", agent.token);
  await post(
    `${roomPath}/messages`,
    c.token,
    { claimId: third.id, body: "过期发言" },
    409,
  );
  const afterTimeout = (await post(`${roomPath}/claim`, a.token)).claim;
  assert.ok(afterTimeout, "expired lease advances round robin");
  await post(
    `${roomPath}/messages`,
    a.token,
    { claimId: afterTimeout.id, body: "租约超时后，轮到下一位。" },
    201,
  );
  time += ONLINE_MS + 1;
  await post("/heartbeat", a.token);
  await post("/heartbeat", c.token);
  const online = await get(roomPath);
  assert.equal(online.room.onlineCount, 2);
  assert.equal(
    online.agents.find((agent) => agent.id === b.agent.id).online,
    false,
  );
  const skipOffline = (await post(`${roomPath}/claim`, c.token)).claim;
  assert.ok(skipOffline, "offline members do not block the rotation");
  await post(`${roomPath}/leave`, c.token);
  await post(
    `${roomPath}/messages`,
    c.token,
    { claimId: skipOffline.id, body: "离开后不可发言" },
    403,
  );
  assert.equal((await get(roomPath)).agents.length, 2);

  await call("/agents", { body: { name: "" }, status: 400 });
  await call("/agents", { body: { name: "a".repeat(33) }, status: 400 });
  await call("/agents", {
    body: {
      name: "文件",
      appearance: { data: "data:model/gltf-binary;base64,AAAA" },
    },
    status: 400,
  });
  await call("/agents", { body: "{", status: 400 });
  await call("/agents", { body: "[]", status: 400 });
  await call("/agents", {
    body: { name: "bad mime" },
    headers: { "Content-Type": "text/plain" },
    status: 415,
  });
  await call("/agents", {
    body: JSON.stringify({ name: "x".repeat(34_000) }),
    status: 413,
  });
  await call("/rooms/does-not-exist", { method: "GET", status: 404 });
  await call("/health", {
    method: "GET",
    origin: "https://evil.example",
    status: 403,
  });
  const cors = await call("/health", {
    method: "GET",
    origin: "https://example.github.io",
  });
  assert.equal(
    cors.response.headers.get("access-control-allow-origin"),
    "https://example.github.io",
  );
  await call("/rooms", {
    method: "OPTIONS",
    origin: "https://example.github.io",
    status: 204,
  });
  const publicJSON = JSON.stringify(await get(roomPath));
  for (const agent of [a, b, c])
    assert.ok(
      !publicJSON.includes(agent.token) && !publicJSON.includes("token_hash"),
    );
  const before = (await get(roomPath)).messages;
  db.close();
  db = null;
  const disk = await readFile(filename);
  for (const agent of [a, b, c])
    assert.ok(
      !disk.includes(Buffer.from(agent.token)),
      "raw credential must not be on disk",
    );
  open();
  assert.deepEqual(
    (await get(roomPath)).messages,
    before,
    "messages survive reopening the database",
  );
  await post("/heartbeat", a.token);
  assert.equal(
    (await get("/rooms")).rooms.length,
    3,
    "rooms survive reopening without duplicated seeds",
  );

  const concurrentPath = `/rooms/${created.room.id}`;
  for (const agent of [a, b, c])
    await post(`${concurrentPath}/join`, agent.token);
  const claims = await Promise.all(
    [a, b, c].map((agent) => post(`${concurrentPath}/claim`, agent.token)),
  );
  assert.equal(
    claims.filter((result) => result.claim).length,
    1,
    "concurrent callers cannot acquire multiple leases",
  );
  assert.ok(claims[0].claim, "concurrency preserves join order");
  const concurrentClaim = claims[0].claim;
  const competingPosts = await Promise.all(
    ["并发发言甲", "并发发言乙"].map((body) =>
      hub(
        new Request(`http://localhost:4173/api${concurrentPath}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${a.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ claimId: concurrentClaim.id, body }),
        }),
      ),
    ),
  );
  assert.deepEqual(
    competingPosts.map((response) => response.status).sort(),
    [201, 409],
  );
  assert.equal(
    (await get(concurrentPath)).messages.length,
    1,
    "one lease produces at most one persisted message",
  );

  const capped = await post(
    "/rooms",
    a.token,
    { title: "满员回收测试", topic: "在线名额不能被永久离线成员占据。" },
    201,
  );
  const cappedPath = `/rooms/${capped.room.id}`;
  const crowd = [];
  for (let index = 0; index < 33; index++)
    crowd.push(await create(`成员${index + 1}`));
  for (const agent of crowd.slice(0, 32))
    await post(`${cappedPath}/join`, agent.token);
  await post(`${cappedPath}/join`, crowd[32].token, {}, 409);
  time += ONLINE_MS + 1;
  await post(`${cappedPath}/join`, crowd[32].token);
  assert.equal(
    (await get(cappedPath)).agents.length,
    1,
    "offline old memberships are reclaimed when someone joins",
  );
  console.log(
    "PASS hub: real empty rooms, hashed credentials, authenticated membership, fair turns, 120s leases, pacing, idempotent messages, offline detection, CORS, input limits and SQLite persistence.",
  );
} finally {
  db?.close();
  await rm(directory, { recursive: true, force: true });
}
