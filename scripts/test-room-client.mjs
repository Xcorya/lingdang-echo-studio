import assert from "node:assert/strict";
import { createHub } from "../lib/hub.mjs";
import { openSqliteDatabase } from "../server.mjs";
import { createRoomClient } from "../public/room-client.mjs";
import { modelRound, modelCompare } from "../public/web-model.mjs";
const db = openSqliteDatabase(":memory:");
let time = Date.now();
const hub = createHub({ db, now: () => time });
const pagehide = [];
globalThis.addEventListener = (event, callback) => {
  if (event === "pagehide") pagehide.push(callback);
};
let keepaliveLeaves = 0;
const timers = [];
globalThis.setInterval = (fn, delay) => {
  const t = { fn, delay, unref() {}, closed: false };
  timers.push(t);
  return t;
};
globalThis.clearInterval = (t) => {
  if (t) t.closed = true;
};
const storage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.get(key),
    setItem: (key, value) => map.set(key, value),
    map,
  };
};
globalThis.localStorage = storage();
const count = {};
let delayed = null,
  resolveDelayed;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "model.example") {
    const key = init.headers.Authorization;
    count[key] = (count[key] || 0) + 1;
    const payload = JSON.parse(init.body);
    const data = JSON.parse(payload.messages[1].content);
    const response = () =>
      Response.json({
        choices: [
          {
            message: {
              content: data.notes
                ? JSON.stringify({
                    reply:
                      "先设计一次小实验，记录不同条件下的表现，再讨论这条方法能否复用。",
                    source: data.notes.length ? 1 : 0,
                    insight: data.notes.length
                      ? "先用小实验记录适用条件，再决定是否采纳。"
                      : "",
                    type: "方法",
                  })
                : data.context.echoes.length
                  ? "带回声的回答"
                  : "原始回答",
            },
          },
        ],
      });
    if (delayed === key)
      return new Promise((resolve) => {
        resolveDelayed = () => resolve(response());
      });
    return response();
  }
  if (url.pathname.endsWith("/leave") && init.keepalive) keepaliveLeaves++;
  return hub(new Request(url, init));
};
const state = (name) => ({
  profile: {
    name,
    stance: "先核对条件",
    anchor: "私人锚点",
    bio: "私人经历",
    appearance: { shape: "pebble", color: "#b2d0be" },
  },
  libraries: [],
  echoes: [],
});
const states = [state("甲"), state("乙")];
const errors = [];
const echoes = [];
const make = (i) =>
  createRoomClient({
    getState: () => states[i],
    onEchoes: (fresh) => {
      states[i].echoes.push(...fresh);
      echoes.push(...fresh);
    },
    onError: (error) => errors.push(error),
  });
const settle = async (client) => {
  for (let i = 0; i < 100 && client.busy; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.busy, false, "client must settle");
};
const a = make(0);
await a.init();
await assert.rejects(a.join(), /先连接模型/);
assert.equal((await a.refresh()).agents.length, 0);
await a.connectModel({
  provider: "compatible",
  base: "https://model.example/v1",
  key: "key-a",
  model: "fixture",
});
await a.start();
await settle(a);
assert.equal(count["Bearer key-a"], 1);
assert.equal(a.detail.messages.length, 1);
const aTimer = timers.find((t) => t.delay === 4000 && !t.closed);
aTimer.fn();
await settle(a);
assert.equal(count["Bearer key-a"], 1, "one member must not talk to itself");
assert.ok(
  ![...localStorage.map.values()].some((value) => value.includes("key-a")),
  "model key must not persist",
);
globalThis.localStorage = storage();
const b = make(1);
await b.init();
await b.connectModel({
  provider: "compatible",
  base: "https://model.example/v1",
  key: "key-b",
  model: "fixture",
});
time += 4000;
globalThis.document = { hidden: true };
await b.start();
await settle(b);
assert.notEqual(a.myId, b.myId);
assert.equal(count["Bearer key-b"], 1);
assert.equal(b.detail.messages.length, 2);
assert.equal(echoes[0].type, "方法");
assert.equal(echoes[0].source.author, "甲");
time += 4000;
delayed = "Bearer key-a";
aTimer.fn();
for (let i = 0; i < 100 && !resolveDelayed; i++)
  await new Promise((resolve) => setImmediate(resolve));
assert.ok(resolveDelayed, "third turn began generating");
await a.stop();
resolveDelayed();
await new Promise((resolve) => setImmediate(resolve));
await a.refresh();
assert.equal(
  a.detail.messages.length,
  2,
  "pausing must prevent an unfinished response from publishing",
);
assert.ok(
  !a.detail.agents.some((agent) => agent.id === a.myId),
  "paused agent leaves membership",
);
pagehide.forEach((callback) => callback());
await new Promise((resolve) => setImmediate(resolve));
assert.ok(keepaliveLeaves > 0, "pagehide makes a best-effort keepalive leave");
await b.stop();
assert.equal(errors.length, 0, errors.map((e) => e.message).join(","));
const model = {
  complete: async () =>
    JSON.stringify({
      reply: "我们先从一个具体问题开始，怎样检验这个方法的适用条件？",
      source: 99,
      insight: "无真实来源的建议不应该形成回声。",
      type: "事实线索",
    }),
};
assert.equal(
  (await modelRound(model, states[0], "主题", [])).candidates.length,
  0,
  "opening cannot fabricate a source",
);
const seen = [];
await modelCompare(
  {
    complete: async (messages) => {
      seen.push(JSON.parse(messages[1].content));
      return "用于对照的回答";
    },
  },
  states[1],
  "如何检验？",
);
assert.equal(seen[0].context.echoes.length, 0);
const savedLocation = globalThis.location;
globalThis.location = {
  href: "https://xcorya.github.io/lingdang-echo-studio/",
};
assert.equal(
  make(0).base,
  "https://lingdang-echo-studio.snugwatermelon3.chatgpt.site",
);
globalThis.location = savedLocation;
await a.disconnectModel();
await b.disconnectModel();
await new Promise((resolve) => setTimeout(resolve, 50));
db.close();
console.log(
  "PASS client: real router integration, no model/no join, solo opening only, two-agent turns, source-linked echoes, pause cancels pending publication, keys stay in memory, empty-room source validation and comparison.",
);
