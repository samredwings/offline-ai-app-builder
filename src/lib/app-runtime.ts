import type { Tab, Theme, AIConfig } from "./types";

// Returns the full HTML document served at /a/$slug.
export function renderAppHTML(opts: {
  slug: string;
  title: string;
  theme: Theme;
  iconUrl: string | null;
  tabs: Tab[];
  manifestUrl: string;
  appDataEndpoint: string;
  ai: AIConfig;
}): string {
  const { title, theme: rawTheme, iconUrl, tabs, manifestUrl, appDataEndpoint, ai } = opts;
  const theme = sanitizeTheme(rawTheme);


  const safeTabs = tabs.map((t, i) => ({
    name: t.name || `Tab ${i + 1}`,
    icon: t.icon || "•",
    html: t.html || "",
  }));

  const tabsJSON = JSON.stringify(safeTabs);
  const aiJSON = JSON.stringify({
    runtime: ai.runtime,
    remoteEndpoint: ai.remoteEndpoint ?? null,
    remoteModel: ai.remoteModel ?? null,
    ondeviceModel: ai.ondeviceModel ?? null,
    proxyEndpoint: `/api/public/ai/${opts.slug}`,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHTML(title)}</title>
<link rel="manifest" href="${manifestUrl}" />
<meta name="theme-color" content="${theme.primary}" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="${escapeHTML(title)}" />
${iconUrl ? `<link rel="apple-touch-icon" href="${iconUrl}" />` : ""}
<script src="https://cdn.tailwindcss.com"></script>
<style>
  :root {
    --primary: ${theme.primary};
    --background: ${theme.background};
    --foreground: ${theme.foreground};
    --accent: ${theme.accent};
  }
  html, body { background: var(--background); color: var(--foreground); height: 100%; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding-bottom: 72px; }
  main { min-height: calc(100vh - 72px); }
  .gen-btn-primary { background: var(--primary); color: #fff; padding: .625rem 1rem; border-radius: .5rem; font-weight: 600; }
  .gen-card { background: color-mix(in oklab, var(--foreground) 4%, transparent); border: 1px solid color-mix(in oklab, var(--foreground) 10%, transparent); border-radius: .75rem; padding: 1rem; }
  .tabbar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--background); border-top: 1px solid color-mix(in oklab, var(--foreground) 10%, transparent); display: flex; padding-bottom: env(safe-area-inset-bottom, 0); }
  .tabbar a { flex: 1; padding: .75rem .25rem; text-align: center; color: color-mix(in oklab, var(--foreground) 60%, transparent); font-size: .75rem; line-height: 1.1; text-decoration: none; }
  .tabbar a.active { color: var(--primary); }
  .tabbar a .icon { display: block; font-size: 1.25rem; margin-bottom: 2px; }
  input, textarea, select { background: transparent; border: 1px solid color-mix(in oklab, var(--foreground) 20%, transparent); border-radius: .5rem; padding: .5rem .75rem; color: var(--foreground); width: 100%; }
</style>
</head>
<body>
<main id="app-main"><div class="p-6 text-center opacity-70">Loading…</div></main>
<nav class="tabbar" id="tabbar"></nav>
<script>
window.__APP_ENDPOINT__ = ${JSON.stringify(appDataEndpoint)};
window.__APP_SLUG__ = ${JSON.stringify(opts.slug)};
window.__AI_CONFIG__ = ${aiJSON};
(function(){
  try {
    var k = localStorage.getItem("__app_device_key__");
    if (!k) { k = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); localStorage.setItem("__app_device_key__", k); }
    window.__APP_DEVICE_KEY__ = k;
  } catch(e) {}
})();
window.appStorage = {
  async get(key, fallback) {
    try {
      var v = localStorage.getItem("app:" + key);
      return v == null ? fallback : JSON.parse(v);
    } catch(e) { return fallback; }
  },
  async set(key, value) {
    try { localStorage.setItem("app:" + key, JSON.stringify(value)); } catch(e) {}
  },
};

// Unified AI helper available inside every generated app as window.appAI.
// Routes by runtime: lovable (proxy), remote (user endpoint), on-device (Capacitor bridge).
window.appAI = (function(){
  var cfg = window.__AI_CONFIG__;

  async function chatLovable(messages, model){
    var r = await fetch(cfg.proxyEndpoint, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ messages: messages, model: model || undefined })
    });
    if (!r.ok) throw new Error("AI error " + r.status + ": " + await r.text());
    var j = await r.json();
    return j.content || "";
  }

  function getRemoteKey(){
    try { return localStorage.getItem("__ai_remote_key__") || ""; } catch(e) { return ""; }
  }

  async function chatRemote(messages, model){
    var endpoint = cfg.remoteEndpoint;
    if (!endpoint) throw new Error("Remote endpoint not configured");
    var key = getRemoteKey();
    var url = endpoint.replace(/\\/$/, "") + "/chat/completions";
    var r = await fetch(url, {
      method: "POST",
      headers: Object.assign(
        {"Content-Type": "application/json"},
        key ? {"Authorization": "Bearer " + key} : {}
      ),
      body: JSON.stringify({
        model: model || cfg.remoteModel || "default",
        messages: messages
      })
    });
    if (!r.ok) throw new Error("AI error " + r.status + ": " + await r.text());
    var j = await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  }

  async function chatOnDevice(messages){
    // Provided by the Capacitor APK shell via @capacitor-llama (or compatible plugin).
    // window.LlamaBridge.chat({ messages }) -> Promise<{ content: string }>
    var bridge = window.LlamaBridge || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Llama);
    if (!bridge || typeof bridge.chat !== "function") {
      throw new Error("On-device model not available. Install via the APK build to enable offline AI.");
    }
    var res = await bridge.chat({ messages: messages, model: cfg.ondeviceModel || undefined });
    return (res && res.content) || "";
  }

  return {
    runtime: cfg.runtime,
    setRemoteKey: function(k){ try { localStorage.setItem("__ai_remote_key__", k); } catch(e) {} },
    getRemoteKey: getRemoteKey,
    isReady: function(){
      if (cfg.runtime === "lovable") return true;
      if (cfg.runtime === "remote") return !!cfg.remoteEndpoint;
      if (cfg.runtime === "on-device") {
        var bridge = window.LlamaBridge || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Llama);
        return !!(bridge && bridge.chat);
      }
      return false;
    },
    chat: async function(messages, opts){
      opts = opts || {};
      if (cfg.runtime === "remote") return chatRemote(messages, opts.model);
      if (cfg.runtime === "on-device") {
        try { return await chatOnDevice(messages); }
        catch(e) {
          // Graceful fallback when opened in a plain browser, not the APK.
          if (cfg.remoteEndpoint) return chatRemote(messages, opts.model);
          return chatLovable(messages, opts.model);
        }
      }
      return chatLovable(messages, opts.model);
    }
  };
})();

const TABS = ${tabsJSON};

function renderTabbar(activeIdx){
  const bar = document.getElementById("tabbar");
  bar.innerHTML = TABS.map((t,i)=>'<a href="#/'+i+'" class="'+(i===activeIdx?"active":"")+'"><span class="icon">'+escapeHtml(t.icon)+'</span>'+escapeHtml(t.name)+'</a>').join("");
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function runScriptsIn(container){
  container.querySelectorAll("script").forEach(old => {
    const s = document.createElement("script");
    for (const a of old.attributes) s.setAttribute(a.name, a.value);
    s.textContent = old.textContent;
    old.replaceWith(s);
  });
}

function route(){
  let idx = parseInt((location.hash.match(/^#\\/(\\d+)/) || [])[1] || "0", 10);
  if (isNaN(idx) || idx < 0 || idx >= TABS.length) idx = 0;
  const main = document.getElementById("app-main");
  main.innerHTML = '<div class="px-4 pt-4">' + TABS[idx].html + '</div>';
  runScriptsIn(main);
  renderTabbar(idx);
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", route);
route();
</script>
</body>
</html>`;
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function safeColor(v: string, fallback: string): string {
  return typeof v === "string" && HEX_RE.test(v) ? v : fallback;
}
function sanitizeTheme(t: Theme): Theme {
  return {
    primary: safeColor(t?.primary, "#4f46e5"),
    background: safeColor(t?.background, "#ffffff"),
    foreground: safeColor(t?.foreground, "#0f172a"),
    accent: safeColor(t?.accent, "#a78bfa"),
  };
}

