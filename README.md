<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/minecraft-1.20-4CAF50" alt="Minecraft">
  <img src="https://img.shields.io/badge/license-ISC-blue" alt="License">
</p>

<h1 align="center">⛏ MineCline</h1>

<p align="center">
  <i>Multi-bot Minecraft AFK manager — terminal-powered bot army</i>
</p>

<p align="center">
  <code>connect</code> •
  <code>afk</code> •
  <code>afkbot</code> •
  <code>CLI</code> •
  <code>mineflayer</code> •
  <code>reconnect</code>
</p>

---

## ✨ Features

| | |
|---|---|
| ![multi](https://img.shields.io/badge/-Multi--bot-7B68EE) | Run several bots at once, select individually or in groups |
| ![afk](https://img.shields.io/badge/-AFK%20mode-3CB371) | Random movement, looking, jumping, item swinging — looks human-ish |
| ![auto](https://img.shields.io/badge/-Auto%20toggles-FF8C00) | Auto-jump, auto-shift (sneak), auto-eat when hungry |
| ![onjoin](https://img.shields.io/badge/-On--join%20actions-4169E1) | Auto-run commands and chat on spawn |
| ![reconnect](https://img.shields.io/badge/-Reconnect-9370DB) | Reconnect all saved bots with staggered delay |
| ![config](https://img.shields.io/badge/-Config%20persistence-708090) | Everything saved to `config.json` |

---

## 🚀 Quick Start

```bash
git clone https://github.com/Wiffiles/MineCline

cd MineCline

npm install

npm start

connect ItzMeJoel play.example.com
```

---

## 📖 Commands

### Connection

| Command | Does |
|---|---|
| `connect <name,names...> <host> [port]` | Connect bot(s) — 8s stagger between each |
| `disconnect [name \| all]` | Bye bye |
| `reconnect` | Reconnect every saved bot |

### Selection

| Command | Does |
|---|---|
| `select <name>` | Target a single bot |
| `control <name1,name2 \| all>` | Multi-select |
| `global` | Clear selection |
| `bots` | List all bots with status |

### Toggles

| Command | Does |
|---|---|
| `afk` | Toggle AFK mode |
| `jump` | Toggle auto-jump |
| `shift` | Toggle auto-shift (sneak) |
| `eat` | Toggle auto-eat |
| `respack` | Switch resource pack accept/deny |

### Actions

| Command | Does |
|---|---|
| `chat <text>` | Send a message |
| `/<command>` | Run a server command |
| `inv [name]` | Show inventory |

### Config

| Command | Does |
|---|---|
| `config [name]` | View config |
| `config set <key> <val>` | Change a setting |
| `config <name> set <key> <val>` | Change a specific bot's setting |
| `onjoin <name> add command\|chat <text>` | Add spawn action |
| `onjoin <name> list` | List spawn actions |
| `onjoin <name> remove <idx>` | Remove a spawn action |

### Utility

| Command | Does |
|---|---|
| `help` | Show this |
| `clear` | Clear the log |
| `save` | Force save config |
| `quit` / `exit` | Shut down |

---

## ⚙ Config

Saved automatically to `config.json`. Editable keys:

```json
{
  "host": "play.example.com",
  "port": 25565,
  "autoAfk": false,
  "autoJump": false,
  "autoShift": false,
  "autoEat": false,
  "resourcePack": "accept"
}
```

Set via the CLI:

```bash
config ItzMeJoel set autoEat true
config ItzMeJoel set host play.otherserver.com
```

---

## 📦 Dependencies

- [mineflayer](https://github.com/PrismarineJS/mineflayer) — Minecraft bot library
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) — Pathfinding

---

<p align="center">
  <sub>Built with ☕ and mineflayer</sub>
</p>
