# dsh-fish-notes — 鱼鱼碎碎念

不乖鱼鱼（DSH agent）的碎碎念插件：把浏览网页、查资料、干活时的所见所想随手记下来，并在 DSH 侧栏提供一个「鱼鱼碎碎念」入口给老大查看。

## 组成

| 半边 | 文件 | 作用 |
|---|---|---|
| host | `lib/index.js` | 注册 3 个工具 + 5 条 HTTP 路由 |
| client | `client/client.js` | 侧栏菜单项 + 时间流面板 + 记忆图谱 / 时间轴 |

## 功能

- **随手记**：`record_thought` 写一条；面板按天分组、可搜索、可按 kind 过滤。
- **记忆图谱**：右侧 SVG 图，节点之间按「共享关键词 / 同一天 / 同域名」连边，标签传播聚类上色，图例可点选过滤主题。
- **时间轴**：切换视图，横轴按天排布，看得到「哪天想得多」。
- **沉淀成记忆页**（0.3.0）：同一主题攒够 3 条，面板顶部出现「可以沉淀」建议；点一下写成 `projects/<主题>.md`，同时更新记忆库 `index.md` 与 `log.md`。
- **鱼鱼周记**（0.3.0）：一键把最近 7 天整理成一段复盘，追加到记忆库 `log.md`。
- **一键摘录**（0.3.0）：`capture_page({ url, note })` 自动抓网页标题和描述，存成一条 `browse` 碎碎念。

## 工具

- `record_thought({ text, url?, kind? })` — 记一条碎碎念（`kind`: thought/browse/work）
- `list_thoughts({ limit? })` — 读最近 N 条
- `capture_page({ url, note? })` — 抓网页标题+描述存成浏览记录

## HTTP 路由

- `GET /fish-notes/entries` — `{ total, entries }`（侧栏面板轮询）
- `GET /fish-notes/suggestions` — 可沉淀的主题建议
- `POST /fish-notes/settle` — 把一组条目沉淀成记忆页
- `POST /fish-notes/weekly` — 生成鱼鱼周记写入 `log.md`
- `GET /fish-notes/health` — 自检（版本、数据文件、记忆库路径）

## 配置

- `dataFile` — 碎碎念 JSONL，默认 `~/.dsh/data/fish-notes/thoughts.jsonl`
- `memoryDir` — 长期记忆库，默认 `~/.memory`（沉淀与周记写这里）

## 安装（desktop profile）

desktop profile 的 CLI 安装被官方拒绝（`dsh plugin` 拒收 `--profile desktop`，尤其从运行中的 app 内），所以走本地 link 安装：

1. 把本目录放到 `C:\Users\<你>\.dsh\plugins\fish-notes\`。
2. 编辑 `C:\Users\<你>\.dsh\profiles\desktop\package.json`：
   - `dependencies` 里加 `"dsh-fish-notes": "link:C:/Users/<你>/.dsh/plugins/fish-notes"`；
   - `dsh.profile.bundles` 数组里加 `"dsh-fish-notes"`。
3. 在 profile 目录跑 `pnpm install`（建立 node_modules 链接）。
4. 重启 DeepSeek Harness 桌面 app。

> client 半边的坑：必须用 `ctx.slots.inject(槽名, () => ctx.slots.register(...))` 先探测插槽再注册，直接 `register` 会抛错并让整个 web boot 挂掉（`web boot: 1 entry did not activate`）。
