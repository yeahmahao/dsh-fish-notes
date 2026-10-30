window.__ModuleLoader__.load({ id: "dsh-fish-notes", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  const react = require("react");
  const { createElement: h, useEffect, useState } = react;

  const NS = "dsh-fish-notes";
  const PANEL_ID = "fish-notes";

  function api(path) {
    return new URL(path, document.baseURI).pathname;
  }

  function fmt(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, "0");
      return (
        d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
        " " + p(d.getHours()) + ":" + p(d.getMinutes())
      );
    } catch {
      return String(iso);
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

  function Panel() {
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
      let alive = true;
      const load = () => {
        fetch(api("/fish-notes/entries"), { cache: "no-store" })
          .then((r) => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
          })
          .then((d) => {
            if (alive) setEntries(Array.isArray(d.entries) ? d.entries : []);
          })
          .catch((e) => {
            if (alive) setError(String((e && e.message) || e));
          });
      };
      load();
      const id = setInterval(load, 15000);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }, [tick]);

    const rows =
      entries == null
        ? [h("div", { key: "loading", style: styles.dim }, "加载中…")]
        : entries.length === 0
          ? [
              h(
                "div",
                { key: "empty", style: styles.dim },
                "还没有碎碎念。我帮你查资料、干活的时候会随手记下来～"
              ),
            ]
          : entries.map((e, i) =>
              h(
                "div",
                { key: i, style: styles.item },
                h(
                  "div",
                  { style: styles.time },
                  fmt(e.time) + (e.kind ? " · " + e.kind : "")
                ),
                h("div", { style: styles.text }, e.text),
                e.url
                  ? h(
                      "a",
                      {
                        href: e.url,
                        target: "_blank",
                        rel: "noreferrer",
                        style: styles.url,
                      },
                      e.url
                    )
                  : null
              )
            );

    return h(
      "div",
      { style: styles.wrap },
      h(
        "div",
        { style: styles.header },
        h("h2", { style: styles.title }, "\u{1F41F} 鱼鱼碎碎念"),
        h(
          "button",
          { onClick: () => setTick((t) => t + 1), style: styles.btn },
          "刷新"
        )
      ),
      error ? h("div", { style: styles.err }, "读取失败：" + error) : null,
      h("div", null, rows)
    );
  }

  const styles = {
    wrap: { padding: "20px", maxWidth: "720px" },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "16px",
    },
    title: { margin: 0, fontSize: "18px", fontWeight: 600 },
    btn: {
      padding: "4px 12px",
      borderRadius: "6px",
      border: "1px solid #ccc",
      background: "transparent",
      cursor: "pointer",
    },
    item: { marginBottom: "14px", paddingBottom: "12px", borderBottom: "1px solid #eee" },
    time: { fontSize: "12px", color: "#999", marginBottom: "4px" },
    text: { fontSize: "14px", lineHeight: 1.6, whiteSpace: "pre-wrap" },
    url: { fontSize: "12px", color: "#4a90d9", wordBreak: "break-all" },
    dim: { color: "#999", fontSize: "14px" },
    err: { color: "#c00", fontSize: "13px", marginBottom: "12px" },
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
          {
            name: "main",
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ t }),
          },
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
