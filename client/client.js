window.__ModuleLoader__.load({ id: "dsh-fish-notes", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  const react = require("react");
  const { createElement: h, useEffect, useMemo, useRef, useState } = react;

  const NS = "dsh-fish-notes";
  const PANEL_ID = "fish-notes";

  const KINDS = [
    { id: "all", label: "全部" },
    { id: "thought", label: "想法" },
    { id: "browse", label: "浏览" },
    { id: "work", label: "干活" },
  ];
  const KIND_COLOR = { browse: "#4a90d9", work: "#d9822b", thought: "#7a5bd9" };
  const CLUSTER_COLORS = [
    "#4a90d9", "#d9822b", "#7a5bd9", "#2fa36b",
    "#c94f7c", "#b58a2b", "#3aa6b9", "#8a8f3a",
  ];

  function api(path) {
    return new URL(path, document.baseURI).pathname;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function fmt(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return (
        d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
      );
    } catch {
      return String(iso);
    }
  }

  function dayOf(iso) {
    if (!iso) return "";
    return String(iso).slice(0, 10);
  }

  function hostOf(url) {
    if (!url) return "";
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function Icon(props) {
    const size = (props && props.size) || 16;
    return h(
      "span",
      { style: { fontSize: size + "px", lineHeight: 1, fontFamily: "sans-serif" } },
      "\u{1F41F}"
    );
  }

  // ---------------- 文本 → 关键词 ----------------
  const STOP = new Set([
    "的", "了", "是", "在", "和", "我", "你", "他", "她", "它", "这", "那", "就", "也", "都", "很",
    "还", "有", "没", "不", "吗", "呢", "吧", "啊", "呀", "个", "们", "得", "地", "着", "过", "与",
    "及", "或", "被", "把", "让", "给", "对", "从", "到", "而", "并", "但", "却", "所以", "但是",
    "然后", "而且", "如果", "虽然", "可以", "没有", "什么", "怎么", "这个", "那个", "自己", "一个",
    "一下", "已经", "现在", "时候", "感觉", "觉得", "真的", "其实", "应该", "可能", "需要", "东西",
    "他们", "我们", "你们", "就是", "不是", "还是", "一些", "这种", "那种", "因为", "于是", "有点",
    "然后", "开始", "看了", "看到", "记录", "碎碎念", "the", "and", "for", "with", "www", "com",
    "https", "http", "html", "index", "video", "youtu",
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
      for (let i = 0; i + 2 <= r.length; i++) {
        const g = r.slice(i, i + 2);
        if (STOP.has(g)) continue;
        if (STOP.has(g[0]) && STOP.has(g[1])) continue;
        out.add(g);
      }
    }
    return Array.from(out).slice(0, 16);
  }

  // ---------------- 图：节点 / 连边 / 聚类 / 布局 ----------------
  function buildGraph(entries, W, H) {
    const list = entries.slice(0, 80);
    const nodes = list.map((e, i) => ({
      i,
      entry: e,
      kws: keywords((e.text || "") + " " + (e.url || "")),
      day: dayOf(e.time),
      host: hostOf(e.url),
      x: W / 2 + Math.cos((i / Math.max(1, list.length)) * Math.PI * 2) * (W * 0.3),
      y: H / 2 + Math.sin((i / Math.max(1, list.length)) * Math.PI * 2) * (H * 0.3),
      vx: 0,
      vy: 0,
    }));

    const byPair = new Map();
    function addEdge(a, b, kind, w) {
      if (a === b) return;
      const k = a < b ? a + ":" + b : b + ":" + a;
      const old = byPair.get(k);
      if (old) {
        old.w += w;
        if (kind === "kw") old.kw += w;
      } else {
        byPair.set(k, { a: Math.min(a, b), b: Math.max(a, b), w, kw: kind === "kw" ? w : 0 });
      }
    }

    for (let a = 0; a < nodes.length; a++) {
      const ka = new Set(nodes[a].kws);
      for (let b = a + 1; b < nodes.length; b++) {
        let shared = 0;
        for (const k of nodes[b].kws) if (ka.has(k)) shared++;
        if (shared > 0) addEdge(a, b, "kw", shared * 2);
        if (nodes[a].day && nodes[a].day === nodes[b].day) addEdge(a, b, "day", 1);
        if (nodes[a].host && nodes[a].host === nodes[b].host) addEdge(a, b, "host", 1);
      }
    }

    const edges = Array.from(byPair.values())
      .sort((x, y) => y.w - x.w)
      .slice(0, 180);

    const clusters = detectClusters(nodes, edges);

    // 力导向布局：斥力 + 弹簧 + 向心 + 简单碰撞
    for (let it = 0; it < 160; it++) {
      const cool = 1 - it / 190;
      for (let a = 0; a < nodes.length; a++) {
        const na = nodes[a];
        for (let b = a + 1; b < nodes.length; b++) {
          const nb = nodes[b];
          let dx = na.x - nb.x;
          let dy = na.y - nb.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (Math.random() - 0.5) * 0.1;
            dy = (Math.random() - 0.5) * 0.1;
            d2 = 1;
          }
          const f = 1100 / Math.max(60, d2);
          na.vx += dx * f; na.vy += dy * f;
          nb.vx -= dx * f; nb.vy -= dy * f;
          const d = Math.sqrt(d2);
          if (d < 26 && d > 0) {
            const push = (26 - d) * 0.06;
            na.vx += (dx / d) * push; na.vy += (dy / d) * push;
            nb.vx -= (dx / d) * push; nb.vy -= (dy / d) * push;
          }
        }
        na.vx += (W / 2 - na.x) * 0.0024;
        na.vy += (H / 2 - na.y) * 0.0024;
      }
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = 30 + 34 / (1 + e.kw);
        const f = ((d - target) / d) * 0.055 * cool;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const nd of nodes) {
        nd.vx *= 0.84; nd.vy *= 0.84;
        nd.x += Math.max(-22, Math.min(22, nd.vx));
        nd.y += Math.max(-22, Math.min(22, nd.vy));
        nd.x = Math.max(16, Math.min(W - 16, nd.x));
        nd.y = Math.max(16, Math.min(H - 16, nd.y));
      }
    }

    // 每个簇的代表词
    const clusterMap = new Map();
    nodes.forEach((nd) => {
      const c = clusters[nd.i];
      if (!clusterMap.has(c)) clusterMap.set(c, { id: c, count: 0, words: new Map() });
      const rec = clusterMap.get(c);
      rec.count++;
      for (const k of nd.kws) rec.words.set(k, (rec.words.get(k) || 0) + 1);
    });
    const clusterList = Array.from(clusterMap.values())
      .map((c) => {
        const top = Array.from(c.words.entries()).sort((a, b) => b[1] - a[1]);
        return { id: c.id, count: c.count, label: top.length ? top[0][0] : "其他" };
      })
      .sort((a, b) => b.count - a.count);

    return { nodes, edges, clusters, clusterList };
  }

  // 标签传播：关键词共现强的归为一簇
  function detectClusters(nodes, edges) {
    const adj = nodes.map(() => []);
    for (const e of edges) {
      if (e.kw > 0) {
        adj[e.a].push(e.b);
        adj[e.b].push(e.a);
      }
    }
    const label = nodes.map((_, i) => i);
    for (let it = 0; it < 14; it++) {
      let changed = false;
      for (let i = 0; i < nodes.length; i++) {
        if (!adj[i].length) continue;
        const cnt = new Map();
        for (const j of adj[i]) {
          const l = label[j];
          cnt.set(l, (cnt.get(l) || 0) + 1);
        }
        let best = label[i];
        let bc = -1;
        for (const [l, c] of cnt) {
          if (c > bc || (c === bc && l === label[i])) {
            bc = c;
            best = l;
          }
        }
        if (best !== label[i]) {
          label[i] = best;
          changed = true;
        }
      }
      if (!changed) break;
    }
    const map = new Map();
    let next = 0;
    return label.map((l) => {
      if (!map.has(l)) map.set(l, next++);
      return map.get(l);
    });
  }

  // ---------------- 图谱组件 ----------------
  function Graph(props) {
    const { entries, visible, sel, onSelect, clusterFilter, clusters } = props;
    const [hover, setHover] = useState(-1);
    const W = 440, H = 520;

    const g = useMemo(() => buildGraph(entries || [], W, H), [entries]);

    if (!entries || entries.length === 0) {
      return h("div", { style: styles.graphEmpty }, "还没有记忆，图谱是空的～");
    }

    const active = hover >= 0 ? hover : sel;
    const neigh = new Set();
    if (active >= 0) {
      neigh.add(active);
      for (const e of g.edges) {
        if (e.a === active) neigh.add(e.b);
        if (e.b === active) neigh.add(e.a);
      }
    }

    const lines = g.edges.map((e, k) => {
      const a = g.nodes[e.a], b = g.nodes[e.b];
      const on = active < 0 || e.a === active || e.b === active;
      return h("line", {
        key: "l" + k,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: on ? (e.kw > 0 ? "#8ea0b5" : "#c8ccd2") : "#ececec",
        strokeWidth: Math.min(2.6, 0.6 + e.w * 0.22),
        strokeDasharray: e.kw > 0 ? "none" : "3 3",
        opacity: on ? (e.kw > 0 ? 0.6 : 0.32) : 0.12,
      });
    });

    const circles = g.nodes.map((nd) => {
      const isVisible = visible ? visible.has(nd.i) : true;
      const inCluster = clusterFilter == null || clusters[nd.i] === clusterFilter;
      const dim = !isVisible || !inCluster;
      const on = active < 0 || neigh.has(nd.i);
      const color = CLUSTER_COLORS[clusters[nd.i] % CLUSTER_COLORS.length];
      return h(
        "g",
        {
          key: "c" + nd.i,
          style: { cursor: "pointer" },
          onMouseEnter: () => setHover(nd.i),
          onMouseLeave: () => setHover(-1),
          onClick: () => onSelect(nd.i),
        },
        // 大一点的透明命中区，鼠标轻微抖动不会掉出节点，避免悬浮闪烁
        h("circle", { cx: nd.x, cy: nd.y, r: 13, fill: "transparent", pointerEvents: "all" }),
        h("circle", {
          cx: nd.x,
          cy: nd.y,
          r: active === nd.i ? 7.5 : 4.4 + Math.min(2.2, nd.kws.length * 0.12),
          fill: dim ? "#cfcfcf" : color,
          opacity: dim ? 0.22 : on ? 0.95 : 0.3,
          stroke: active === nd.i ? "#111" : "rgba(255,255,255,0.9)",
          strokeWidth: active === nd.i ? 1.6 : 1,
          pointerEvents: "none",
        })
      );
    });

    const activeEntry = active >= 0 ? g.nodes[active] : null;

    return h(
      "div",
      { style: styles.graphWrap },
      h(
        "div",
        { style: styles.graphHead },
        h("span", { style: styles.graphTitle }, "记忆图谱"),
        h(
          "span",
          { style: styles.graphSub },
          g.nodes.length + " 节点 · " + g.edges.length + " 关联 · " + g.clusterList.length + " 主题"
        )
      ),
      h(
        "svg",
        {
          viewBox: "0 0 " + W + " " + H,
          preserveAspectRatio: "xMidYMid meet",
          style: { width: "100%", flex: "1 1 auto", minHeight: 0, display: "block" },
        },
        lines,
        circles
      ),
      // 固定高度的预览条：悬停时不改变布局，避免「出现→节点位移→鼠标离开→消失」的抖动
      h(
        "div",
        { style: styles.tip },
        activeEntry
          ? [
              h("div", { key: "t", style: styles.tipTime }, fmt(activeEntry.entry.time)),
              h(
                "div",
                { key: "x", style: styles.tipText },
                String(activeEntry.entry.text || "").slice(0, 120)
              ),
            ]
          : h("div", { style: styles.tipHint }, "悬停节点看一句预览，点一下跳到左边那条")
      )
    );
  }

  // ---------------- 主面板 ----------------
  function Panel() {
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState(null);
    const [tick, setTick] = useState(0);
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState("");
    const [kind, setKind] = useState("all");
    const [sel, setSel] = useState(-1);
    const [clusterSel, setClusterSel] = useState(null);
    const wrapRef = useRef(null);

    useEffect(() => {
      const fix = () => {
        const el = wrapRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.height < 140) {
          const avail = Math.max(280, window.innerHeight - rect.top - 20);
          el.style.height = avail + "px";
        }
      };
      fix();
      window.addEventListener("resize", fix);
      return () => window.removeEventListener("resize", fix);
    }, []);

    useEffect(() => {
      let alive = true;
      const load = (showBusy) => {
        if (showBusy) setBusy(true);
        fetch(api("/fish-notes/entries"), { cache: "no-store" })
          .then((r) => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
          })
          .then((d) => {
            if (!alive) return;
            setEntries(Array.isArray(d.entries) ? d.entries : []);
            setError(null);
          })
          .catch((e) => {
            if (alive) setError(String((e && e.message) || e));
          })
          .finally(() => {
            if (alive) setBusy(false);
          });
      };
      load(false);
      const id = setInterval(() => load(false), 20000);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }, [tick]);

    const list = entries || [];
    const graph = useMemo(() => buildGraph(list, 440, 520), [list]);

    // 过滤：关键词 + 类型 + 主题簇
    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      return list.filter((e, i) => {
        if (kind !== "all" && (e.kind || "thought") !== kind) return false;
        if (clusterSel != null && graph.clusters[i] !== clusterSel) return false;
        if (!q) return true;
        const hay = ((e.text || "") + " " + (e.url || "") + " " + (e.kind || "")).toLowerCase();
        return hay.indexOf(q) > -1;
      });
    }, [list, kind, query, clusterSel, graph]);

    const visibleSet = useMemo(() => {
      const s = new Set();
      list.forEach((e, i) => {
        if (filtered.indexOf(e) > -1) s.add(i);
      });
      return s;
    }, [filtered, list]);

    const today = dayOf(new Date().toISOString());
    const todayCount = list.filter((e) => dayOf(e.time) === today).length;

    // 按天分组
    const groups = useMemo(() => {
      const out = [];
      let cur = null;
      for (const e of filtered) {
        const d = dayOf(e.time);
        if (!cur || cur.day !== d) {
          cur = { day: d, items: [] };
          out.push(cur);
        }
        cur.items.push(e);
      }
      return out;
    }, [filtered]);

    const indexOf = (e) => list.indexOf(e);

    function pickNode(i) {
      setSel(i);
      const e = list[i];
      if (!e) return;
      setQuery("");
      setKind("all");
      setClusterSel(null);
      const id = "fish-note-" + dayOf(e.time) + "-" + i;
      setTimeout(() => {
        const el = document.getElementById(id);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
      }, 60);
    }

    const listView = [];
    for (const grp of groups) {
      listView.push(
        h("div", { key: "d" + grp.day, style: styles.dayHead }, grp.day || "未知日期")
      );
      for (const e of grp.items) {
        const i = indexOf(e);
        const k = e.kind || "thought";
        listView.push(
          h(
            "div",
            {
              key: "e" + i,
              id: "fish-note-" + dayOf(e.time) + "-" + i,
              style: Object.assign({}, styles.item, sel === i ? styles.itemSel : null),
            },
            h(
              "div",
              { style: styles.itemHead },
              h(
                "span",
                { style: Object.assign({}, styles.kindDot, { background: KIND_COLOR[k] || "#7a5bd9" }) }
              ),
              h("span", { style: styles.time }, fmt(e.time).slice(11)),
              e.url
                ? h("span", { style: styles.host }, hostOf(e.url))
                : null
            ),
            h("div", { style: styles.text }, e.text),
            e.url
              ? h(
                  "a",
                  { href: e.url, target: "_blank", rel: "noreferrer", style: styles.url },
                  e.url
                )
              : null
          )
        );
      }
    }

    return h(
      "div",
      { ref: wrapRef, style: styles.wrap },
      h(
        "div",
        { style: styles.header },
        h("h2", { style: styles.title }, "\u{1F41F} 鱼鱼碎碎念"),
        h(
          "div",
          { style: styles.headerRight },
          h("span", { style: styles.stat }, "共 " + list.length + " 条 · 今天 " + todayCount),
          h(
            "button",
            {
              onClick: () => setTick((t) => t + 1),
              style: Object.assign({}, styles.btn, busy ? styles.btnBusy : null),
              disabled: busy,
            },
            busy ? "刷新中" : "刷新"
          )
        )
      ),
      h(
        "div",
        { style: styles.toolbar },
        h("input", {
          value: query,
          onChange: (ev) => setQuery(ev.target.value),
          placeholder: "搜索碎碎念…",
          style: styles.search,
        }),
        h(
          "div",
          { style: styles.chips },
          KINDS.map((kk) =>
            h(
              "button",
              {
                key: kk.id,
                onClick: () => setKind(kk.id),
                style: Object.assign({}, styles.chip, kind === kk.id ? styles.chipOn : null),
              },
              kk.label
            )
          )
        )
      ),
      error ? h("div", { style: styles.err }, "读取失败：" + error) : null,
      h(
        "div",
        { style: styles.body },
        h(
          "div",
          { style: styles.list },
          list.length === 0
            ? h("div", { style: styles.dim }, "还没有碎碎念。我帮你查资料、干活的时候会随手记下来～")
            : filtered.length === 0
              ? h("div", { style: styles.dim }, "没有匹配的碎碎念")
              : listView
        ),
        h(
          "div",
          { style: styles.graphPane },
          h(Graph, {
            entries: list,
            visible: visibleSet,
            sel: sel,
            onSelect: pickNode,
            clusterFilter: clusterSel,
            clusters: graph.clusters,
          }),
          h(
            "div",
            { style: styles.legend },
            h(
              "button",
              {
                onClick: () => setClusterSel(null),
                style: Object.assign({}, styles.lgItem, clusterSel == null ? styles.lgOn : null),
              },
              "全部主题"
            ),
            graph.clusterList.slice(0, 8).map((c) =>
              h(
                "button",
                {
                  key: "cl" + c.id,
                  onClick: () => setClusterSel(clusterSel === c.id ? null : c.id),
                  style: Object.assign({}, styles.lgItem, clusterSel === c.id ? styles.lgOn : null),
                  title: "按主题过滤列表",
                },
                h(
                  "span",
                  {
                    style: Object.assign({}, styles.lgDot, {
                      background: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length],
                    })
                  }
                ),
                c.label + " " + c.count
              )
            )
          )
        )
      )
    );
  }

  const styles = {
    wrap: {
      height: "100%",
      maxHeight: "100%",
      boxSizing: "border-box",
      padding: "14px 18px 10px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "10px",
      flex: "0 0 auto",
    },
    headerRight: { display: "flex", alignItems: "center", gap: "10px" },
    title: { margin: 0, fontSize: "17px", fontWeight: 600 },
    stat: { fontSize: "12px", opacity: 0.6 },
    btn: {
      padding: "4px 12px",
      borderRadius: "6px",
      border: "1px solid rgba(127,127,127,0.45)",
      background: "transparent",
      cursor: "pointer",
      fontSize: "13px",
    },
    btnBusy: { opacity: 0.6, cursor: "default" },
    toolbar: { display: "flex", gap: "10px", alignItems: "center", margin: "10px 0", flex: "0 0 auto" },
    search: {
      flex: "1 1 auto",
      minWidth: 0,
      padding: "6px 10px",
      borderRadius: "7px",
      border: "1px solid rgba(127,127,127,0.35)",
      background: "transparent",
      color: "inherit",
      fontSize: "13px",
      outline: "none",
    },
    chips: { display: "flex", gap: "6px", flex: "0 0 auto" },
    chip: {
      padding: "5px 10px",
      borderRadius: "999px",
      border: "1px solid rgba(127,127,127,0.35)",
      background: "transparent",
      color: "inherit",
      fontSize: "12px",
      cursor: "pointer",
      opacity: 0.75,
    },
    chipOn: { opacity: 1, borderColor: "#4a90d9", color: "#4a90d9" },
    body: { flex: "1 1 auto", minHeight: 0, display: "flex", gap: "16px", overflow: "hidden" },
    list: {
      flex: "1 1 auto",
      minWidth: 0,
      minHeight: 0,
      overflowY: "auto",
      overflowX: "hidden",
      overscrollBehavior: "contain",
      paddingRight: "8px",
    },
    dayHead: {
      fontSize: "12px",
      fontWeight: 600,
      opacity: 0.55,
      margin: "6px 0 8px",
      letterSpacing: "0.02em",
    },
    item: {
      marginBottom: "12px",
      padding: "10px 12px",
      borderRadius: "9px",
      border: "1px solid rgba(127,127,127,0.16)",
    },
    itemSel: { borderColor: "#4a90d9", boxShadow: "0 0 0 1px rgba(74,144,217,0.35)" },
    itemHead: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" },
    kindDot: { width: "7px", height: "7px", borderRadius: "50%", display: "inline-block" },
    time: { fontSize: "12px", opacity: 0.55 },
    host: { fontSize: "11px", opacity: 0.45, marginLeft: "auto", maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    text: { fontSize: "14px", lineHeight: 1.6, whiteSpace: "pre-wrap" },
    url: { fontSize: "12px", color: "#4a90d9", wordBreak: "break-all" },
    dim: { opacity: 0.55, fontSize: "14px" },
    err: { color: "#c00", fontSize: "13px", marginBottom: "8px", flex: "0 0 auto" },
    graphPane: {
      flex: "0 0 44%",
      maxWidth: "470px",
      minWidth: "250px",
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      border: "1px solid rgba(127,127,127,0.2)",
      borderRadius: "10px",
      overflow: "hidden",
    },
    graphWrap: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 10px 4px" },
    graphHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", flex: "0 0 auto" },
    graphTitle: { fontSize: "12px", fontWeight: 600, opacity: 0.7 },
    graphSub: { fontSize: "11px", opacity: 0.5 },
    graphEmpty: { flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5, fontSize: "13px", padding: "20px", textAlign: "center" },
    tip: {
      flex: "0 0 auto",
      height: "52px",
      boxSizing: "border-box",
      borderTop: "1px solid rgba(127,127,127,0.16)",
      padding: "5px 0 0",
      overflow: "hidden",
      pointerEvents: "none",
    },
    tipHint: { fontSize: "11px", opacity: 0.4, paddingTop: "4px" },
    tipTime: { fontSize: "11px", opacity: 0.5 },
    tipText: { fontSize: "12px", lineHeight: 1.45, opacity: 0.85 },
    legend: { flex: "0 0 auto", display: "flex", flexWrap: "wrap", gap: "5px", padding: "6px 10px 8px", borderTop: "1px solid rgba(127,127,127,0.16)" },
    lgItem: { display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "999px", border: "1px solid rgba(127,127,127,0.28)", background: "transparent", color: "inherit", fontSize: "11px", cursor: "pointer", opacity: 0.75 },
    lgOn: { opacity: 1, borderColor: "#4a90d9", color: "#4a90d9" },
    lgDot: { width: "6px", height: "6px", borderRadius: "50%" },
  };

  const name = "dsh-fish-notes";
  const inject = ["slots", "locale"];

  function apply(ctx) {
    try {
      ctx.effect(
        () => ctx.locale.register(NS, { zh: { nav: "鱼鱼碎碎念" }, en: { nav: "Fish Notes" } }),
        "dsh-fish-notes: dictionaries"
      );
      const t = ctx.locale.bind(NS);

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          { name: "main", key: PANEL_ID, locale: NS, inject: () => ({ t }) },
          () => h(Panel)
        )
      );

      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 2,
            label: () => t("nav"),
            locale: NS,
          },
          (owner) => h(Icon, { size: (owner && owner.size) || 16 })
        )
      );
    } catch (error) {
      console.error("[dsh-fish-notes] mount failed:", error);
    }
  }

  exports.name = name;
  exports.inject = inject;
  exports.apply = apply;
  return module.exports;
}});
