# Sinker: GitHub → Gitea Mirror Userscript — Code Walkthrough

*2026-03-15T01:02:56Z by Showboat 0.6.1*
<!-- showboat-id: 60dc0d0b-2ad3-4ead-b722-5d90cf4abfc5 -->

Sinker is a browser userscript (846 lines, zero external dependencies) that adds a one-click **Mirror to Gitea** button to every GitHub repository page. When clicked, it calls the Gitea migrate API to create a live mirror — syncing commits, issues, PRs, releases, labels, milestones, the wiki, and Git LFS — directly from the browser.

The entire script lives in a single file, `gitea-mirror.user.js`, wrapped in a strict-mode IIFE. Its ten logical sections are clearly delimited with banner comments and work in a linear pipeline:

  §1  Provider Registry   → detect which git forge is loaded  
  §2  Styles              → inject dark-/light-mode CSS  
  §3  Persistent Config   → read/write settings via GM storage  
  §4  Gitea API Transport → one authenticated HTTP helper  
  §5  Utility Functions   → XSS-safe escaping and shared helpers  
  §6  Split Button        → inject the UI element into GitHub's toolbar  
  §7  Quick Mirror        → the main one-click flow  
  §8  Settings Modal      → full configuration UI  
  §9  First-Run Modal     → initial setup wizard  
  §10 Bootstrap + SPA     → init() + MutationObserver for SPA navigation

We walk through each section in order below.

## §1 · Provider Registry (lines 22–100)

The script is designed to support multiple source forges (GitHub, GitLab, Gitea, etc.) via a simple plugin registry. Two tiny functions manage it:

```bash
sed -n '26,28p' gitea-mirror.user.js
```

```output
  const PROVIDERS = [];
  function registerProvider(p) { PROVIDERS.push(p); }
  function detectProvider()    { return PROVIDERS.find((p) => p.match()); }
```

Each provider is a plain object pushed into the `PROVIDERS` array. `detectProvider()` walks the array and returns the first whose `match()` predicate is true for the current page.

Currently only GitHub is registered. Its provider object has five responsibilities:

- **`match()`** — returns true when `location.hostname === "github.com"`  
- **`getRepoInfo()`** — parses the URL path into `{ owner, repo, full }`  
- **`cloneUrl(info)`** — returns the HTTPS clone URL  
- **`isRepoPrivate()`** — inspects the DOM for a "Private" badge  
- **`findTarget()`** — locates GitHub's action bar where the button will be injected

It also carries two static data objects consumed later:

```bash
sed -n '44,95p' gitea-mirror.user.js
```

```output
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
```

`migrateCapabilities` declares which Gitea migration flags this provider supports and their defaults. `authFields` describes any credential fields needed for private repos — both are read by later sections to build UI and API payloads dynamically.

The two commented-out lines at the bottom signal where future providers would plug in — no other code needs to change.

## §2 · Styles (lines 103–268)

All CSS is injected at startup via `GM_addStyle()`. There are no external stylesheets and no class name collisions — every selector is prefixed with `#gtm-` or `[data-color-mode]`.

The stylesheet covers five concerns:

```bash
grep -n '/\* ──' gitea-mirror.user.js | head -20
```

```output
109:    /* ── Split button group ──────────────────────────────────────────────── */
165:    /* ── Overlay + modal ─────────────────────────────────────────────────── */
181:    /* ── Form controls ───────────────────────────────────────────────────── */
200:    /* ── Modal buttons ───────────────────────────────────────────────────── */
224:    /* ── Collapsible sections ────────────────────────────────────────────── */
243:    /* ── Checkboxes ──────────────────────────────────────────────────────── */
253:    /* ── Hint / divider / status ─────────────────────────────────────────── */
```

1. **Split button group** (`#gtm-group`, `#gtm-mirror-btn`, `#gtm-chevron`) — an `inline-flex` container styled to match GitHub's own action buttons.  
2. **Light/dark theme** — a `[data-color-mode="light"]` block overrides every colour. GitHub sets this attribute on `<html>`, so the script inherits the user's system preference without any JS logic.  
3. **Button feedback states** — `.gtm-loading`, `.gtm-success`, `.gtm-error` swap background colours to signal in-flight requests and results.  
4. **Overlay + modal** — a full-screen dimmed backdrop (`#gtm-overlay`) with a centred card (`#gtm-modal`).  
5. **Form controls, checkboxes, collapsibles, status banner** — all scoped inside `#gtm-modal` so they can't affect the host page.

The light-mode override block shows the pattern clearly:

```bash
sed -n '150,158p' gitea-mirror.user.js
```

```output
    [data-color-mode="light"] #gtm-group {
      border-color: rgba(31,35,40,0.15);
    }
    [data-color-mode="light"] #gtm-group:hover { border-color: #8b949e; }
    [data-color-mode="light"] #gtm-group button {
      color: #24292f; background: #f6f8fa;
    }
    [data-color-mode="light"] #gtm-group button:hover { background: #e8ebef; }
    [data-color-mode="light"] #gtm-chevron { border-left-color: rgba(31,35,40,0.1); }
```

## §3 · Persistent Config (lines 270–306)

Settings are stored in the userscript manager's sandboxed key-value store via `GM_getValue` / `GM_setValue` — never in `localStorage` (which the host page can read) and never on any server.

```bash
sed -n '274,306p' gitea-mirror.user.js
```

```output
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
```

Five keys are persisted: `giteaUrl`, `giteaToken`, `giteaOwner`, `ownerType`, and `mirrorInterval`.

`loadConfig()` fetches all five in one loop, then strips any trailing slash from the URL — ensuring API paths like `/api/v1/repos/migrate` concatenate cleanly.

`isConfigured()` drives the first-run vs. normal-use branch in `init()`. It checks a dedicated `gtmConfigured` flag first. The backwards-compat fallback at the bottom lets users who installed an earlier version skip the setup wizard if they already have working credentials saved.

## §4 · Gitea API Transport (lines 308–329)

Browsers block cross-origin `fetch()` requests, so the script must use `GM_xmlhttpRequest` — the userscript manager's privileged HTTP function that bypasses CORS. This section wraps it in a Promise-based helper:

```bash
sed -n '312,329p' gitea-mirror.user.js
```

```output
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
```

`giteaRequest()` is the only function that touches the network. Every call sends a `token ` authorization header (Gitea's API token scheme), JSON-encodes the body if present, and converts the callback-based `GM_xmlhttpRequest` into a clean async/await interface.

On `onload`, it parses the response as JSON (falling back to raw text) and resolves for 2xx status codes or rejects with a structured error object for anything else. `onerror` handles network failures, producing a user-friendly message if Gitea is unreachable.

## §5 · Utility Functions (lines 331–385)

Five helpers used throughout the script:

```bash
sed -n '335,385p' gitea-mirror.user.js
```

```output
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
```

**`escHTML(s)`** — the security workhorse. It creates a transient `<div>`, assigns user-controlled text as `textContent` (which the browser escapes automatically), then reads back `innerHTML`. This prevents XSS when injecting API responses or user input into modal HTML strings.

**`safeUrl(raw)`** — validates that a URL uses only `http:` or `https:` before embedding it in an `<a href>`. Returns the sentinel `"#invalid-url"` otherwise, preventing `javascript:` or `data:` injections.

**`wireCollapse(toggle, body)`** — attaches a click handler that toggles the `open` CSS class on both the trigger button and its collapsible body, used in the Settings modal.

**`mirrorIntervalOptions(selected)`** — generates `<option>` HTML for the sync-interval dropdowns, marking the currently stored value as `selected`.

**`buildDefaultPayload(provider, repo, cfg)`** — assembles the full JSON body for `POST /api/v1/repos/migrate`. Key fields:
- `repo_name` follows the `owner_repo_github` convention to avoid collisions on the Gitea side
- `service: provider.id` tells Gitea which migration adapter to use (e.g. `"github"`)
- capability flags (`wiki`, `issues`, etc.) are copied from `provider.migrateCapabilities[key].default`, which the Settings modal can mutate at runtime
- an optional `lfs_endpoint` is appended from GM storage if the user has set one

## §6 · Split Button — Inject & Manage (lines 387–437)

The UI is a split button: a wide left half labelled "Mirror to Gitea" triggers the main action; a narrow right chevron opens settings. The chevron is hidden (`display:none`) until the user completes first-run setup — it becomes visible by adding the `has-chevron` CSS class to the group container.

```bash
sed -n '396,437p' gitea-mirror.user.js
```

```output
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
```

The guard at line 397 (`if (document.getElementById("gtm-group")) return`) prevents double-injection — critical because `init()` is called both on load and on every DOM mutation from GitHub's SPA.

Placement strategy uses `provider.findTarget()` which tries five different CSS selectors covering GitHub's various page layouts. If all fail, it falls back to a fixed-position element in the top-right corner so the button always appears regardless of GitHub's current HTML structure.

`showChevron()` is a post-mirror callback: after a successful first mirror the chevron appears, signalling that settings can now be changed.

## §7 · Quick Mirror (lines 439–548)

This section implements the main button's click handler — the core user-facing feature. It has three functions with distinct roles.

```bash
sed -n '443,461p' gitea-mirror.user.js
```

```output
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
```

**`quickMirror()`** is the dispatcher. The `gtm-loading` guard prevents double-clicks. It reads repo info and config, then branches:  
- Private repo → `promptForToken()` (asks for a one-time GitHub token)  
- Public repo → `executeMirror()` directly

```bash
sed -n '464,492p' gitea-mirror.user.js
```

```output
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
```

**`executeMirror()`** is where the network call happens. It:

1. Saves the button's original HTML so it can be restored after feedback  
2. Adds `gtm-loading` to disable the button and change its label to "Mirroring…"  
3. Calls `buildDefaultPayload()` and optionally injects a private-repo `auth_token`  
4. POSTs to `/api/v1/repos/migrate` via `giteaRequest()`  
5. On success: marks setup complete, reveals the chevron, switches the button green ("✓ Mirrored"), and temporarily re-wires it as a one-click link to the new mirror  
6. On error: turns the button red and shows a truncated error message for 5 seconds, then resets

The `resetBtn` inner closure handles all three states (loading → success/error → original) to keep the feedback logic in one place.

```bash
sed -n '495,548p' gitea-mirror.user.js
```

```output
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
```

**`promptForToken()`** builds a minimal modal for private repos. The label, placeholder, and hint text come from `provider.authFields[0]`, so they're fully provider-defined. The token is passed directly to `executeMirror()` and never written to GM storage — the warning message at line 519 makes this explicit to the user. Enter-key submission is wired for keyboard accessibility.

## §8 · Settings Modal (lines 550–691)

Opened by the chevron after first-run. Allows changing all stored config fields plus per-session capability defaults.

```bash
sed -n '554,600p' gitea-mirror.user.js
```

```output
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

```

```bash
sed -n '656,691p' gitea-mirror.user.js
```

```output
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
```

The modal is built in two passes. First, the capability checkboxes are generated from `provider.migrateCapabilities` — making the UI entirely data-driven. Then `modal.innerHTML` assembles the full form using the generated checkbox HTML, current config values (all escaped via `escHTML`), and the interval options.

Three things happen in the save handler:
1. Config fields are read from the form, trimmed, and written to GM storage via `saveConfig()`
2. Checkbox states are written back into `caps[key].default` in memory — so the next `buildDefaultPayload()` call picks up the changes without a page reload
3. The LFS custom endpoint, if any, is saved directly to a separate GM key

The LFS endpoint input is only shown when the LFS checkbox is ticked, wired by the `sync` closure at line 659.

## §9 · First-Run Modal (lines 693–808)

On the very first click the user hasn't yet configured a Gitea instance, so clicking "Mirror to Gitea" opens a setup wizard instead of firing immediately. This modal collects credentials and immediately attempts to mirror the current repo when the user clicks "Save & Mirror".

```bash
sed -n '762,808p' gitea-mirror.user.js
```

```output
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
```

The first-run modal differs from the settings modal in two important ways:

1. **It validates** that all three required fields (URL, token, owner) are non-empty before proceeding — the settings modal trusts the user to know what they're changing.
2. **It runs the migration immediately** after saving, so the very first interaction results in a working mirror. The modal shows a status banner with a "Creating mirror on Gitea…" loading state, then either a clickable link to the new mirror or a "Save & Retry" option on failure.

On success, `markConfigured()` sets the `gtmConfigured` flag and `showChevron()` reveals the settings button — the same pair of calls used in `executeMirror()` for consistency.

## §10 · Bootstrap + SPA Observer (lines 810–846)

The final section ties everything together and solves GitHub's SPA navigation problem.

```bash
sed -n '814,846p' gitea-mirror.user.js
```

```output
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
```

`init()` is the script's main function and also its most concise. It:

1. Guards against re-entrant calls with `isInitializing` — a synchronous boolean that acts as a mutex (JS is single-threaded, so this is safe)
2. Runs provider detection and repo detection; bails silently if either fails (e.g. on non-repo GitHub pages that somehow match the `@match` pattern)
3. Reads the configured flag to decide which click handler to wire to the main button
4. Delegates all DOM work to `injectSplitButton()`

The `MutationObserver` beneath `init()` watches the entire document body for child changes. GitHub uses Turbo (formerly Turbolinks) to navigate between pages without full reloads. When Turbo swaps in a new page, the `#gtm-group` button is removed along with the old content. The observer detects that absence and calls `init()` again, seamlessly re-injecting the button on the new page.

The closing `init()` call at line 845 handles the initial page load. The IIFE at lines 19–846 ensures all code is scoped and doesn't pollute the global namespace.

## How It All Fits Together

Here's the complete call graph for the happy path (returning user, public repo):

```
document-idle
  └─ init()
       ├─ detectProvider()          → github provider object
       ├─ provider.getRepoInfo()    → { owner, repo, full }
       ├─ isConfigured()            → true
       └─ injectSplitButton(provider, quickMirror, openSettingsModal, true)
            └─ [user clicks Mirror to Gitea]
                 └─ quickMirror(provider)
                      ├─ provider.isRepoPrivate()   → false
                      └─ executeMirror(provider, repo, cfg, btn)
                           ├─ buildDefaultPayload()  → { clone_addr, repo_name, … }
                           ├─ giteaRequest(POST /api/v1/repos/migrate)
                           │    └─ GM_xmlhttpRequest (bypasses CORS)
                           ├─ markConfigured() + showChevron()
                           └─ resetBtn('success', '✓ Mirrored', 4000)
```

And for first-time setup:

```
init()  →  injectSplitButton(…, openFirstRunModal, …, false)
             └─ [user clicks Mirror to Gitea]
                  └─ openFirstRunModal(provider)
                       └─ [user fills form + clicks Save & Mirror]
                            ├─ saveConfig(cfg)
                            ├─ buildDefaultPayload()
                            ├─ giteaRequest(POST /api/v1/repos/migrate)
                            ├─ markConfigured() + showChevron()
                            └─ setStatus('success', 'Mirror created! Open on Gitea →')
```

The MutationObserver restarts this whole flow after every Turbo navigation, and the `#gtm-group` presence check in `injectSplitButton` ensures the button is never duplicated.
