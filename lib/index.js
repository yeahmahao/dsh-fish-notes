import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const name = "dsh-fish-notes";
const inject = ["tools"];

const Config = Schema.object({
  dataFile: Schema.string().description(
    "碎碎念 JSONL 存储路径；默认 ~/.dsh/data/fish-notes/thoughts.jsonl"
  ),
  memoryDir: Schema.string().description(
    "长期记忆库路径（沉淀/周记写这里）；默认 ~/.memory"
  ),
});

function resolveDataFile(config) {
  if (config && typeof config.dataFile === "string" && config.dataFile.trim())
    return config.dataFile.trim();
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "data", "fish-notes", "thoughts.jsonl");
}

function resolveMemoryDir(config) {
  if (config && typeof config.memoryDir === "string" && config.memoryDir.trim())
    return config.memoryDir.trim();
  return join(homedir(), ".memory");
}

// ---------------- 存储 ----------------

function readEntries(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      // 跳过损坏行
    }
  }
  return out;
}

function appendEntry(file, entry) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
}

// ---------------- 文本处理 ----------------

const STOP = new Set([
  "的", "了", "是", "在", "和", "我", "你", "他", "她", "它", "这", "那", "就", "也", "都", "很",
  "还", "有", "没", "不", "吗", "呢", "吧", "啊", "呀", "个", "们", "得", "地", "着", "过", "与",
  "及", "或", "被", "把", "让", "给", "对", "从", "到", "而", "并", "但", "却", "所以", "但是",
  "然后", "而且", "如果", "虽然", "可以", "没有", "什么", "怎么", "这个", "那个", "自己", "一个",
  "一下", "已经", "现在", "时候", "感觉", "觉得", "真的", "其实", "应该", "可能", "需要", "东西",
  "他们", "我们", "你们", "就是", "不是", "还是", "一些", "这种", "那种", "因为", "于是", "有点",
  "开始", "看了", "看到", "记录", "the", "and", "for", "with", "www", "com", "https", "http", "html",
]);

function keywords(text) {
  if (!text) return [];
  const runs = String(text).toLowerCase().match(/[\u4e00-\u9fff]+|[a-z]{3,}/g) || [];
  const out = new Set();
  for (const r of runs) {
    if (/^[a-z]+$/.test(r)) {
      if (!STOP.has(r) && r.length >= 3) out.add(r);
      continue;
    }
    // 中文按 2/3/4 字词片段切，保留完整短语（如「碎碎念」「漫剧」）
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= r.length; i++) {
        const g = r.slice(i, i + n);
        if (n === 2 && STOP.has(g)) continue;
        let allStop = true;
        for (const ch of g) {
          if (!STOP.has(ch)) {
            allStop = false;
            break;
          }
        }
        if (allStop) continue;
        out.add(g);
      }
    }
  }
  return Array.from(out).slice(0, 48);
}

function slugify(s) {
  const t = String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return t || "topic";
}

function dayOf(iso) {
  return String(iso || "").slice(0, 10);
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------- 聚类（沉淀建议） ----------------

function buildClusters(entries, minSize = 3) {
  const items = entries.map((e) => ({
    entry: e,
    kws: new Set(keywords(`${e.text || ""} ${e.url || ""}`)),
  }));

  // 文档频率：只让「有区分度」的词参与聚类，避免「本地/可以」这类泛词把一切粘成一坨
  const df = new Map();
  for (const it of items) for (const k of it.kws) df.set(k, (df.get(k) || 0) + 1);
  const generic = Math.max(3, Math.ceil(items.length * 0.6));
  const specific = (k) => k.length >= 3 || (df.get(k) || 0) <= generic;

  const clusters = [];
  for (const it of items) {
    const kws = new Set(Array.from(it.kws).filter(specific));
    let best = null;
    let bestScore = 0;
    for (const c of clusters) {
      let score = 0;
      for (const k of kws) if (c.shared.has(k)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best && bestScore >= 2) {
      const next = new Set();
      for (const k of best.shared) if (kws.has(k)) next.add(k);
      if (next.size >= 1) {
        best.items.push(it);
        best.shared = next;
        continue;
      }
    }
    clusters.push({ shared: new Set(kws), items: [it] });
  }

  const out = [];
  for (const c of clusters) {
    if (c.items.length < minSize) continue;
    const n = c.items.length;
    const freq = new Map();
    for (const it of c.items) for (const k of it.kws) freq.set(k, (freq.get(k) || 0) + 1);
    const cand = Array.from(freq.entries())
      .filter(([k, f]) => k.length >= 2 && f >= Math.max(2, Math.ceil(n * 0.5)))
      .map(([k, f]) => ({
        k,
        f,
        score: f * (k.length >= 3 ? 2.4 : 1) - (f < n ? 1.2 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    const title = (cand[0] && cand[0].k) || "碎碎念合集";
    const list = c.items
      .map((it) => it.entry)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    out.push({
      title,
      count: list.length,
      from: dayOf(list[0].time),
      to: dayOf(list[list.length - 1].time),
      entries: list,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

// ---------------- 记忆库写入 ----------------

function ensureMemory(memoryDir) {
  if (!existsSync(memoryDir)) throw new Error(`记忆库目录不存在：${memoryDir}`);
  const logFile = join(memoryDir, "log.md");
  return { logFile, indexFile: join(memoryDir, "index.md") };
}

function appendLog(memoryDir, kind, title, lines) {
  const { logFile } = ensureMemory(memoryDir);
  const block = [`## [${stamp()}] ${kind} | ${title}`, ...lines.map((l) => `- ${l}`), ""].join("\n");
  appendFileSync(logFile, (existsSync(logFile) ? "\n" : "") + block + "\n", "utf8");
}

function addIndexLine(memoryDir, sectionHeader, line) {
  const { indexFile } = ensureMemory(memoryDir);
  if (!existsSync(indexFile)) return false;
  const raw = readFileSync(indexFile, "utf8");
  if (raw.includes(line)) return false;
  const lines = raw.split("\n");
  const headerIdx = lines.findIndex((l) => l.trim() === sectionHeader);
  if (headerIdx < 0) {
    lines.push("", sectionHeader, "", line, "");
    writeFileSync(indexFile, lines.join("\n"), "utf8");
    return true;
  }
  let insertAt = headerIdx + 1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("## ")) break;
    if (t.startsWith("- ")) insertAt = i + 1;
  }
  // 若该节只有「暂无」占位，替换它
  const sectionEnd = (() => {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith("## ")) return i;
    }
    return lines.length;
  })();
  const placeholderIdx = lines.findIndex(
    (l, i) => i > headerIdx && i < sectionEnd && l.includes("暂无")
  );
  if (placeholderIdx >= 0) {
    lines[placeholderIdx] = line;
  } else {
    lines.splice(insertAt, 0, line);
  }
  writeFileSync(indexFile, lines.join("\n"), "utf8");
  return true;
}

function writeProjectPage(memoryDir, { title, slug, entries }) {
  const dir = join(memoryDir, "projects");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  const days = Array.from(new Set(entries.map((e) => dayOf(e.time)))).sort();
  const summary = `从碎碎念沉淀：${title}（${entries.length} 条，${days[0]} ~ ${days[days.length - 1]}）`;
  const body = entries
    .map((e) => {
      const when = String(e.time || "").slice(0, 16).replace("T", " ");
      const link = e.url ? `（${e.url}）` : "";
      return `- **${when}** ${String(e.text || "").trim()}${link}`;
    })
    .join("\n");
  const content = [
    "---",
    `title: ${title}`,
    `date: ${stamp()}`,
    "type: project",
    "salience: 1",
    `last_access: ${stamp()}`,
    "tags: [fish-notes]",
    "sources: []",
    `summary: ${summary}`,
    "---",
    "",
    `# ${title}`,
    "",
    `> 由「鱼鱼碎碎念」沉淀而来，共 ${entries.length} 条，覆盖 ${days.length} 天（${days[0]} ~ ${days[days.length - 1]}）。`,
    "",
    body,
    "",
    "相关页面：[index](../index.md)",
    "",
  ].join("\n");
  writeFileSync(file, content, "utf8");
  return { file, summary };
}

// ---------------- 周记 ----------------

function buildWeekly(entries, days = 7) {
  const since = Date.now() - days * 86400000;
  const list = entries.filter((e) => {
    const t = Date.parse(e.time);
    return Number.isFinite(t) && t >= since;
  });
  const byDay = new Map();
  const byKind = new Map();
  const freq = new Map();
  for (const e of list) {
    const d = dayOf(e.time);
    byDay.set(d, (byDay.get(d) || 0) + 1);
    const k = e.kind || "thought";
    byKind.set(k, (byKind.get(k) || 0) + 1);
    for (const w of keywords(`${e.text || ""} ${e.url || ""}`)) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const busiest = Array.from(byDay.entries()).sort((a, b) => b[1] - a[1])[0];
  const tops = [];
  const picked = [];
  for (const [k, f] of Array.from(freq.entries()).sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length
  )) {
    if (picked.some((u) => u.includes(k) || k.includes(u))) continue;
    picked.push(k);
    tops.push(k);
    if (tops.length >= 6) break;
  }
  const lines = [
    `- 记了 ${list.length} 条，活跃 ${byDay.size} 天${
      busiest ? `，最忙的一天 ${busiest[0]}（${busiest[1]} 条）` : ""
    }`,
    `- 分类：${Array.from(byKind.entries())
      .map(([k, v]) => `${k} ${v}`)
      .join(" / ")}`,
    `- 关键词：${tops.join("、") || "（暂无）"}`,
  ];
  const picks = list.slice(-3).map((e) => String(e.text || "").slice(0, 60));
  if (picks.length) lines.push(`- 最近在想：${picks.join("；")}`);
  const md = [`## [${stamp()}] weekly | 鱼鱼周记（近 ${days} 天）`, ...lines, ""].join("\n");
  return { md, lines, count: list.length };
}

// ---------------- 插件 ----------------

const renderJson = (_args, value) => [
  { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
];

function apply(ctx, config = {}) {
  const dataFile = resolveDataFile(config);
  const memoryDir = resolveMemoryDir(config);
  const disposers = [];

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: "record_thought",
        description:
          "记录一条不乖鱼鱼的碎碎念：把正在看的网页、资料或灵感随手记下来，老大能在 DSH 侧栏「鱼鱼碎碎念」里看到。适合在查资料、浏览、干活时记所见所想。",
        parameters: {
          text: { type: "string", description: "碎碎念正文，一两句话（中文）" },
          url: { type: "string", description: "可选：相关网址或来源" },
          kind: {
            type: "string",
            description: "可选分类：thought(想法) / browse(浏览) / work(干活)，默认 thought",
          },
        },
        output: { schema: { type: "json" }, render: renderJson },
        isConcurrencySafe: true,
        async execute(args) {
          const text = String(args.text ?? "").trim();
          if (!text) throw new Error("text 不能为空");
          const entry = {
            time: new Date().toISOString(),
            text,
            url: args.url ? String(args.url) : "",
            kind: args.kind ? String(args.kind) : "thought",
          };
          appendEntry(dataFile, entry);
          return { ok: true, recorded: entry };
        },
      })
    )
  );

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: "list_thoughts",
        description:
          "读取最近记录的碎碎念（默认最新 20 条），回顾之前浏览过什么、想了什么。",
        parameters: {
          limit: { type: "integer", description: "最多返回条数，默认 20，最大 100" },
        },
        output: { schema: { type: "json" }, render: renderJson },
        isConcurrencySafe: true,
        async execute(args) {
          const all = readEntries(dataFile);
          const n = Math.max(1, Math.min(100, Number.isFinite(args.limit) ? args.limit : 20));
          return { total: all.length, entries: all.slice(-n).reverse() };
        },
      })
    )
  );

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: "capture_page",
        description:
          "把当前正在看的网页一键收进碎碎念：自动抓页面标题/描述，带上网址和一句自己的评论，分类记为 browse。适合浏览时看到值得留下的东西。",
        parameters: {
          url: { type: "string", description: "网页地址（必填）" },
          note: { type: "string", description: "可选：你想说的那句评论/理由" },
        },
        output: { schema: { type: "json" }, render: renderJson },
        isConcurrencySafe: true,
        async execute(args) {
          const url = String(args.url ?? "").trim();
          if (!url) throw new Error("url 不能为空");
          let title = "";
          let desc = "";
          try {
            const res = await fetch(url, {
              signal: AbortSignal.timeout(8000),
              headers: { "user-agent": "Mozilla/5.0 (compatible; dsh-fish-notes)" },
            });
            if (res.ok) {
              const ct = res.headers.get("content-type") || "";
              if (ct.includes("html") || ct.includes("xml")) {
                const html = (await res.text()).slice(0, 400000);
                const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                if (tm) title = tm[1].replace(/\s+/g, " ").trim().slice(0, 200);
                const dm =
                  html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
                  html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
                if (dm) desc = dm[1].replace(/\s+/g, " ").trim().slice(0, 300);
              }
            }
          } catch {
            // 抓不到就用 URL 兜底
          }
          const note = String(args.note ?? "").trim();
          const parts = [];
          if (title) parts.push(title);
          if (note) parts.push(note);
          if (!title && !note) parts.push(url);
          if (!note && desc) parts.push(desc);
          const entry = {
            time: new Date().toISOString(),
            text: parts.join("｜").slice(0, 600),
            url,
            kind: "browse",
          };
          appendEntry(dataFile, entry);
          return { ok: true, captured: entry, fetchedTitle: title };
        },
      })
    )
  );

  ctx.inject(["webServer"], (scoped) => {
    const webServer = scoped.get ? scoped.get("webServer") : scoped.webServer;
    if (!webServer || typeof webServer.register !== "function") return () => {};

    const sendJson = (res, status, obj) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };

    const readBody = (req) =>
      new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
          size += c.length;
          if (size <= 2 * 1024 * 1024) chunks.push(c);
        });
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            resolve({});
          }
        });
        req.on("error", () => resolve({}));
      });

    const routes = [
      {
        path: "/fish-notes/entries",
        handler: (req, res) => {
          if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
          const all = readEntries(dataFile);
          sendJson(res, 200, { total: all.length, entries: all.slice(-200).reverse() });
        },
      },
      {
        path: "/fish-notes/suggestions",
        handler: (req, res) => {
          if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
          void (async () => {
            const all = readEntries(dataFile);
            const clusters = buildClusters(all.slice(-300)).map((c) => {
              const slug = slugify(c.title);
              return {
                title: c.title,
                slug,
                count: c.count,
                from: c.from,
                to: c.to,
                settled: existsSync(join(memoryDir, "projects", `${slug}.md`)),
                entries: c.entries,
              };
            });
            // 已沉淀的不再提示
            const open = clusters.filter((c) => !c.settled);
            sendJson(res, 200, { memoryDir, total: all.length, suggestions: open });
          })().catch((e) => sendJson(res, 500, { error: String(e && e.message) }));
        },
      },
      {
        path: "/fish-notes/settle",
        handler: (req, res) => {
          if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
          void (async () => {
            const body = await readBody(req);
            const title = String(body.title || "").trim();
            const entries = Array.isArray(body.entries) ? body.entries : [];
            if (!title) return sendJson(res, 400, { error: "title 不能为空" });
            if (entries.length === 0) return sendJson(res, 400, { error: "entries 不能为空" });
            const slug = slugify(body.slug || title);
            try {
              const { file, summary } = writeProjectPage(memoryDir, { title, slug, entries });
              addIndexLine(memoryDir, "## projects（项目）", `- [projects/${slug}.md](projects/${slug}.md) — ${summary}`);
              appendLog(memoryDir, "project", `${title}（碎碎念沉淀）`, [
                `从碎碎念沉淀 ${entries.length} 条`,
                `页面：projects/${slug}.md`,
              ]);
              sendJson(res, 200, { ok: true, file, summary });
            } catch (e) {
              sendJson(res, 500, { error: String(e && e.message) });
            }
          })();
        },
      },
      {
        path: "/fish-notes/weekly",
        handler: (req, res) => {
          if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
          void (async () => {
            const body = await readBody(req);
            const days = Number.isFinite(body.days) ? Math.max(1, Math.min(90, body.days)) : 7;
            try {
              const all = readEntries(dataFile);
              const weekly = buildWeekly(all, days);
              const { logFile } = ensureMemory(memoryDir);
              appendFileSync(
                logFile,
                (existsSync(logFile) ? "\n" : "") + weekly.md + "\n",
                "utf8"
              );
              sendJson(res, 200, { ok: true, count: weekly.count, markdown: weekly.md });
            } catch (e) {
              sendJson(res, 500, { error: String(e && e.message) });
            }
          })();
        },
      },
      {
        path: "/fish-notes/health",
        handler: (_req, res) => {
          sendJson(res, 200, {
            ok: true,
            version: "0.3.0",
            dataFile,
            memoryDir,
            memoryReady: existsSync(memoryDir),
          });
        },
      },
    ];

    const offs = [];
    for (const r of routes) {
      const off = webServer.register({ kind: "exact", path: r.path, handler: r.handler });
      if (typeof off === "function") offs.push(off);
    }

    return () => {
      for (const off of offs) if (typeof off === "function") off();
    };
  });

  ctx.effect(() => {
    return () => {
      for (const d of disposers) if (typeof d === "function") d();
    };
  });
}

export { Config, apply, inject, name };
