<div align="center">

```
  ██▄  ▄██ ▄▄ ▄▄  ▄▄ ▄▄▄▄▄ ▄█████ ▄▄    ▄▄ ▄▄  ▄▄ ▄▄▄▄▄
  ██ ▀▀ ██ ██ ███▄██ ██▄▄  ██     ██    ██ ███▄██ ██▄▄
  ██    ██ ██ ██ ▀██ ██▄▄▄ ▀█████ ██▄▄▄ ██ ██ ▀██ ██▄▄▄
```

**A multi-bot Minecraft AFK manager that lives in your terminal.**

Spin up a small army of [mineflayer](https://github.com/PrismarineJS/mineflayer) bots, drive every one of them from a single CLI, and never lose your spot on the server again.

<img src="https://img.shields.io/badge/node-%3E%3D18-2EB67D?style=flat-square&logo=node.js&logoColor=white&labelColor=1a1a1a" alt="Node">
<img src="https://img.shields.io/badge/minecraft-1.21.5-2EB67D?style=flat-square&logo=minecraft&logoColor=white&labelColor=1a1a1a" alt="Minecraft">
<img src="https://img.shields.io/badge/mineflayer-4.x-2EB67D?style=flat-square&labelColor=1a1a1a" alt="mineflayer">
<img src="https://img.shields.io/badge/license-Unlicense-2EB67D?style=flat-square&labelColor=1a1a1a" alt="License">

[Features](#-features) · [Quick Start](#-quick-start) · [Commands](#-commands) · [Config](#%EF%B8%8F-config) · [How it behaves](#-how-it-behaves)

</div>

<br>

```text
[0/3] global > connect Joel,Aria,Kit play.example.com
10:31:59 PM [Joel] >> Connecting to play.example.com:25565...
10:32:04 PM [Aria] >> Connecting to play.example.com:25565...
10:32:09 PM [Kit]  >> Connecting to play.example.com:25565...
10:32:11 PM [Joel] >> Spawned into world
[3/3] global > afk
10:32:14 PM [Joel] >> AFK started
10:32:14 PM [Aria] >> AFK started
10:32:14 PM [Kit]  >> AFK started
[3/3] global >
```

<br>

## ✨ Features

|  |  |
|:---:|---|
| 🤖 **Multi-bot control** | Run several bots at once. Target one with `select`, several with `control`, or everything with `global` |
| 🚶 **AFK mode** | Randomized walking, looking, jumping, and item-swinging so a parked bot doesn't look frozen |
| ⚙️ **Auto toggles** | Auto-jump, auto-shift (sneak), auto-eat when hunger drops, resource-pack auto-accept |
| 🔁 **Reconnect, two ways** | Reconnect on demand with `reconnect`, or turn on `autoReconnect` per bot for automatic retries with backoff after a drop |
| 🚪 **On-join actions** | Queue chat lines and `/commands` to fire the instant a bot spawns — useful for auto-`/login` flows, claiming a kit, etc. |
| 🔑 **Auto-login** | Set one password with `mcpwd` and every bot will `/register` + `/login` itself on spawn |
| 🗂️ **Groups, saved commands & scripts** | Organize bots into named groups, save commands you run often, or script multi-step sequences with delays between steps |
| 💾 **Config persistence** | Bots, groups, scripts, and settings are all debounced-saved to `config.json` automatically |
| 📜 **Persistent logs** | Every line that scrolls past is also mirrored to `MineCline.logs.txt`, stripped of color codes |
| ⌨️ **A CLI that feels like a shell** | Tab-completion for commands, bot names, and subcommands, plus arrow-key command history |
| 🔄 **Self-updating** | `update` checks the upstream repo for a newer version and offers to install it in place |

<br>

## 🚀 Quick Start

```bash
git clone https://github.com/Wiffiles/MineCline
cd MineCline
npm install
node minecline.js
```

First run asks for a Minecraft password (for auto `/register` + `/login`) — enter one or just hit enter to skip. Then, from inside the CLI:

```text
connect Joel play.example.com
```

`Joel` connects, and `help` lists everything else you can do from here.

<br>

## 📖 Commands

### Connection

| Command | Does |
|---|---|
| `connect <name,names...> <host> [port]` | Connect bot(s) — 5s stagger between each |
| `disconnect [name \| all]` | Disconnect one bot, or all of them |
| `reconnect` | Disconnect and reconnect the selected bot(s), 5s stagger |

### Selection

| Command | Does |
|---|---|
| `select <name>` | Target a single bot |
| `control <name1,name2 \| all>` | Multi-select bots |
| `global` | Clear selection, target everything |
| `bots` | List all bots with live status (●&nbsp;connected · ◐&nbsp;connecting · ○&nbsp;offline) |

### Toggles

| Command | Does |
|---|---|
| `afk [name]` | Toggle AFK mode |
| `jump [name]` | Toggle auto-jump |
| `shift [name]` | Toggle auto-shift (sneak) |
| `eat [name]` | Toggle auto-eat |
| `respack [name]` | Switch resource pack accept/deny |

### Actions

| Command | Does |
|---|---|
| `chat` / `msg <text>` | Send a chat message |
| `/<command>` | Run a server command |
| `inv [name]` | Show inventory, held item, and armor |
| `players [name]` | List players a bot has seen online |

### Config

| Command | Does |
|---|---|
| `config [name]` | View config |
| `config set <key> <val>` | Change a setting on the current selection |
| `config <name> set <key> <val>` | Change a specific bot's setting |
| `onjoin <name> add command\|chat <text>` | Add a spawn action |
| `onjoin <name> list` | List a bot's spawn actions |
| `onjoin <name> remove <idx>` | Remove a spawn action |
| `mcpwd [password]` | View or set the auto `/register` + `/login` password |

### Organization

| Command | Does |
|---|---|
| `group list \| create \| delete \| rename \| add \| remove` | Manage bot groups |
| `savecmd list \| add \| remove \| run` | Save and re-run frequent commands |
| `script list \| create \| delete \| addstep \| run` | Multi-step scripts with delays |

### Utility

| Command | Does |
|---|---|
| `update` | Check for and install updates |
| `help [command]` | Show command list, or details for one command |
| `clear` | Clear the on-screen log |
| `save` | Force-save config to disk |
| `quit` / `exit` | Disconnect everything and shut down |

> **Tip:** press <kbd>Tab</kbd> to autocomplete commands, subcommands, and bot names, and <kbd>↑</kbd> / <kbd>↓</kbd> to walk back through command history.

<br>

## ⚙️ Config

Everything is saved automatically to `config.json` next to the script. Per-bot keys:

```json
{
  "host": "play.example.com",
  "port": 25565,
  "autoAfk": false,
  "autoJump": false,
  "autoShift": false,
  "autoEat": false,
  "autoReconnect": false,
  "resourcePack": "accept"
}
```

Change any of these live from the CLI instead of hand-editing the file:

```text
config Joel set autoEat true
config Joel set autoReconnect on
config Joel set host play.otherserver.com
```

<br>

## 🔍 How it behaves

A few things worth knowing going in, since they're not obvious from the command list alone:

- **`autoReconnect` only retries unexpected drops.** A manual `disconnect` or `quit` is never followed by an automatic reconnect. When it does retry, the delay backs off (5s → 10s → 20s …, capped at 60s) and gives up after 8 attempts.
- **`mcpwd` stores the password in `config.json` in plain text.** It's read off disk on every spawn to send `/register` and `/login` automatically. Treat that file accordingly — don't commit it, and don't share it.
- **`update` pulls and runs code from the upstream GitHub repo.** Running `update` (or having `autoUpdate` left on) replaces `minecline.js` on disk with whatever the configured repo currently serves, then restarts. A `.bak` of the previous version is kept alongside it. Know who controls that repo before pointing this at one you don't own.

<br>

## 📦 Dependencies

- [mineflayer](https://github.com/PrismarineJS/mineflayer) — Minecraft bot library

Everything else (`fs`, `path`, `readline`, `https`) is a Node.js built-in — no other runtime dependencies.

<br>

---

<div align="center">
<sub>Built with ☕ and <a href="https://github.com/PrismarineJS/mineflayer">mineflayer</a></sub>
</div>
