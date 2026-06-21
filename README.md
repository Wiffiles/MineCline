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
  <code>mcbridge</code> •
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
| ![discord](https://img.shields.io/badge/-Discord%20bridge-5865F2) | Bidirectional chat relay between MC and Discord |
| ![inventory](https://img.shields.io/badge/-Inventory%20viewer-6B8E23) | See held item, armor, hotbar, full inventory |
| ![reconnect](https://img.shields.io/badge/-Reconnect-9370DB) | Reconnect all saved bots with staggered delay |
| ![config](https://img.shields.io/badge/-Config%20persistence-708090) | Everything saved to `config.json` |

---

## 🚀 Quick Start

```bash
# Install
npm install

# Run
npm start

# Connect a bot
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

### Discord

| Command | Does |
|---|---|
| `mcbridge <bot> <token> <channel>` | Link MC ↔ Discord |
| `bridge stop` | Kill the bridge |

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

## 🔌 Discord Bridge

Links one bot's in-game chat to a Discord channel. Messages from Discord get relayed to the server and vice versa.

```bash
mcbridge ItzMeJoel <bot-token> <channel-id>
```

---

## 📦 Dependencies

- [mineflayer](https://github.com/PrismarineJS/mineflayer) — Minecraft bot library
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) — Pathfinding

--- 

## 📱 Optimized for mobile support

<img width="1074" height="561" alt="image" src="https://github.com/user-attachments/assets/a7555606-a2f8-48d9-b18d-667eeb647758" />

The code is optimized to be runned on phones. You can use old ones. for hosting

Just download termux and follow setup guide above. its the same for windows Linux (Android Included) 

---

<p align="center">
  <sub>Built with ☕ and mineflayer</sub>
</p>
