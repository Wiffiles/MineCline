# Auto-Update & Force Update

## How it works (overview)

The auto-update system checks GitHub for a newer version of `minecline.js`.
If found, it prompts to update. Force update silently installs without
prompting — useful for critical fixes.

## Step 1 — Fork or create your GitHub repo

You need a GitHub repository that hosts `minecline.js` (default URLs point
to `Wiffiles/MineCline`). Either fork it or create your own repo.

## Step 2 — Change the URLs (if using your own repo)

In `minecline.js`, update these three URLs to point to your repo:

**Line ~1230** (doUpdate):
```js
const url = 'https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/minecline.js'
```

**Line ~1249** (checkForceUpdate):
```js
const url = 'https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/refs/heads/main/UPDATENOW.txt'
```

**Line ~1265** (checkAutoUpdate):
```js
const url = 'https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/minecline.js'
```

Replace `YOUR_USER/YOUR_REPO` with your GitHub username and repo name.

## Step 3 — Set up the files on GitHub

In your GitHub repo, commit and push:

- **`minecline.js`** — the main bot file. Make sure its `VERSION` constant
  (near the top) matches the release:
  ```js
  const VERSION = '2.0.0'
  ```
- **`UPDATENOW.txt`** — force-update flag (one word, no extra spaces):
  ```
  FALSE
  ```

## Step 4 — How force update works

1. Set `UPDATENOW.txt` on GitHub to `TRUE` and push.
2. Every running instance will detect it on its next update check,
   download the latest `minecline.js` automatically, back up the old one
   as `minecline.js.bak`, and exit for restart.
3. Set it back to `FALSE` when done to stop the force push.

Only the file **on GitHub** matters — the local copy is ignored.

## Step 5 — How auto-update works

On startup (2s delay), the app fetches `minecline.js` from GitHub, reads
the remote `VERSION`, and compares it to the local one:

```
[Y]es   [N]o   [Never] ask again
```

- **Y** — downloads the update, creates `minecline.js.bak`, overwrites,
        then exits. Restart manually.
- **N** — skips this once.
- **Never** — sets `autoUpdate: false` in `config.json`.

You can also run `update` in the CLI at any time.

## Config reference

In `config.json`:

```json
{
  "autoUpdate": true,
  "web": { "enabled": true, "port": 3000 }
}
```

Set `"autoUpdate": false` to disable startup checks (manual `update` still
works).

## Rollback

Each update creates `minecline.js.bak`. To revert:

```bash
copy minecline.js.bak minecline.js
```
