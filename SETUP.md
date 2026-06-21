# Auto-Update & Force Update

## How it works

The auto-update system checks GitHub for a newer version of `minecline.js`
**and** the `public/` folder (HTML, CSS, JS). When an update is found:

1. Backs up `minecline.js` → `minecline.js.bak`
2. Downloads new `minecline.js`, `index.html`, `style.css`, `app.js` from GitHub
3. Replaces all four files in place
4. Exits for restart

---

## Step 1 — Fork or use the repo

The default URLs point to `Wiffiles/MineCline`. To use your own:

1. Fork the repo: https://github.com/Wiffiles/MineCline
2. Or create your own repo with the same file structure

---

## Step 2 — Point the URLs to your repo

In `minecline.js` (near the top), change these two constants:

```js
const REPO_BASE = 'https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main'
const REPO_BASE_REF = 'https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/refs/heads/main'
```

Replace `YOUR_USER/YOUR_REPO` with your GitHub username and repo name.

---

## Step 3 — Push files to GitHub

Your repo needs this structure:

```
minecline.js         ← main bot file (must have a VERSION constant)
UPDATENOW.txt        ← force-update flag (content: "FALSE" or "TRUE")
public/
  index.html
  style.css
  app.js
```

Each `minecline.js` release should have its `VERSION` bumped:

```js
const VERSION = '2.0.0'
```

---

## Step 4 — Force update (critical fixes)

1. On GitHub, set `UPDATENOW.txt` content to `TRUE` and push.
2. Every running instance fetches this file on each update check.  
   If it reads `TRUE`, it **silently** downloads and applies the update  
   with no user prompt — then exits for restart.
3. Set it back to `FALSE` when done.

Only the file **on GitHub** matters; the local copy is ignored.

---

## Step 5 — Normal auto-update

On startup (2s delay), the app fetches `minecline.js` from GitHub, reads
the remote `VERSION`, and compares:

```
[Y]es   [N]o   [Never] ask again
```

- **Y** — downloads everything, backs up, overwrites, exits.
- **N** — skips this once.
- **Never** — sets `autoUpdate: false` in `config.json`.

You can also type `update` in the CLI at any time.

---

## Config

In `config.json`:

```json
{
  "autoUpdate": true,
  "web": { "enabled": true, "port": 3000 }
}
```

Set `"autoUpdate": false` to disable startup checks. The manual `update`
command still works.

---

## Rollback

No rollback system currently cant offord it

