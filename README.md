<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/minecraft-1.21.5-4CAF50?style=for-the-badge&logo=minecraft&logoColor=white" alt="Minecraft">
  <img src="https://img.shields.io/badge/license-Unlicense-blueviolet?style=for-the-badge" alt="License">
</p>

<h1 align="center">⛏️ MineCline</h1>

<p align="center">
  <i>A multi-bot Minecraft AFK manager that lives in your terminal.</i><br>
  <sub>Spin up a small army of mineflayer bots, drive them from one CLI, and never lose your spot on the server again.</sub>
</p>

<p align="center">
  <code>connect</code> · <code>afk</code> · <code>multi-bot</code> · <code>CLI</code> · <code>mineflayer</code> · <code>reconnect</code>
</p>

<p align="center">
  <a href="#-features">Features</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-commands">Commands</a> ·
  <a href="#%EF%B8%8F-config">Config</a> ·
  <a href="#-dependencies">Dependencies</a>
</p>

<br>

## ✨ Features

|  |  |
|:---:|---|
| ![multi](https://img.shields.io/badge/-MULTI--BOT-7B68EE?style=flat-square) | Run several bots at once — select one, several, or all at a time |
| ![afk](https://img.shields.io/badge/-AFK%20MODE-3CB371?style=flat-square) | Random movement, looking, jumping, item-swinging — looks human-ish |
| ![auto](https://img.shields.io/badge/-AUTO%20TOGGLES-FF8C00?style=flat-square) | Auto-jump, auto-shift (sneak), auto-eat when hungry |
| ![onjoin](https://img.shields.io/badge/-ON--JOIN%20ACTIONS-4169E1?style=flat-square) | Auto-run commands and chat the moment a bot spawns |
| ![reconnect](https://img.shields.io/badge/-RECONNECT-9370DB?style=flat-square) | Manual or fully automatic reconnect with backoff after a drop |
| ![groups](https://img.shields.io/badge/-GROUPS%20%26%20SCRIPTS-20B2AA?style=flat-square) | Organize bots into groups, save commands, script multi-step sequences |
| ![config](https://img.shields.io/badge/-CONFIG%20PERSISTENCE-708090?style=flat-square) | Everything — bots, groups, scripts, settings — saved to `config.json` |

<br>

## 🚀 Quick Start

```bash
git clone https://github.com/Wiffiles/MineCline
cd MineCline
npm install
node minecline.js
```

Then, from inside the CLI:

```text
connect ItzMeJoel play.example.com
```

That's it — `ItzMeJoel` connects, and `help` lists everything else you can do from here.

<br>

## 📖 Commands

### Connection

| Command | Does |
|---|---|
| `connect <name,names...> <host> [port]` | Connect bot(s) — 5s stagger between each |
| `disconnect [name \| all]` | Disconnect one bot, or all of them |
| `reconnect` | Reconnect the selected bot(s), 5s stagger |

### Selection

| Command | Does |
|---|---|
| `select <name>` | Target a single bot |
| `control <name1,name2 \| all>` | Multi-select bots |
| `global` | Clear selection, target everything |
| `bots` | List all bots with live status |

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
config ItzMeJoel set autoEat true
config ItzMeJoel set autoReconnect on
config ItzMeJoel set host play.otherserver.com
```

<br>

## 📦 Dependencies

- [mineflayer](https://github.com/PrismarineJS/mineflayer) — Minecraft bot library

<br>

---

<p align="center">
  <sub>Built with ☕ and <a href="https://github.com/PrismarineJS/mineflayer">mineflayer</a></sub>
</p>
