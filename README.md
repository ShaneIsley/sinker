<p align="center">
  <img src="sinkers.png" width="320" />
</p>

# Sinker

A userscript that adds a one-click mirror button to GitHub repository pages. Clone any repo — including issues, PRs, releases, wiki, and LFS — straight to your Gitea instance without leaving GitHub.

## Features (v1.0.0)

* **One-Click Mirroring:** Hit the button on any public repo page and it mirrors instantly using your saved defaults. No forms, no confirmation dialogs.
* **Split Button UI:** Styled to match GitHub's native buttons. The main area mirrors; the chevron opens settings.
* **Full Migrate API Support:** Mirrors git history plus wiki, issues, labels, milestones, pull requests, releases, and Git LFS objects.
* **Private Repo Handling:** Automatically detects private repos and prompts for a one-time GitHub token. The token is sent to Gitea in memory and never saved to disk.
* **Smart Naming:** Repos are named `owner_repo_github` on Gitea by default, avoiding clashes when mirroring forks or same-named repos from different owners.
* **Configurable Sync Interval:** Choose from 10 minutes to weekly. Gitea will keep the mirror up to date automatically.
* **Provider Architecture:** Built with a plugin system so future versions can support GitLab, Codeberg, Gogs, and other platforms without changing the core.

## How to Install

You need a userscript manager extension. [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Firefox/Edge/Safari) and [Violentmonkey](https://violentmonkey.github.io/) (Chrome/Firefox) both work.

### One-Click Install

Click the link below. Your userscript manager will offer to install it automatically:

**[Install gitea-mirror.user.js](../../raw/main/gitea-mirror.user.js)**

*(Because Tampermonkey/Violentmonkey recognise the `.user.js` extension, this just works.)*

---

### Manual Install

1. Open your userscript manager's dashboard.
2. Click **Create a new script** (or the `+` tab).
3. Delete the template code and paste the contents of [`gitea-mirror.user.js`](../../raw/main/gitea-mirror.user.js).
4. Save (`Ctrl+S`).

---

## Setup

The first time you click **Mirror to Gitea** on any repo, a setup dialog will ask for four things:

| Field | Example | Notes |
|-------|---------|-------|
| **Gitea Instance URL** | `https://gitea.example.com` | Your self-hosted Gitea root URL |
| **Gitea API Token** | `a1b2c3d4e5…` | Generate one at *Settings → Applications* in Gitea. Needs repo and org write scopes. |
| **Destination Owner** | `sinker` | The Gitea user or organisation that will own mirrored repos |
| **Owner Type** | `Organization` | Whether the destination is a user account or an org |

These are saved locally by your userscript manager. Your Gitea API token is stored in plaintext — this is an inherent limitation of userscripts; there is no secure keychain available.

After saving, the script immediately mirrors the current repo and you're done. Every repo after that is one click.

## How to Use

1. Navigate to any repository page on GitHub.
2. Click **Mirror to Gitea** in the repo header (next to Watch/Fork/Star).
3. **Public repos** mirror instantly — the button turns green and shows ✓ Mirrored. Click it during the success state to open the new repo on Gitea.
4. **Private repos** are detected automatically. A small prompt asks for a one-time GitHub Personal Access Token (needs `repo` scope). The token is sent to Gitea and immediately discarded — it is never written to storage.
5. Click the **▸ chevron** to open settings, where you can change your Gitea connection details, toggle which data to import (wiki, issues, PRs, etc.), and set a custom LFS endpoint.

## Security

* **No external dependencies.** The script is entirely self-contained — no CDN imports, no `@require`.
* **No `@connect *`.** Your userscript manager will prompt you to approve the specific Gitea domain on first use.
* **GitHub tokens are never persisted.** Private repo tokens live only in memory for the duration of the API call.
* **XSS-safe.** All user input and API responses are escaped with `escHTML()` before DOM insertion. URLs returned by Gitea are validated for safe protocols before being rendered as links.
* **DOM-namespaced.** All injected elements use `gtm-` prefixed IDs to avoid collisions with GitHub's own scripts.
* **Race-condition safe.** The SPA mutation observer uses a synchronous lock to prevent duplicate button injection during GitHub's Turbo page transitions.

## Roadmap

The provider registry is designed to be extended. Future versions may add:

* **GitLab** (`gitlab.com` and self-hosted)
* **Codeberg / Forgejo**
* **Gitea → Gitea** (cross-instance mirroring)
* **Gogs**
* **Bitbucket**

Adding a new provider is a single `registerProvider({…})` call — the modal, settings, API transport, and button injection are all provider-agnostic.

## License

MIT
