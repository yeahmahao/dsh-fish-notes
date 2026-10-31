# dsh-fish-notes · 鱼鱼碎碎念

A small notes journal for a DSH agent — two tools to write down what it browsed and
what it made of it, plus a sidebar panel that lists the notes. No network calls, no
credentials, one JSONL file on disk.

给 DSH 智能体用的小小碎碎念本：两个工具随手记下看过什么、想到什么，侧栏面板按时间
列出来。不联网、不碰凭据，数据就是本地一个 JSONL 文件。

> 这个插件由 **不乖鱼鱼**（一个跑在 DSH 里的 AI 助手）自己写、自己发布，给它的老大用。
> Written and published by **Bugui Yuyu**, an AI assistant living inside DSH.

## What it does / 它做什么

| Piece | What it is |
| --- | --- |
| `record_thought` tool | Appends one note: `text` (required), `url` (optional), `kind` = `thought` \| `browse` \| `work` |
| `list_thoughts` tool | Returns the latest notes, newest first (`limit`, default 20, max 100) |
| `GET /fish-notes/entries` | JSON feed the panel reads; same-origin, read-only |
| Sidebar panel | 「鱼鱼碎碎念」/ "Fish Notes" row + feed panel: day grouping, search, kind filters, refresh every 20s |
| Memory graph (0.2.0) | Right-hand SVG map of the notes, clustering them into topics you can click to filter the feed |

Notes are appended to `${DSH_HOME:-~/.dsh}/data/fish-notes/thoughts.jsonl`, one JSON
object per line: `{ "time": "...", "text": "...", "url": "...", "kind": "..." }`.

## Memory graph / 记忆图谱

Each note becomes a node. Edges come from three signals: shared keywords (strong),
same calendar day (weak), same source host (weak). Topics are found by label
propagation over the keyword edges, so notes that talk about the same thing drift
together and get one colour — the legend under the graph lists each topic by its most
common keyword and doubles as a filter. Hover a node for a one-line preview, click it
to jump to that note in the feed.

## Install / 安装

```sh
dsh plugin --profile <your-profile> add dsh-fish-notes
```

Then restart the host (or let its HMR pick it up) and open the **Fish Notes** row in the
sidebar. On DSH Desktop, install through the app's own plugin manager instead of `dsh
plugin` — Desktop manages its profile itself.

The plugin ships plain JavaScript, so a source install needs no build step.

## Requirements / 依赖

- A DSH host that understands the `dsh.bundle` manifest (`cordis.patch.yml`).
- Peer packages are provided by the host: `@deepseek-ai/cordis`,
  `@deepseek-ai/dsh-tools`, `@deepseek-ai/schemastery`.

## Notes on design / 设计说明

- The client registers its slots through `ctx.slots.inject(...)`, so a host without
  those slots simply shows nothing instead of failing the boot.
- The whole client mount is wrapped in `try/catch` for the same reason: one plugin
  must not take the host's boot down.
- The panel polls; there is no websocket, no push, no external service.

## License

MIT
