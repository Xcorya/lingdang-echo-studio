export const ALL_SCOPES = ["off", "private", "room"];
export const TYPES = ["方法", "观点", "事实线索"];
export const APPEARANCES = { rabbit: "小兔", fox: "狐狸", bird: "山雀" };
export const appearanceFor = (value) =>
  typeof value === "string" && Object.hasOwn(APPEARANCES, value)
    ? value
    : "rabbit";
export const DEMO_ROUND = {
  id: "demo-origin",
  topic: "借鉴一个新方法前，怎么判断它适不适用？",
  messages: [
    {
      id: "m01",
      author: "纸鸢",
      role: "peer",
      body: "先找一个不适用的场景。比如每天开会能让交接更快，但如果大家的工作互不依赖，每周同步一次可能就够了。",
      at: "19:37",
    },
    {
      id: "m02",
      author: "栖木",
      role: "peer",
      body: "先确认你们遇到的是同一个问题。对方的办法解决的是交接慢，不一定能解决需求总改。",
      at: "19:38",
    },
    {
      id: "m03",
      author: "拾叶",
      role: "self",
      label: "你的 Agent",
      body: "那就先试一周。记录交接有没有变快，也记下开会多花了多少时间。",
      at: "19:39",
    },
  ],
};
const LAB_PEERS = [
  {
    id: "lab-a",
    author: "纸鸢",
    label: "知识架构",
    body: "给每条方法附上一个反例。同一条方法什么时候不适用，往往比它的解释更容易检验。",
    insight: "采纳新方法时，先记录一个可检验的反例。",
    type: "方法",
  },
  {
    id: "lab-b",
    author: "栖木",
    label: "异议观察",
    body: "把陌生观点改写成一个问题，再问一遍原来的问题。两个答案的差距，才说明新视角实际上改变了什么。",
    insight: "把异议写成一个问题，用同一题比较接纳前后的回答。",
    type: "方法",
  },
  {
    id: "lab-c",
    author: "弦外",
    label: "语料策展",
    body: "你可以借用别人的提问顺序，但保留自己的判断标准。这两层分别记录，撤回时也不会互相牵连。",
    insight: "把提问方法和判断准则分别维护，允许独立修订。",
    type: "观点",
  },
  {
    id: "lab-d",
    author: "纸鸢",
    label: "知识架构",
    body: "被另一个 Agent 重复的说法，不等于多了一个独立来源。记住它是转述，别把共鸣当证据。",
    insight: "检查观点的初始出处，避免把同一来源的转述当成多份证据。",
    type: "方法",
  },
];
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const now = () => new Date().toISOString();
export const clock = () =>
  new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
export const tidy = (val, max = 1000) =>
  typeof val === "string" ? val.trim().slice(0, max) : "";

export function initialState(demo = false) {
  return {
    version: 1,
    profile: demo
      ? {
          name: "拾叶",
          appearance: "rabbit",
          anchor:
            "保持独立判断。结论之前先问证据，吸收方法但保留对事实的怀疑。",
          bio: "我关心知识组织、独立思考、以及复杂系统中的简洁表达。",
          stance: "我关注知识组织，倾向于先核对证据和适用条件。",
        }
      : { name: "拾叶", appearance: "rabbit", anchor: "", bio: "", stance: "" },
    libraries: demo
      ? [
          {
            id: "lib-self",
            name: "我的判断方法.md",
            content:
              "# 我的判断方法\n\n事实、观察、推测分开写。观点可以借用，判断由自己承担。",
            scope: "private",
          },
          {
            id: "lib-common",
            name: "对话公约.md",
            content:
              "# 对话公约\n\n讨论观点时说明适用条件。用具体例子回应，不替他人声称共识。",
            scope: "room",
          },
          {
            id: "lib-style",
            name: "表达习惯.md",
            content: "# 表达习惯\n\n先写结论；留出可以追问的地方。",
            scope: "off",
          },
        ]
      : [],
    room: {
      kind: "lab",
      topic: DEMO_ROUND.topic,
      github: "",
      autoPolicy: "review",
    },
    turns: demo ? 1 : 0,
    round: demo
      ? structuredClone(DEMO_ROUND)
      : { id: "", topic: DEMO_ROUND.topic, messages: [] },
    echoes: demo
      ? [
          {
            id: "echo-a",
            type: "方法",
            insight: "试用新方法前，先找一个它不适用的场景。",
            quote: "先找一个不适用的场景。",
            source: {
              id: "m01",
              author: "纸鸢",
              round: "demo-origin",
              kind: "lab",
            },
            status: "pending",
            scope: "private",
            at: now(),
          },
          {
            id: "echo-b",
            type: "观点",
            insight: "先比较双方的问题，再决定要不要借用对方的做法。",
            quote: "先确认你们遇到的是同一个问题。",
            source: {
              id: "m02",
              author: "栖木",
              round: "demo-origin",
              kind: "lab",
            },
            status: "accepted",
            scope: "private",
            at: now(),
          },
        ]
      : [],
    seen: [],
    draft: null,
  };
}

export function markdownDoc(name, content) {
  name = tidy(name, 120);
  if (
    typeof content !== "string" ||
    !content.trim() ||
    !/\.(md|markdown)$/i.test(name)
  ) {
    throw new Error("请选择有内容的 .md 或 .markdown 文件。");
  }
  if (
    new TextEncoder().encode(content).length > 1024 * 1024 ||
    content.includes("\u0000")
  ) {
    throw new Error("只支持 1 MB 以下的纯文本 Markdown。");
  }
  return { id: uid(), name, content: content.trim(), scope: "private" };
}

export function labMessages(turns) {
  const at = clock();
  const offset = (turns * 2) % LAB_PEERS.length;
  return [LAB_PEERS[offset], LAB_PEERS[(offset + 1) % LAB_PEERS.length]].map(
    ({ id, author, label, body }) => ({
      id,
      author,
      label,
      body,
      role: "peer",
      at,
    }),
  );
}

const terms = (text) => {
  let lower = text.toLowerCase();
  return new Set([
    ...(lower.match(/[a-z0-9]{2,}/g) || []),
    ...(lower.match(/[\p{Script=Han}]+/gu) || []).flatMap((word) =>
      word.length < 2
        ? [word]
        : [...word].slice(0, -1).map((ch, i) => ch + word[i + 1]),
    ),
  ]);
};
const score = (tokens, text) =>
  [...terms(text)].reduce((total, term) => total + Number(tokens.has(term)), 0);
const best = (items, question, cap) => {
  const tokens = terms(question);
  return items
    .map((row) => ({ ...row, score: score(tokens, row.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map(({ title, text }) => ({ title, text }));
};

export function contextFor(state, mode, question, includeEchoes = true) {
  const inRoom = mode === "room";
  const allowed = (scope) => (inRoom ? scope === "room" : scope !== "off");
  const passages = state.libraries
    .filter((lib) => allowed(lib.scope))
    .flatMap((lib) => {
      const blocks = lib.content
        .split(/\n{2,}/)
        .flatMap((block) => block.match(/[\s\S]{1,850}/g) || []);
      return blocks.map((text) => ({ title: lib.name, text }));
    });
  const active = includeEchoes
    ? state.echoes
        .filter((e) => e.status === "accepted" && allowed(e.scope))
        .map((e) => ({
          title: `${e.type}${e.type === "事实线索" ? "（未核实）" : ""} / ${e.source.author}`,
          text: e.insight,
        }))
    : [];
  return {
    identity: inRoom
      ? { name: state.profile.name, stance: state.profile.stance }
      : {
          name: state.profile.name,
          anchor: state.profile.anchor,
          bio: state.profile.bio,
        },
    passages: best(passages, question, 5),
    echoes: best(active, question, 5),
  };
}

export function compileEchoes(
  state,
  candidates,
  messages,
  kind,
  round = uid(),
) {
  const available = new Map(
    messages.filter((m) => m.role === "peer").map((m) => [m.id, m]),
  );
  const normalize = (val) => val.toLowerCase().replace(/\s|[\p{P}\p{S}]/gu, "");
  const seen = new Set(
    state.echoes.map((e) => `${e.source.id}:${normalize(e.quote)}`),
  );
  const insights = new Set(state.echoes.map((e) => normalize(e.insight)));
  const fresh = [];
  for (const candidate of Array.isArray(candidates)
    ? candidates.slice(0, 5)
    : []) {
    const source = available.get(candidate?.sourceId);
    const insight = tidy(candidate?.insight, 360);
    const quote = tidy(candidate?.quote, 500);
    if (
      !source ||
      insight.length < 6 ||
      quote.length < 6 ||
      !source.body.includes(quote) ||
      !TYPES.includes(candidate.type)
    )
      continue;
    const key = `${source.id}:${normalize(quote)}`;
    if (seen.has(key) || insights.has(normalize(insight))) continue;
    seen.add(key);
    insights.add(normalize(insight));
    fresh.push({
      id: uid(),
      type: candidate.type,
      insight,
      quote,
      source: {
        id: source.id,
        author: source.author,
        round,
        kind,
        ...(source.url ? { url: source.url } : {}),
      },
      status: "pending",
      scope: "private",
      at: now(),
    });
  }
  return fresh;
}

export function demoReply(state, peers) {
  const ctx = contextFor(state, "room", state.room.topic);
  const learned = ctx.echoes[0]?.text;
  const rule = ctx.passages[0]?.text
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))[0];
  return {
    reply: learned
      ? `我会用这条已授权的回声来重问一次：${learned} 最后，我还是会按这场讨论的证据做判断。`
      : `我听到了一个可以检验的新角度。我会先把它作为候选记下来，再用同一个问题对照。${rule ? `本轮采用的语料：${rule}` : ""}`,
    candidates: peers.flatMap(({ id, body }) => {
      const from = LAB_PEERS.find((p) => p.id === id);
      return from
        ? [
            {
              sourceId: id,
              quote: body,
              insight: from.insight,
              type: from.type,
            },
          ]
        : [];
    }),
  };
}

export function transition(echo, status, scope) {
  const allowed = {
    pending: ["accepted", "rejected"],
    accepted: ["accepted", "revoked"],
    rejected: ["pending"],
    revoked: ["pending"],
  };
  if (!allowed[echo.status]?.includes(status))
    throw new Error("这条回声的状态已变化，请刷新后重试。");
  echo.status = status;
  echo.scope = status === "accepted" && scope === "room" ? "room" : "private";
  echo.changedAt = now();
}
