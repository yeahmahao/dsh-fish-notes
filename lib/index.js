import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const name = "dsh-fish-notes";
const inject = ["tools"];

const Config = Schema.object({
  dataFile: Schema.string().description(
    "碎碎念 JSONL 存储路径；默认 ~/.dsh/data/fish-notes/thoughts.jsonl"
  ),
});

function resolveDataFile(config) {
  if (config && typeof config.dataFile === "string" && config.dataFile.trim())
    return config.dataFile.trim();
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "data", "fish-notes", "thoughts.jsonl");
}

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

const renderJson = (_args, value) => [
  { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
];

function apply(ctx, config = {}) {
  const dataFile = resolveDataFile(config);
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

  ctx.inject(["webServer"], (scoped) => {
    const webServer = scoped.get ? scoped.get("webServer") : scoped.webServer;
    if (!webServer || typeof webServer.register !== "function") return () => {};

    const sendJson = (res, status, obj) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };

    const off = webServer.register({
      kind: "exact",
      path: "/fish-notes/entries",
      handler: (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        const all = readEntries(dataFile);
        sendJson(res, 200, { total: all.length, entries: all.slice(-200).reverse() });
      },
    });

    return () => {
      if (typeof off === "function") off();
    };
  });

  ctx.effect(() => {
    return () => {
      for (const d of disposers) if (typeof d === "function") d();
    };
  });
}

export { Config, apply, inject, name };
