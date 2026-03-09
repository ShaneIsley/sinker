// ==UserScript==
// @name         GitHub → Gitea Mirror
// @namespace    https://github.com/mirror-to-gitea
// @version      1.0.0
// @description  Mirror repositories from GitHub (and future providers) to a Gitea instance with full migrate API support.
// @author       You
// @match        https://github.com/*/*
// @exclude      https://github.com/*/*/*/*
// @exclude      https://github.com/orgs/*
// @exclude      https://github.com/settings/*
// @exclude      https://github.com/notifications*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════════════
  // §1  PROVIDER REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  const PROVIDERS = [];
  function registerProvider(p) { PROVIDERS.push(p); }
  function detectProvider()    { return PROVIDERS.find((p) => p.match()); }

  // ── GitHub provider ─────────────────────────────────────────────────────

  registerProvider({
    id: "github",
    name: "GitHub",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48
      10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93
      0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54
      c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2
      c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5
      4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
    </svg>`,

    match() { return location.hostname === "github.com"; },

    getRepoInfo() {
      const parts = location.pathname.replace(/^\/|\/$/g, "").split("/");
      if (parts.length < 2 || parts.length > 2) return null;
      return { owner: parts[0], repo: parts[1], full: `${parts[0]}/${parts[1]}` };
    },

    cloneUrl(info) { return `https://github.com/${info.full}.git`; },

    /** Detect if the current repo page shows a "Private" badge. */
    isRepoPrivate() {
      // GitHub renders a "Private" label next to the repo name
      const badges = document.querySelectorAll(
        '.Label--secondary, .Label--private, [data-content="Private"], .label-private'
      );
      for (const b of badges) {
        if (b.textContent.trim().toLowerCase() === "private") return true;
      }
      return false;
    },

    /** Find GitHub's action bar to insert our button group next to Star/Fork/Watch. */
    findTarget() {
      return (
        document.querySelector(".pagehead-actions") ||
        document.querySelector('[class*="react-"] ul.pagehead-actions') ||
        document.querySelector("div.d-flex.gap-2") ||
        document.querySelector("#repository-container-header ul") ||
        document.querySelector(".AppHeader-context")
      );
    },

    migrateCapabilities: {
      wiki:          { label: "Wiki",          default: true },
      issues:        { label: "Issues",        default: true },
      labels:        { label: "Labels",        default: true },
      milestones:    { label: "Milestones",    default: true },
      pull_requests: { label: "Pull Requests", default: true },
      releases:      { label: "Releases",      default: true },
      lfs:           { label: "Git LFS",       default: true },
    },

    authFields: [
      {
        key: "auth_token",
        label: "GitHub Personal Access Token",
        type: "password",
        placeholder: "ghp_xxxxxxxxxxxx",
        hint: "Required only for private repositories. Needs 'repo' scope.",
      },
    ],
  });

  // ── Future provider skeletons ───────────────────────────────────────────
  // registerProvider({ id: "gitlab", … });
  // registerProvider({ id: "gitea",  … });

  // ═══════════════════════════════════════════════════════════════════════════
  // §2  STYLES
  // ═══════════════════════════════════════════════════════════════════════════

  const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif`;

  GM_addStyle(`
    /* ── Split button group ──────────────────────────────────────────────── */
    #gtm-group {
      display: inline-flex; align-items: stretch;
      font-family: ${FONT};
      border: 1px solid rgba(240,246,252,0.1); border-radius: 6px;
      transition: border-color .15s;
    }
    #gtm-group:hover { border-color: #8b949e; }
    #gtm-group button {
      font-size: 12px; font-weight: 500; line-height: 20px;
      color: #c9d1d9; background: #21262d;
      border: none;
      cursor: pointer; font-family: inherit;
      transition: background .15s;
    }
    #gtm-group button:hover { background: #30363d; }
    #gtm-group button svg   { fill: currentColor; }

    /* Main button (left) */
    #gtm-mirror-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 12px;
      border-radius: 5px;
    }
    /* When chevron is visible, flatten the right side of main */
    #gtm-group.has-chevron #gtm-mirror-btn {
      border-top-right-radius: 0; border-bottom-right-radius: 0;
    }

    /* Chevron button (right) */
    #gtm-chevron {
      display: none;
      align-items: center; justify-content: center;
      padding: 3px 6px;
      border-top-right-radius: 5px; border-bottom-right-radius: 5px;
      border-top-left-radius: 0; border-bottom-left-radius: 0;
      border-left: 1px solid rgba(240,246,252,0.1);
    }
    #gtm-group.has-chevron #gtm-chevron { display: inline-flex; }

    /* Light theme */
    [data-color-mode="light"] #gtm-group {
      border-color: rgba(31,35,40,0.15);
    }
    [data-color-mode="light"] #gtm-group:hover { border-color: #8b949e; }
    [data-color-mode="light"] #gtm-group button {
      color: #24292f; background: #f6f8fa;
    }
    [data-color-mode="light"] #gtm-group button:hover { background: #e8ebef; }
    [data-color-mode="light"] #gtm-chevron { border-left-color: rgba(31,35,40,0.1); }

    /* Button feedback states */
    #gtm-mirror-btn.gtm-loading { opacity: 0.7; pointer-events: none; }
    #gtm-mirror-btn.gtm-success { background: #238636 !important; color: #fff !important; }
    #gtm-mirror-btn.gtm-error   { background: #da3633 !important; color: #fff !important; }

    /* ── Overlay + modal ─────────────────────────────────────────────────── */
    #gtm-overlay {
      position: fixed; inset: 0; z-index: 99999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(2px);
    }
    #gtm-modal {
      background: #0d1117; border: 1px solid #30363d; border-radius: 12px;
      width: 460px; max-width: 92vw; max-height: 88vh;
      overflow-y: auto; padding: 24px; color: #c9d1d9;
      font-family: ${FONT};
      box-shadow: 0 16px 48px rgba(0,0,0,0.4);
    }
    #gtm-modal h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #e6edf3; }
    #gtm-modal .gtm-subtitle { margin: 0 0 20px; font-size: 12px; color: #8b949e; }

    /* ── Form controls ───────────────────────────────────────────────────── */
    #gtm-modal label {
      display: block; margin-bottom: 4px; font-size: 12px; font-weight: 500; color: #e6edf3;
    }
    #gtm-modal input[type="text"],
    #gtm-modal input[type="url"],
    #gtm-modal input[type="password"],
    #gtm-modal select {
      width: 100%; padding: 6px 10px; margin-bottom: 14px; font-size: 13px;
      color: #c9d1d9; background: #161b22;
      border: 1px solid #30363d; border-radius: 6px;
      outline: none; box-sizing: border-box;
    }
    #gtm-modal input:focus, #gtm-modal select:focus {
      border-color: #388bfd; box-shadow: 0 0 0 2px rgba(56,139,253,0.25);
    }
    #gtm-modal .gtm-row     { display: flex; gap: 10px; }
    #gtm-modal .gtm-row>div  { flex: 1; }

    /* ── Modal buttons ───────────────────────────────────────────────────── */
    #gtm-modal .gtm-actions {
      display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px;
    }
    #gtm-modal button {
      padding: 5px 16px; font-size: 13px; font-weight: 500;
      border-radius: 6px; cursor: pointer; border: 1px solid transparent;
      font-family: inherit;
    }
    #gtm-modal .gtm-btn-secondary {
      color: #c9d1d9; background: #21262d; border-color: rgba(240,246,252,0.1);
    }
    #gtm-modal .gtm-btn-secondary:hover { background: #30363d; }
    #gtm-modal .gtm-btn-primary {
      color: #fff; background: #238636; border-color: rgba(240,246,252,0.1);
    }
    #gtm-modal .gtm-btn-primary:hover    { background: #2ea043; }
    #gtm-modal .gtm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    #gtm-modal .gtm-btn-link {
      color: #8b949e; background: none; border: none; padding: 0;
      font-size: 12px; text-decoration: underline; cursor: pointer;
    }
    #gtm-modal .gtm-btn-link:hover { color: #c9d1d9; }

    /* ── Collapsible sections ────────────────────────────────────────────── */
    #gtm-modal .gtm-collapse-toggle {
      display: flex; align-items: center; gap: 4px;
      background: none; border: none; color: #8b949e; cursor: pointer;
      font-size: 12px; font-weight: 500; padding: 4px 0; margin: 2px 0 8px;
      font-family: inherit;
    }
    #gtm-modal .gtm-collapse-toggle:hover { color: #c9d1d9; }
    #gtm-modal .gtm-collapse-toggle .arrow {
      transition: transform .15s; display: inline-block;
    }
    #gtm-modal .gtm-collapse-toggle.open .arrow { transform: rotate(90deg); }
    #gtm-modal .gtm-collapse-body { display: none; }
    #gtm-modal .gtm-collapse-body.open {
      display: block; padding: 10px 12px; margin-bottom: 14px;
      background: rgba(255,255,255,0.02); border: 1px solid #21262d;
      border-radius: 8px;
    }

    /* ── Checkboxes ──────────────────────────────────────────────────────── */
    #gtm-modal .gtm-check-row {
      display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
    }
    #gtm-modal .gtm-check-row input[type="checkbox"] { margin: 0; }
    #gtm-modal .gtm-check-row label { margin: 0; cursor: pointer; font-weight: 400; }
    #gtm-modal .gtm-check-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px;
    }

    /* ── Hint / divider / status ─────────────────────────────────────────── */
    #gtm-modal .gtm-hint { margin: -10px 0 12px; font-size: 11px; color: #6e7681; }
    #gtm-modal .gtm-divider { border: none; border-top: 1px solid #21262d; margin: 14px 0; }
    #gtm-status {
      margin-top: 12px; padding: 8px 10px; border-radius: 6px; font-size: 12px; display: none;
    }
    #gtm-status.success {
      display:block; background:rgba(35,134,54,0.15); border:1px solid rgba(35,134,54,0.4); color:#3fb950;
    }
    #gtm-status.error {
      display:block; background:rgba(248,81,73,0.1); border:1px solid rgba(248,81,73,0.4); color:#f85149;
    }
    #gtm-status.loading {
      display:block; background:rgba(56,139,253,0.1); border:1px solid rgba(56,139,253,0.4); color:#58a6ff;
    }
  `);

  // ═══════════════════════════════════════════════════════════════════════════
  // §3  PERSISTENT CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  const CONFIG_KEYS = ["giteaUrl", "giteaToken", "giteaOwner", "ownerType", "mirrorInterval"];
  const CONFIG_DEFAULTS = {
    giteaUrl: "", giteaToken: "", giteaOwner: "", ownerType: "user", mirrorInterval: "8h",
  };

  async function loadConfig() {
    const cfg = {};
    for (const k of CONFIG_KEYS) cfg[k] = await GM_getValue(k, CONFIG_DEFAULTS[k]);
    cfg.giteaUrl = (cfg.giteaUrl || "").replace(/\/+$/, "");
    return cfg;
  }

  async function saveConfig(cfg) {
    for (const k of CONFIG_KEYS) await GM_setValue(k, cfg[k]);
  }

  async function isConfigured() {
    const flag = await GM_getValue("gtmConfigured", false);
    if (flag) return true;
    // Backwards compat: if core fields exist from a prior version, treat as configured
    const url   = await GM_getValue("giteaUrl", "");
    const token = await GM_getValue("giteaToken", "");
    const owner = await GM_getValue("giteaOwner", "");
    if (url && token && owner) {
      await GM_setValue("gtmConfigured", true);
      return true;
    }
    return false;
  }

  async function markConfigured() {
    await GM_setValue("gtmConfigured", true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §4  GITEA API TRANSPORT
  // ═══════════════════════════════════════════════════════════════════════════

  function giteaRequest(method, url, token, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url,
        headers: { "Content-Type": "application/json", Authorization: `token ${token}` },
        data: data ? JSON.stringify(data) : undefined,
        onload(res) {
          let body;
          try { body = JSON.parse(res.responseText); } catch { body = res.responseText; }
          if (res.status >= 200 && res.status < 300) resolve({ status: res.status, body });
          else reject({ status: res.status, body, message: body?.message || res.responseText });
        },
        onerror() {
          reject({ status: 0, message: "Network error — is the Gitea URL reachable?" });
        },
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §5  UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  function escHTML(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function safeUrl(raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "http:" || u.protocol === "https:") return escHTML(raw);
    } catch {}
    return "#invalid-url";
  }

  function wireCollapse(toggle, body) {
    if (!toggle || !body) return;
    toggle.addEventListener("click", () => {
      const open = body.classList.toggle("open");
      toggle.classList.toggle("open", open);
    });
  }

  function mirrorIntervalOptions(selected) {
    return [
      ["10m","Every 10 minutes"], ["1h","Every hour"], ["8h","Every 8 hours"],
      ["24h","Daily"], ["48h","Every 2 days"], ["168h0m0s","Weekly"],
    ].map(([v,l]) => `<option value="${v}" ${v===selected?"selected":""}>${l}</option>`).join("\n");
  }

  /** Build a default Gitea migrate payload from stored config + provider defaults. */
  async function buildDefaultPayload(provider, repo, cfg) {
    const payload = {
      clone_addr:      provider.cloneUrl(repo),
      repo_name:       `${repo.owner}_${repo.repo}_${provider.id}`,
      repo_owner:      cfg.giteaOwner,
      service:         provider.id,
      mirror:          true,
      mirror_interval: cfg.mirrorInterval,
      description:     `Mirror of ${repo.full} (${provider.name})`,
      private:         false,
    };
    // Apply default capability flags
    for (const [key, def] of Object.entries(provider.migrateCapabilities || {})) {
      payload[key] = def.default;
    }
    // Load saved LFS endpoint
    const lfsEp = await GM_getValue("src_lfs_endpoint", "");
    if (lfsEp) payload.lfs_endpoint = lfsEp;

    return payload;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §6  SPLIT BUTTON — inject + manage
  // ═══════════════════════════════════════════════════════════════════════════

  const CHEVRON_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5"
          fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  function injectSplitButton(provider, onMain, onChevron, showChevron) {
    if (document.getElementById("gtm-group")) return;

    const group = document.createElement("span");
    group.id = "gtm-group";
    if (showChevron) group.classList.add("has-chevron");

    // Main button
    const main = document.createElement("button");
    main.id = "gtm-mirror-btn";
    main.title = "Mirror this repo to Gitea";
    main.innerHTML = `${provider.icon} Mirror to Gitea`;
    main.addEventListener("click", onMain);
    group.appendChild(main);

    // Chevron
    const chev = document.createElement("button");
    chev.id = "gtm-chevron";
    chev.title = "Mirror settings";
    chev.innerHTML = CHEVRON_SVG;
    chev.addEventListener("click", onChevron);
    group.appendChild(chev);

    const target = provider.findTarget();
    if (target) {
      const li = document.createElement("li");
      li.style.display = "inline-block";
      li.appendChild(group);
      target.prepend(li);
    } else {
      group.style.position = "fixed";
      group.style.top = "8px";
      group.style.right = "8px";
      group.style.zIndex = "9999";
      document.body.appendChild(group);
    }
  }

  function showChevron() {
    const g = document.getElementById("gtm-group");
    if (g) g.classList.add("has-chevron");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §7  QUICK MIRROR — one-click for public, one-time prompt for private
  // ═══════════════════════════════════════════════════════════════════════════

  async function quickMirror(provider) {
    const btn = document.getElementById("gtm-mirror-btn");
    if (!btn || btn.classList.contains("gtm-loading")) return;

    const repo = provider.getRepoInfo();
    if (!repo) return;
    const cfg = await loadConfig();

    const isPrivate = provider.isRepoPrivate?.() || false;

    if (isPrivate) {
      // Private repo — need a one-time token, show a small prompt
      promptForToken(provider, repo, cfg);
      return;
    }

    // Public repo — fire immediately
    await executeMirror(provider, repo, cfg, btn);
  }

  /** Fire the mirror API call and manage button feedback. */
  async function executeMirror(provider, repo, cfg, btn, authToken) {
    const originalHTML = btn.innerHTML;
    const resetBtn = (cls, label, delay) => {
      btn.className = cls ? `gtm-${cls}` : "";
      btn.innerHTML = `${provider.icon} ${label}`;
      if (delay) setTimeout(() => { btn.className = ""; btn.innerHTML = originalHTML; }, delay);
    };

    btn.classList.add("gtm-loading");
    btn.innerHTML = `${provider.icon} Mirroring…`;

    const payload = await buildDefaultPayload(provider, repo, cfg);
    if (authToken) payload.auth_token = authToken;

    try {
      const res = await giteaRequest(
        "POST", `${cfg.giteaUrl}/api/v1/repos/migrate`, cfg.giteaToken, payload
      );
      await markConfigured();
      showChevron();
      const url = res.body.html_url || `${cfg.giteaUrl}/${cfg.giteaOwner}/${payload.repo_name}`;
      resetBtn("success", `✓ Mirrored`, 4000);
      const openOnce = () => { window.open(safeUrl(url), "_blank"); btn.removeEventListener("click", openOnce); };
      btn.addEventListener("click", openOnce);
    } catch (err) {
      const msg = err?.body?.message || err?.message || "Unknown error";
      resetBtn("error", `✗ ${msg.length > 40 ? msg.slice(0, 40) + "…" : msg}`, 5000);
    }
  }

  /** Show a small modal prompting for a one-time source auth token (private repos). */
  function promptForToken(provider, repo, cfg) {
    if (document.getElementById("gtm-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "gtm-overlay";
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    const modal = document.createElement("div");
    modal.id = "gtm-modal";
    overlay.appendChild(modal);

    const field = provider.authFields?.[0] || {};

    modal.innerHTML = `
      <h2>🔒 Private Repository</h2>
      <p class="gtm-subtitle">
        <strong>${escHTML(repo.full)}</strong> is private.
        A one-time token is needed so Gitea can clone it. It will not be saved.
      </p>

      <label for="gtm-src-token">${escHTML(field.label || "Access Token")}</label>
      <input type="password" id="gtm-src-token"
             placeholder="${escHTML(field.placeholder || "")}" autofocus>
      ${field.hint ? `<p class="gtm-hint">${escHTML(field.hint)}</p>` : ""}

      <p class="gtm-hint" style="color:#d29922">
        ⚠ This token is sent to your Gitea instance (<strong>${escHTML(cfg.giteaUrl)}</strong>) and discarded immediately.
      </p>

      <div class="gtm-actions">
        <button class="gtm-btn-secondary" id="gtm-cancel">Cancel</button>
        <button class="gtm-btn-primary" id="gtm-go">Mirror</button>
      </div>
    `;

    const $ = (s) => modal.querySelector(s);

    $("#gtm-cancel").addEventListener("click", () => overlay.remove());

    $("#gtm-go").addEventListener("click", async () => {
      const token = $("#gtm-src-token").value.trim();
      if (!token) return;
      overlay.remove();

      const btn = document.getElementById("gtm-mirror-btn");
      if (btn) await executeMirror(provider, repo, cfg, btn, token);
    });

    // Allow Enter to submit
    $("#gtm-src-token").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#gtm-go").click();
    });

    document.body.appendChild(overlay);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §8  SETTINGS MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  async function openSettingsModal(provider) {
    if (document.getElementById("gtm-overlay")) return;

    const cfg = await loadConfig();
    const repo = provider.getRepoInfo();

    const overlay = document.createElement("div");
    overlay.id = "gtm-overlay";
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    const modal = document.createElement("div");
    modal.id = "gtm-modal";
    overlay.appendChild(modal);

    const setStatus = (type, html) => {
      const el = modal.querySelector("#gtm-status");
      if (!el) return;
      el.className = type;
      el.innerHTML = html;
    };

    const caps = provider.migrateCapabilities || {};

    // Build capability checkboxes
    const capCheckboxes = Object.entries(caps)
      .map(([k, v]) => `
        <div class="gtm-check-row">
          <input type="checkbox" id="gtm-cap-${k}" ${v.default ? "checked" : ""}>
          <label for="gtm-cap-${k}">${escHTML(v.label)}</label>
        </div>`)
      .join("");

    const hasLfs = !!caps.lfs;
    const lfsExtra = hasLfs ? `
      <div id="gtm-lfs-endpoint-wrap" style="display:none;margin-top:6px">
        <label for="gtm-lfs-endpoint">Custom LFS Endpoint</label>
        <input type="text" id="gtm-lfs-endpoint"
               placeholder="https://…/info/lfs  (leave blank for default)">
      </div>` : "";

    modal.innerHTML = `
      <h2>⚙️ Mirror Settings</h2>
      <p class="gtm-subtitle">Saved locally in your userscript manager storage.
        Your Gitea API token is stored in plaintext by your browser extension.</p>
      <label for="gtm-url">Gitea Instance URL</label>
      <input type="url" id="gtm-url" placeholder="https://gitea.example.com"
             value="${escHTML(cfg.giteaUrl)}">

      <label for="gtm-token">Gitea API Token</label>
      <input type="password" id="gtm-token" placeholder="your-gitea-api-token"
             value="${escHTML(cfg.giteaToken)}">

      <div class="gtm-row">
        <div>
          <label for="gtm-owner">Destination Owner</label>
          <input type="text" id="gtm-owner" placeholder="username or org"
                 value="${escHTML(cfg.giteaOwner)}">
        </div>
        <div>
          <label for="gtm-owner-type">Owner Type</label>
          <select id="gtm-owner-type">
            <option value="user" ${cfg.ownerType==="user"?"selected":""}>User</option>
            <option value="org"  ${cfg.ownerType==="org" ?"selected":""}>Organization</option>
          </select>
        </div>
      </div>

      <label for="gtm-interval">Default Mirror Sync Interval</label>
      <select id="gtm-interval">
        ${mirrorIntervalOptions(cfg.mirrorInterval)}
      </select>

      <hr class="gtm-divider">

      <!-- ▸ Default Import Options -->
      <button class="gtm-collapse-toggle" id="gtm-toggle-caps" type="button">
        <span class="arrow">▶</span> Default Import Options
      </button>
      <div class="gtm-collapse-body" id="gtm-caps-body">
        <p class="gtm-hint" style="margin:0 0 10px">
          These defaults are used when mirroring with the main button.
        </p>
        <div class="gtm-check-grid">
          ${capCheckboxes}
        </div>
        ${lfsExtra}
      </div>

      <!-- ▸ Source Authentication -->
      <!-- Source tokens are NOT saved — they are prompted one-time for private repos -->

      <div class="gtm-actions">
        <button class="gtm-btn-secondary" id="gtm-cancel">Cancel</button>
        <button class="gtm-btn-primary" id="gtm-save-cfg">Save</button>
      </div>
      <div id="gtm-status"></div>
    `;

    const $ = (s) => modal.querySelector(s);

    // Wire collapsibles
    wireCollapse($("#gtm-toggle-caps"), $("#gtm-caps-body"));

    if (hasLfs) {
      const lfsCheck = $("#gtm-cap-lfs");
      const lfsWrap  = $("#gtm-lfs-endpoint-wrap");
      const sync = () => { if (lfsWrap) lfsWrap.style.display = lfsCheck.checked ? "block" : "none"; };
      lfsCheck.addEventListener("change", sync);
      sync();
    }

    $("#gtm-cancel").addEventListener("click", () => overlay.remove());

    $("#gtm-save-cfg").addEventListener("click", async () => {
      cfg.giteaUrl       = $("#gtm-url").value.trim().replace(/\/+$/, "");
      cfg.giteaToken     = $("#gtm-token").value.trim();
      cfg.giteaOwner     = $("#gtm-owner").value.trim();
      cfg.ownerType      = $("#gtm-owner-type").value;
      cfg.mirrorInterval = $("#gtm-interval").value;

      // Save capability defaults back to the provider definition
      for (const key of Object.keys(caps)) {
        const el = $(`#gtm-cap-${key}`);
        if (el) caps[key].default = el.checked;
      }

      // LFS endpoint
      if (hasLfs) {
        const ep = $("#gtm-lfs-endpoint")?.value.trim();
        await GM_setValue("src_lfs_endpoint", ep || "");
      }

      await saveConfig(cfg);
      setStatus("success", "Settings saved.");
      setTimeout(() => overlay.remove(), 800);
    });

    document.body.appendChild(overlay);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §9  FIRST-RUN MODAL — settings + immediate mirror
  // ═══════════════════════════════════════════════════════════════════════════

  async function openFirstRunModal(provider) {
    if (document.getElementById("gtm-overlay")) return;

    const cfg = await loadConfig();
    const repo = provider.getRepoInfo();
    if (!repo) return;

    const overlay = document.createElement("div");
    overlay.id = "gtm-overlay";
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    const modal = document.createElement("div");
    modal.id = "gtm-modal";
    overlay.appendChild(modal);

    const setStatus = (type, html) => {
      const el = modal.querySelector("#gtm-status");
      if (!el) return;
      el.className = type;
      el.innerHTML = html;
    };

    modal.innerHTML = `
      <h2>⚙️ Gitea Setup</h2>
      <p class="gtm-subtitle">Configure your Gitea instance, then mirror this repo.
        Your Gitea API token is stored in plaintext by your browser extension.</p>

      <label for="gtm-url">Gitea Instance URL</label>
      <input type="url" id="gtm-url" placeholder="https://gitea.example.com"
             value="${escHTML(cfg.giteaUrl)}">

      <label for="gtm-token">Gitea API Token</label>
      <input type="password" id="gtm-token" placeholder="your-gitea-api-token"
             value="${escHTML(cfg.giteaToken)}">

      <div class="gtm-row">
        <div>
          <label for="gtm-owner">Destination Owner</label>
          <input type="text" id="gtm-owner" placeholder="username or org"
                 value="${escHTML(cfg.giteaOwner)}">
        </div>
        <div>
          <label for="gtm-owner-type">Owner Type</label>
          <select id="gtm-owner-type">
            <option value="user" ${cfg.ownerType==="user"?"selected":""}>User</option>
            <option value="org"  ${cfg.ownerType==="org" ?"selected":""}>Organization</option>
          </select>
        </div>
      </div>

      <label for="gtm-interval">Mirror Sync Interval</label>
      <select id="gtm-interval">
        ${mirrorIntervalOptions(cfg.mirrorInterval)}
      </select>

      <div class="gtm-actions">
        <button class="gtm-btn-secondary" id="gtm-cancel">Cancel</button>
        <button class="gtm-btn-primary" id="gtm-go">Save & Mirror</button>
      </div>
      <div id="gtm-status"></div>
    `;

    const $ = (s) => modal.querySelector(s);

    $("#gtm-cancel").addEventListener("click", () => overlay.remove());

    $("#gtm-go").addEventListener("click", async () => {
      const btn = $("#gtm-go");

      // Gather & validate
      cfg.giteaUrl       = $("#gtm-url").value.trim().replace(/\/+$/, "");
      cfg.giteaToken     = $("#gtm-token").value.trim();
      cfg.giteaOwner     = $("#gtm-owner").value.trim();
      cfg.ownerType      = $("#gtm-owner-type").value;
      cfg.mirrorInterval = $("#gtm-interval").value;

      if (!cfg.giteaUrl || !cfg.giteaToken || !cfg.giteaOwner) {
        setStatus("error", "Please fill in all fields.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Saving & mirroring…";
      await saveConfig(cfg);
      setStatus("loading", "Creating mirror on Gitea…");

      const payload = await buildDefaultPayload(provider, repo, cfg);

      try {
        const res = await giteaRequest(
          "POST", `${cfg.giteaUrl}/api/v1/repos/migrate`, cfg.giteaToken, payload
        );
        await markConfigured();
        showChevron();

        const url = res.body.html_url || `${cfg.giteaUrl}/${cfg.giteaOwner}/${payload.repo_name}`;
        setStatus(
          "success",
          `Mirror created! <a href="${safeUrl(url)}" target="_blank" rel="noopener"
            style="color:inherit;text-decoration:underline;">Open on Gitea →</a>`
        );
        btn.textContent = "✓ Done";
        setTimeout(() => overlay.remove(), 3000);
      } catch (err) {
        const msg = err?.body?.message || err?.message || "Unknown error";
        setStatus("error", `Failed: ${escHTML(msg)}`);
        btn.disabled = false;
        btn.textContent = "Save & Retry";
      }
    });

    document.body.appendChild(overlay);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §10  BOOTSTRAP + SPA OBSERVER
  // ═══════════════════════════════════════════════════════════════════════════

  let isInitializing = false;

  async function init() {
    if (isInitializing) return;
    isInitializing = true;

    try {
      const provider = detectProvider();
      if (!provider) return;
      const repo = provider.getRepoInfo();
      if (!repo) return;

      const configured = await isConfigured();

      const onMain = configured
        ? () => quickMirror(provider)
        : () => openFirstRunModal(provider);

      const onChevron = () => openSettingsModal(provider);

      injectSplitButton(provider, onMain, onChevron, configured);
    } finally {
      isInitializing = false;
    }
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById("gtm-group") && !isInitializing) init();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  init();
})();
