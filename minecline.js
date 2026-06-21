const mineflayer = require('mineflayer')
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const https = require('https')
const express = require('express')
const http = require('http')
const { WebSocketServer } = require('ws')

//  suppress noisy minecraft-protocol partial-read warnings
const _stderrWrite = process.stderr.write.bind(process.stderr)
const _stdoutWrite = process.stdout.write.bind(process.stdout)
const _consoleWarn = console.warn
const _consoleError = console.error
function _isJunk(buf) {
  const s = Buffer.isBuffer(buf) ? buf.toString() : String(buf)
  return s.includes('chunk size') || s.includes('partial packet') || s.includes('but only') || s.includes('PartialReadError') || s.includes('Read error for undefined')
}
process.stderr.write = (buf, enc, cb) => { if (_isJunk(buf)) return true; return _stderrWrite(buf, enc, cb) }
process.stdout.write = (buf, enc, cb) => { if (_isJunk(buf)) return true; return _stdoutWrite(buf, enc, cb) }
console.warn = (...args) => { if (args.some(a => _isJunk(a))) return; _consoleWarn(...args) }
console.error = (...args) => { if (args.some(a => _isJunk(a))) return; _consoleError(...args) }

const VERSION = '2.1.3'
const REPO_BASE = 'https://raw.githubusercontent.com/Wiffiles/MineCline/main'
const REPO_BASE_REF = 'https://raw.githubusercontent.com/Wiffiles/MineCline/refs/heads/main'
const CONFIG_PATH = path.join(__dirname, 'config.json')
const LOG_PATH = path.join(__dirname, 'MineCline.logs.txt')
const MAX_LOG = 500
const MAX_HISTORY = 100
const DEBOUNCE_MS = 1000

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', italic: '\x1b[3m',
  ul: '\x1b[4m', r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m',
  b: '\x1b[34m', m: '\x1b[35m', c: '\x1b[36m', w: '\x1b[37m',
  gry: '\x1b[90m', bgR: '\x1b[41m', bgG: '\x1b[42m', bgY: '\x1b[43m',
  bgB: '\x1b[44m', bgM: '\x1b[45m',
}

const DEFAULT_CONFIG = {
  web: { enabled: true, port: 3000 },
  autoUpdate: true,
}

const DEFAULT_BOT_CONFIG = {
  host: 'localhost', port: 25565,
  autoAfk: false, autoJump: false, autoShift: false, autoEat: false, resourcePack: 'accept',
  onJoin: { commands: [], chat: [] },
}

const bots = {}
let activeBot = null, activeBots = new Set(), selMode = 'single'
let logLines = [], input = '', cursor = 0, history = [], histIdx = -1
let exitFlag = false, saveTimer = null, discordBridge = null
let appConfig = { ...DEFAULT_CONFIG }
let commandHistory = [], alertLog = [], playerCountHistory = {}, serverCounts = {}
let botGroups = {}, savedCommands = [], savedScripts = {}
let webApp = null, webServer = null, wss = null, wsClients = new Set()
let broadcastInterval = null

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, '') } // kill the escape codes

function writeLogFile(botName, time, text) {
  try {
    const line = `${time} [${botName}] ${stripAnsi(text)}\n`
    fs.appendFileSync(LOG_PATH, line, 'utf8')
  } catch {}
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
      const data = JSON.parse(raw)
      if (data.web) appConfig.web = { ...DEFAULT_CONFIG.web, ...data.web }
      if (data._setup) appConfig._setup = true
      if (data.autoUpdate !== undefined) appConfig.autoUpdate = data.autoUpdate
      if (data.groups) botGroups = data.groups
      if (data.savedCommands) savedCommands = data.savedCommands
      if (data.savedScripts) savedScripts = data.savedScripts
      if (data && data.bots) {
        for (const [name, cfg] of Object.entries(data.bots)) {
          const { autoReconnect: _, ...rest } = cfg
          if (!bots[name]) bots[name] = { ...DEFAULT_BOT_CONFIG, ...rest, name, connected: false, joined: false }
        }
      }
    }
  } catch (e) { logErr('', `Config load error: ${e.message}`) }
}

function saveConfig() {
  const data = { version: VERSION, web: appConfig.web, autoUpdate: appConfig.autoUpdate, _setup: appConfig._setup || true, bots: {}, groups: botGroups, savedCommands, savedScripts }
  for (const [name, b] of Object.entries(bots)) {
    data.bots[name] = {
      host: b.host, port: b.port,
      autoAfk: !!b.autoAfk, autoJump: !!b.autoJump, autoShift: !!b.autoShift, autoEat: !!b.autoEat,
      resourcePack: b.resourcePack || 'accept',
      onJoin: { commands: [...(b.onJoin?.commands || [])], chat: [...(b.onJoin?.chat || [])] },
    }
  }
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8') } catch (e) { /* who cares */ }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveConfig(); saveTimer = null }, DEBOUNCE_MS)
}

class DiscordBridge {
  constructor(botName, token, channelId) {
    this.botName = botName
    this.token = token
    this.channelId = channelId
    this.ws = null
    this.heartbeatTimer = null
    this.seq = null
    this.sessionId = null
    this.connected = false
    this.lastHeartbeatAck = true
    this.reconnectAttempts = 0
    this.onDiscordMessage = null

    if (!bots[botName]) { logErr('', `Bot "${botName}" not found`); return }
    try {
      const wsModule = require('ws') // hope this is installed lol
      this.Ws = wsModule
      this.connect()
    } catch { logErr('', 'ws module not available, cannot create bridge') }
  }

  connect() {
    if (!this.Ws) return
    const url = 'wss://gateway.discord.gg/?v=10&encoding=json'
    this.ws = new this.Ws(url)
    this.ws.on('open', () => {
      this.reconnectAttempts = 0
      logInfo(this.botName, 'Discord gateway connected')
    })
    this.ws.on('message', (data) => this.handleWS(data))
    this.ws.on('close', (code) => {
      this.connected = false
      if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
      logWarn(this.botName, `Discord WS closed (${code}), reconnecting...`)
      if (!exitFlag) {
        this.reconnectAttempts++
        const delay = Math.min(5000 * this.reconnectAttempts, 30000)
        setTimeout(() => this.connect(), delay)
      }
    })
    this.ws.on('error', (err) => {
      logErr(this.botName, `Discord WS error: ${err.message}`)
    })
  }

  handleWS(data) {
    try {
      const p = JSON.parse(data.toString())
      const op = p.op
      const d = p.d
      const s = p.s
      const t = p.t

      if (s) this.seq = s

      switch (op) {
        case 10: // Hello
          this.heartbeatInterval = d.heartbeat_interval
          this.identify()
          this.startHeartbeat()
          break
        case 0: // Dispatch
          if (t === 'READY') {
            this.sessionId = d.session_id
            this.connected = true
            logInfo(this.botName, `Discord bridge connected as ${d.user?.username}`)
          }
          if (t === 'MESSAGE_CREATE') {
            if (d.channel_id === this.channelId && d.author?.id !== d.webhook_id) {
              if (this.onDiscordMessage) {
                this.onDiscordMessage(d.author?.username || 'Unknown', d.content)
              }
            }
          }
          break
        case 7: // Reconnect
          logWarn(this.botName, 'Discord requested reconnect')
          this.disconnect()
          setTimeout(() => this.connect(), 1000)
          break
        case 9: // Invalid session
          logErr(this.botName, 'Discord invalid session, reconnecting...')
          this.sessionId = null
          setTimeout(() => this.connect(), 2000)
          break
      }
    } catch (e) { logErr(this.botName, `Discord WS parse: ${e.message}`) }
  }

  identify() {
    const payload = {
      op: 2,
      d: {
        token: this.token,
        intents: 33280, // GUILD_MESSAGES + MESSAGE_CONTENT
        properties: { os: 'windows', browser: 'MineCline', device: 'MineCline' },
      },
    }
    if (this.sessionId) {
      payload.d.session_id = this.sessionId
      payload.d.seq = this.seq
    }
    this.send(payload)
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === this.Ws?.OPEN) {
        this.send({ op: 1, d: this.seq })
      }
    }, this.heartbeatInterval)
  }

  send(payload) {
    if (this.ws?.readyState === this.Ws?.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  sendMessage(content) {
    const data = JSON.stringify({ content })
    const opts = {
      hostname: 'discord.com',
      path: `/api/v10/channels/${this.channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }
    const req = https.request(opts, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if (res.statusCode >= 400) {
          try {
            const j = JSON.parse(body)
            logErr(this.botName, `Discord send failed: ${j.message || body}`)
          } catch { logErr(this.botName, `Discord HTTP ${res.statusCode}`) }
        }
      })
    })
    req.on('error', (e) => logErr(this.botName, `Discord HTTP error: ${e.message}`))
    req.write(data)
    req.end()
  }

  disconnect() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    if (this.ws) { try { this.ws.close(1000) } catch {} this.ws = null }
    this.connected = false
  }

  stop() {
    this.disconnect()
    discordBridge = null
    logInfo(this.botName, 'Discord bridge stopped')
  }
}

function createBot(name, host, port) {
  if (bots[name] && bots[name].connected) { logWarn('', `"${name}" already connected`); return }
  const cfg = bots[name] || { ...DEFAULT_BOT_CONFIG }
  cfg.name = name; cfg.host = host; cfg.port = port
  cfg.connected = false; cfg.joined = false
  cfg.health = 0; cfg.food = 0; cfg.x = null; cfg.y = null; cfg.z = null
  cfg.ping = null; cfg.uptime = 0; cfg.dimension = null
  cfg.inventoryCount = 0; cfg.inventoryItems = []; cfg.heldItem = null
  cfg.armor = []; cfg.players = {}; cfg.afkEnabled = false
  cfg.afkActions = 0; cfg.afkInterval = null
  cfg.connectedAt = 0; cfg.error = null; cfg.kickedReason = null
  cfg.onJoinExecuted = false; cfg.moveThrottle = 0; cfg.autoEatRunning = false
  cfg.resourcePack = cfg.resourcePack || 'accept'
  bots[name] = cfg

  const b = mineflayer.createBot({ host, port: parseInt(port, 10), username: name, timeout: 30000, checkTimeoutInterval: 5000 })
  cfg.bot = b; cfg.connectedAt = Date.now(); cfg.uptime = 0
  logInfo(name, `Connecting to ${host}:${port}...`)

  b.on('login', () => {
    cfg.connected = true; cfg.joined = false; cfg.error = null; cfg.onJoinExecuted = false
    cfg.dimension = b.game?.dimension || 'unknown'; cfg.kickedReason = null
    updateInv(cfg, b); logInfo(name, `Logged in as ${b.username}`)
  })

  b.on('spawn', () => {
    cfg.joined = true; updateInv(cfg, b); logInfo(name, 'Spawned into world')
    if (cfg.onJoin && !cfg.onJoinExecuted) {
      cfg.onJoinExecuted = true
      if (cfg.onJoin.commands) for (const c of cfg.onJoin.commands) { try { b.chat(`/${c}`); logChat(name, `Auto-cmd: /${c}`) } catch {} }
      if (cfg.onJoin.chat) for (const msg of cfg.onJoin.chat) { try { b.chat(msg); logChat(name, `Auto-chat: ${msg}`) } catch {} }
    }
    if (cfg.autoShift) { try { b.setControlState('sneak', true) } catch {} }
    if (cfg.autoAfk) startAfk(name)
  })

  b.on('end', (reason) => {
    cfg.connected = false; cfg.joined = false; cfg.bot = null
    if (cfg.autoJumpInterval) { clearInterval(cfg.autoJumpInterval); cfg.autoJumpInterval = null }
    if (cfg.playerTrackInterval) { clearInterval(cfg.playerTrackInterval); cfg.playerTrackInterval = null }
    stopAfk(name); logWarn(name, `Disconnected: ${reason}`)
    alertLog.push({ t: ts(), bot: name, type: 'warn', message: `Disconnected: ${reason}` })
    if (alertLog.length > 500) alertLog.splice(0, alertLog.length - 500)
    // decrement server count
    const srvKey = `${cfg.host}:${cfg.port}`
    if (serverCounts[srvKey]) {
      serverCounts[srvKey].count = Math.max(0, serverCounts[srvKey].count - 1)
      const idx = serverCounts[srvKey].bots.indexOf(name)
      if (idx > -1) serverCounts[srvKey].bots.splice(idx, 1)
      if (serverCounts[srvKey].count === 0) delete serverCounts[srvKey]
    }
  })

  b.on('error', (err) => {
    if (bots[name]) cfg.error = err.message; logErr(name, err.message)
    alertLog.push({ t: ts(), bot: name, type: 'error', message: err.message })
    if (alertLog.length > 500) alertLog.splice(0, alertLog.length - 500)
  })
  b.on('kicked', (reason) => {
    cfg.kickedReason = String(reason).slice(0, 120); logErr(name, `Kicked: ${cfg.kickedReason}`)
    alertLog.push({ t: ts(), bot: name, type: 'warn', message: `Kicked: ${cfg.kickedReason}` })
    if (alertLog.length > 500) alertLog.splice(0, alertLog.length - 500)
  })

  b.on('message', (msg) => {
    if (msg.fromMob) return
    const from = msg.to?.username || 'SERVER'
    const text = msg.toString().replace(/§[0-9a-fk-or]/gi, '').trim()
    logMsg(name, `<${from}> ${text}`)
    if (discordBridge && discordBridge.botName === name && discordBridge.connected) {
      discordBridge.sendMessage(`**${from}**: ${text}`)
    }
  })

  b.on('whisper', (from, msg) => {
    logMsg(name, `[whisper] ${from}: ${msg}`)
    if (discordBridge && discordBridge.botName === name && discordBridge.connected) {
      discordBridge.sendMessage(`*whisper ${from}*: ${msg}`)
    }
  })

  b.on('health', () => {
    cfg.health = Math.round(b.health ?? 0); cfg.food = Math.round(b.food ?? 0)
    if (cfg.autoEat && cfg.food <= 14 && !cfg.autoEatRunning && cfg.joined) {
      cfg.autoEatRunning = true
      b.once('health', () => { cfg.autoEatRunning = false })
      b.consume().catch(() => { cfg.autoEatRunning = false })
    }
  })

  b.on('move', () => {
    const now = Date.now()
    if (now - cfg.moveThrottle < 500) return; cfg.moveThrottle = now
    if (b.entity?.position) { cfg.x = Math.round(b.entity.position.x); cfg.y = Math.round(b.entity.position.y); cfg.z = Math.round(b.entity.position.z) }
  })

  b.on('resourcePack', () => {
    if (cfg.resourcePack === 'accept') { b.acceptResourcePack(); logInfo(name, 'Resource pack accepted') }
    else if (cfg.resourcePack === 'deny') { b.denyResourcePack(); logWarn(name, 'Resource pack denied') }
  })

  b.on('playerCollect', (collector) => { if (collector === b.entity) updateInv(cfg, b) })
  b.on('windowUpdate', () => updateInv(cfg, b))
  b.on('windowOpen', () => updateInv(cfg, b))
  b.on('respawn', () => logInfo(name, 'Bot respawned'))

  b.on('entitySpawn', (entity) => {
    if (entity.type === 'player' && entity.username) {
      cfg.players[entity.username] = {
        name: entity.username, ping: entity.ping,
        distance: entity.position ? Math.round(entity.position.distanceTo(b.entity?.position || { x: 0, y: 0, z: 0 })) : null,
      }
    }
  })

  // track player count every 30s for graphs
  const playerTrackInterval = setInterval(() => {
    if (!cfg.connected || !cfg.joined) return
    const count = Object.keys(cfg.players || {}).length
    if (!playerCountHistory[name]) playerCountHistory[name] = []
    playerCountHistory[name].push({ t: Date.now(), count })
    if (playerCountHistory[name].length > 200) playerCountHistory[name].splice(0, playerCountHistory[name].length - 200)
  }, 30000)
  cfg.playerTrackInterval = playerTrackInterval

  // track server counts
  const srvKey = `${cfg.host}:${cfg.port}`
  if (!serverCounts[srvKey]) serverCounts[srvKey] = { count: 0, bots: [] }
  if (!serverCounts[srvKey].bots.includes(name)) {
    serverCounts[srvKey].count++
    serverCounts[srvKey].bots.push(name)
  }

  let autoJumpInterval = null
  if (cfg.autoJump) {
    autoJumpInterval = setInterval(() => {
      if (!cfg.connected || !cfg.joined || !b.entity?.onGround) return
      b.setControlState('jump', true); setTimeout(() => b.setControlState('jump', false), 200)
    }, 1500)
  }
  cfg.autoJumpInterval = autoJumpInterval
  scheduleSave()
}

function disconnectBot(name) {
  const cfg = bots[name]
  if (!cfg) { logErr('', `No bot "${name}"`); return }
  if (discordBridge && discordBridge.botName === name) { discordBridge.stop(); logInfo('', 'Bridge stopped') }
  stopAfk(name)
  if (cfg.autoJumpInterval) { clearInterval(cfg.autoJumpInterval); cfg.autoJumpInterval = null }
  if (cfg.bot) { try { cfg.bot.end() } catch {} }
  cfg.connected = false; cfg.joined = false; cfg.bot = null
  logWarn(name, 'Disconnected')
  if (activeBot === name) activeBot = null
  if (activeBots.has(name)) activeBots.delete(name)
  scheduleSave()
}

function updateInv(cfg, b) {
  if (!b || !b.inventory) return
  try {
    const raw = typeof b.inventory.items === 'function' ? b.inventory.items() : b.inventory.items
    const items = (raw || []).filter(Boolean)
    cfg.inventoryCount = items.length
    cfg.inventoryItems = items.map(i => ({ name: i.name, count: i.count, slot: i.slot }))
    cfg.heldItem = b.heldItem ? { name: b.heldItem.name, count: b.heldItem.count, slot: b.heldItem.slot } : null
    const rawArmor = typeof b.inventory.armorItems === 'function' ? b.inventory.armorItems() : (b.inventory.armorItems || [])
    const armor = (rawArmor || []).filter(Boolean)
    const types = ['helmet', 'chestplate', 'leggings', 'boots']
    cfg.armor = armor.map((item, i) => ({ name: item.name, count: item.count, slot: item.slot, type: types[i] || `slot${i}` }))
  } catch (e) { /* inventory not ready yet */ }
}

//  AFK

function startAfk(name) {
  const cfg = bots[name]
  if (!cfg || !cfg.bot || !cfg.connected || cfg.afkEnabled) return
  cfg.afkEnabled = true; cfg.afkActions = 0
  const b = cfg.bot
  const actions = [
    () => { b.setControlState('forward', true); setTimeout(() => b.clearControlStates(), 300 + Math.random() * 900) },
    () => { b.setControlState('back', true); setTimeout(() => b.clearControlStates(), 300 + Math.random() * 900) },
    () => { b.setControlState('left', true); setTimeout(() => b.clearControlStates(), 300 + Math.random() * 900) },
    () => { b.setControlState('right', true); setTimeout(() => b.clearControlStates(), 300 + Math.random() * 900) },
    () => { b.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.8); cfg.afkActions++ },
    () => { b.setControlState('jump', true); setTimeout(() => b.setControlState('jump', false), 300 + Math.random() * 400); cfg.afkActions++ },
    () => { try { b.activateItem() } catch {}; cfg.afkActions++ },
  ]
  cfg.afkInterval = setInterval(() => {
    if (!cfg.connected || !cfg.afkEnabled) { stopAfk(name); return }
    if (!b.entity?.onGround) return
    const fn = actions[Math.floor(Math.random() * actions.length)]
    try { fn() } catch {}
    cfg.afkActions++
  }, 1200 + Math.random() * 2000)
  logInfo(name, 'AFK mode started')
}

function stopAfk(name) {
  const cfg = bots[name]
  if (!cfg) return
  cfg.afkEnabled = false
  if (cfg.afkInterval) { clearInterval(cfg.afkInterval); cfg.afkInterval = null }
  if (cfg.bot) { try { cfg.bot.clearControlStates() } catch {} }
}

//  log stuff

function ts() { 
  const d = new Date()
  let h = d.getHours() % 12 || 12
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}${d.getHours() >= 12 ? ' PM' : ' AM'}`
}

function formatLog(entry) {
  const tag = entry.bot ? `${C.gry}[${entry.bot}]${C.reset} ` : ''
  const time = `${C.dim}${entry.time}${C.reset} `
  return `${time}${tag}${entry.text}`
}

function getPrompt() {
  let ctx
  if (selMode === 'multi' && activeBots.size > 0) {
    const names = [...activeBots]
    ctx = names.length <= 2 ? `${C.m}${names.join('+')}${C.reset}` : `${C.m}${names[0]}+${names.length - 1}${C.reset}`
  } else if (activeBot) {
    ctx = `${C.g}${activeBot}${C.reset}`
  } else {
    ctx = `${C.dim}global${C.reset}`
  }
  return `${ctx} > `
}

function redrawPrompt() {
  const p = getPrompt()
  process.stdout.write(`\r\x1b[K${p}${input}`)
  const pLen = stripAnsi(p).length
  process.stdout.write(`\x1b[${pLen + cursor + 1}G`)
}

function addLog(botName, text) {
  const entry = { time: ts(), bot: botName || '', text }
  logLines.push(entry)
  if (logLines.length > MAX_LOG) logLines.splice(0, logLines.length - MAX_LOG)
  writeLogFile(entry.bot, entry.time, entry.text)
  const line = formatLog(entry)
  process.stdout.write(`\r\x1b[K${line}\n`)
  redrawPrompt()
}

function logInfo(botName, msg) { addLog(botName, `${C.g}◆${C.reset} ${msg}`) }
function logWarn(botName, msg) { addLog(botName, `${C.y}⚠${C.reset} ${msg}`) }
function logErr(botName, msg) { addLog(botName, `${C.r}✖${C.reset} ${msg}`) }
function logChat(botName, msg) { addLog(botName, `${C.gry}💬${C.reset} ${msg}`) }
function logMsg(botName, msg) { addLog(botName, `${C.c}${msg}${C.reset}`) }
function logRaw(botName, msg) { addLog(botName, msg) }

//  target resolution

function getTargets(name) {
  if (name) {
    if (!bots[name]) { logErr('', `No bot "${name}"`); return [] }
    return [bots[name]]
  }
  if (selMode === 'multi' && activeBots.size > 0) {
    const result = []
    for (const n of activeBots) { if (bots[n] && bots[n].connected) result.push(bots[n]) }
    if (result.length === 0) logErr('', 'No selected bots are connected.')
    return result
  }
  if (activeBot && bots[activeBot]) {
    if (!bots[activeBot]?.connected) { logErr('', 'Selected bot not connected.'); return [] }
    return [bots[activeBot]]
  }
  logErr('', 'No bot selected. Use "select <name>" or "control <bot1,bot2,...>".')
  return []
}



//  COMMANDS

const CMD_LIST = [
  'connect', 'disconnect', 'bots', 'select', 'global', 'control',
  'afk', 'jump', 'shift', 'eat', 'reconnect', 'respack',
  'chat', 'msg', 'inv', 'mcbridge', 'bridge',
  'config', 'onjoin', 'clear', 'help', 'quit', 'exit',
  'update', 'web', 'group', 'savecmd', 'script', 'players', 'save',
]

function forTargets(name, fn) {
  const targets = getTargets(name)
  if (targets.length === 0) return false
  for (const t of targets) fn(t)
  return true
}

function setConfig(cfg, key, val) {
  if (key === 'autoAfk' || key === 'autoJump' || key === 'autoShift' || key === 'autoEat') {
    cfg[key] = val === 'true' || val === 'on' || val === '1'
  } else if (key === 'resourcePack') {
    if (!['accept', 'deny'].includes(val)) { logErr('', 'Must be accept/deny'); return }
    cfg[key] = val
  } else if (key === 'host') { cfg.host = val }
  else if (key === 'port') { cfg.port = parseInt(val, 10) }
  else { logErr('', `Unknown key: ${key}`); return }
  logInfo(cfg.name, `Config ${key} = ${cfg[key]}`)
  scheduleSave()
}

function showConfig(cfg) {
  logRaw('', `${C.bold}${cfg.name}${C.reset} — ${cfg.host}:${cfg.port}  ${cfg.connected ? C.g + '●' : C.r + '◌'}${C.reset}`)
  logRaw('', `  autoAfk: ${cfg.autoAfk}  autoJump: ${cfg.autoJump}  autoShift: ${cfg.autoShift}  autoEat: ${cfg.autoEat}  respack: ${cfg.resourcePack}`)
  logRaw('', `  onJoin: [${(cfg.onJoin?.commands || []).join(', ')}] [${(cfg.onJoin?.chat || []).join(', ')}]`)
}

function printHelp() {
  logRaw('', `${C.bold}── ${C.c}MineCline v${VERSION}${C.reset} Commands ──${C.reset}`)
  logRaw('', `  ${C.g}connect${C.reset} <name,names...> <host> [port] — Connect bot(s) (8s delay)`)
  logRaw('', `  ${C.g}disconnect${C.reset} [name | all]          — Disconnect bot(s)`)
  logRaw('', `  ${C.g}select${C.reset} <name>                  — Select single bot`)
  logRaw('', `  ${C.g}control${C.reset} <name1,name2|all>        — Multi-select bots`)
  logRaw('', `  ${C.g}global${C.reset}                         — Clear selection`)
  logRaw('', `  ${C.g}bots${C.reset}                           — List all bots`)
  logRaw('', `  ${C.y}Toggles:${C.reset} ${C.g}afk${C.reset}, ${C.g}jump${C.reset}, ${C.g}shift${C.reset}, ${C.g}eat${C.reset}, ${C.g}respack${C.reset}`)
  logRaw('', `  ${C.g}reconnect${C.reset} — Reconnect all saved bots (8s delay)`)
  logRaw('', `  ${C.g}chat/msg${C.reset} <text>                — Send chat`)
  logRaw('', `  ${C.g}/<cmd>${C.reset}                         — Server command`)
  logRaw('', `  ${C.g}inv${C.reset} [name]                     — Show inventory`)
  logRaw('', `  ${C.g}mcbridge${C.reset} <bot> <token> <chan> — MC↔Discord bridge`)
  logRaw('', `  ${C.g}bridge stop${C.reset}                    — Stop bridge`)
  logRaw('', `  ${C.g}config${C.reset} [name] [set k v]        — View/change config`)
  logRaw('', `  ${C.g}onjoin${C.reset} <name> add cmd|chat     — Join actions`)
  logRaw('', `  ${C.g}clear${C.reset}, ${C.g}save${C.reset}, ${C.g}quit${C.reset} — Utility`)
  logRaw('', `  ${C.g}update${C.reset} — Check for updates`)
  logRaw('', `  ${C.g}web${C.reset} [port|on|off] — Web dashboard config`)
  logRaw('', `  ${C.g}group${C.reset} list|create|delete|rename|add|remove — Bot groups`)
  logRaw('', `  ${C.g}savecmd${C.reset} list|add|remove|run — Saved commands`)
  logRaw('', `  ${C.g}script${C.reset} list|create|delete|addstep|run — Script runner`)
  logRaw('', `  ${C.g}players${C.reset} [name] — List players seen by a bot`)
  logRaw('', `  ${C.g}save${C.reset} — Save config to disk`)
}

function execCmd(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return

  history.push(trimmed)
  if (history.length > MAX_HISTORY) history.shift()
  histIdx = -1

  const parts = trimmed.split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const args = parts.slice(1)

  //  quit / exit ══
  if (cmd === 'quit' || cmd === 'exit') {
    exitFlag = true
    if (discordBridge) discordBridge.stop()
    for (const n of Object.keys(bots)) disconnectBot(n)
    setTimeout(() => process.exit(0), 200)
    return
  }

  //  help / clear ══
  if (cmd === 'help') {
    if (args[0]) {
      const details = {
        connect:    'connect <name,names...> <host> [port]\n  Connect one or more bots (comma-separated names) to a server. 8s delay between each.',
        disconnect: 'disconnect [name | all]\n  Disconnect a bot, the selected bot, or all bots.',
        select:     'select <name>\n  Select a single bot as the active target for commands.',
        control:    'control <name1,name2|all|global>\n  Multi-select bots. "all" selects every bot. "global" clears.',
        global:     'global\n  Clear current bot selection (same as "control global").',
        bots:       'bots\n  List all configured bots with status and toggles.',
        afk:        'afk [name]\n  Toggle AFK mode (walks in circles). Targets selected or named bot.',
        jump:       'jump [name]\n  Toggle auto-jump. Bot jumps every 1.5s.',
        shift:      'shift [name]\n  Toggle auto-shift (sneak).',
        eat:        'eat [name]\n  Toggle auto-eat when hungry.',
        respack:    'respack [name]\n  Toggle resource-pack auto-accept on/off.',
        reconnect:  'reconnect\n  Reconnect all saved bots with 8s delay between each.',
        chat:       'chat/msg <text>\n  Send a chat message as the selected bot(s).',
        inv:        'inv [name]\n  Show a bot\'s inventory (held item, armor, hotbar).',
        mcbridge:   'mcbridge <bot> <token> <channel>\n  Bridge Minecraft chat to a Discord channel.',
        'bridge stop': 'bridge stop\n  Stop the active Discord bridge.',
        config:     'config [name] [set <key> <val>]\n  View or change bot config (host, port, autoAfk, etc.).',
        onjoin:     'onjoin <name> add command|chat <text> | list | remove <idx>\n  Manage commands that run when a bot joins a server.',
        players:    'players [name]\n  List online players seen by the selected or named bot.',
        update:     'update\n  Check GitHub for a new version and update if available.',
        web:        'web [port <n> | on | off]\n  View or change web dashboard settings. Restart required for port change.',
        group:      'group list | create <name> | delete <name> | rename <old> <new> | add <group> <bot> | remove <group> <bot>\n  Manage bot groups.',
        savecmd:    'savecmd list | add <label> <cmd> | remove <idx> | run <idx>\n  Manage saved commands (quick-run from web/CLI).',
        script:     'script list | create <name> | delete <name> | addstep <name> <delay> <cmd> | run <name>\n  Run multi-step scripts with delays.',
        clear:      'clear\n  Clear the on-screen log.',
        save:       'save\n  Force-save config to disk immediately.',
        quit:       'quit\n  Disconnect all bots and exit.',
      }
      const d = details[args[0]] || details[`${args[0]} ${args[1] || ''}`.trim()]
      if (d) logRaw('', `${C.bold}${args[0]}${C.reset}\n  ${d}`)
      else logErr('', `No help for "${args[0]}"`)
      return
    }
    printHelp(); return
  }
  if (cmd === 'clear') { logLines = []; logInfo('', 'Log cleared'); return }

  //  connect ══
  if (cmd === 'connect') {
    if (args.length < 2) { logErr('', 'Usage: connect <name,names...> <host> [port]'); return }
    const rawNames = args[0]
    const host = args[1]
    const port = args[2] || '25565'
    const names = rawNames.split(',').map(s => s.trim()).filter(Boolean)
    if (names.length === 0) { logErr('', 'No bot names'); return }
    logInfo('', `Connecting ${names.length} bot(s) with 8s delay...`)
    names.forEach((name, i) => setTimeout(() => {
      if (bots[name] && bots[name].connected) { logWarn(name, 'Already connected'); return }
      createBot(name, host, port)
    }, i * 8000))
    activeBot = names[0]; selMode = 'single'; activeBots.clear()
    return
  }

  //  disconnect ══
  if (cmd === 'disconnect') {
    if (args[0] === 'all') { for (const n of Object.keys(bots)) disconnectBot(n); return }
    const name = args[0] || activeBot
    if (!name) { logErr('', 'Usage: disconnect [name | all]'); return }
    disconnectBot(name)
    return
  }

  //  bots ══
  if (cmd === 'bots') {
    const names = Object.keys(bots)
    if (names.length === 0) { logInfo('', 'No bots configured'); return }
    for (const n of names) {
      const b = bots[n]
      logRaw('', `${C.bold}${n}${C.reset} — ${b.connected ? C.g + '●' : C.r + '◌'}${C.reset} ${b.host}:${b.port} ${C.dim}AFK:${b.afkEnabled ? C.g + 'ON' : 'OFF'}${C.reset} ${C.dim}Eat:${b.autoEat ? C.g + 'ON' : 'OFF'}${C.reset} ${C.dim}Jump:${b.autoJump ? C.g + 'ON' : 'OFF'}${C.reset} ${C.dim}Shift:${b.autoShift ? C.g + 'ON' : 'OFF'}${C.reset}`)
    }
    return
  }

  //  select ══
  if (cmd === 'select') {
    if (!args[0]) { logErr('', 'Usage: select <name>'); return }
    if (!bots[args[0]]) { logErr('', `No bot "${args[0]}"`); return }
    activeBot = args[0]; activeBots.clear(); selMode = 'single'
    logInfo('', `Selected ${C.bold}${activeBot}${C.reset}`)
    return
  }

  //  control ══
  if (cmd === 'control') {
    if (args.length === 0) {
      if (selMode === 'multi' && activeBots.size > 0) logInfo('', `Multi: ${C.m}${[...activeBots].join(', ')}${C.reset}`)
      else if (activeBot) logInfo('', `Selected: ${C.bold}${activeBot}${C.reset}`)
      else logInfo('', 'No selection')
      return
    }
    const rawNames = args.join('')
    if (rawNames === 'all') {
      const all = Object.keys(bots)
      if (all.length === 0) { logErr('', 'No bots'); return }
      activeBots = new Set(all); selMode = 'multi'; activeBot = null
      logInfo('', `Selected all ${all.length} bots`); return
    }
    if (rawNames === 'none' || rawNames === 'global') {
      activeBot = null; activeBots.clear(); selMode = 'single'
      logInfo('', 'Cleared'); return
    }
    const names = rawNames.split(',').map(s => s.trim()).filter(Boolean)
    const valid = names.filter(n => bots[n])
    if (valid.length === 0) { logErr('', 'No valid bot names'); return }
    if (valid.length !== names.length) logWarn('', `Not found: ${names.filter(n => !bots[n]).join(', ')}`)
    if (valid.length === 1) { activeBot = valid[0]; activeBots.clear(); selMode = 'single'; logInfo('', `Selected ${C.bold}${activeBot}${C.reset}`) }
    else { activeBots = new Set(valid); selMode = 'multi'; activeBot = null; logInfo('', `Selected ${valid.length} bots: ${C.m}${valid.join(', ')}${C.reset}`) }
    return
  }

  //  global ══
  if (cmd === 'global' || cmd === 'gloval') {
    activeBot = null; activeBots.clear(); selMode = 'single'
    logInfo('', 'Cleared selection')
    return
  }

  //  toggles
  if (cmd === 'afk') {
    if (!forTargets(args[0], (t) => { if (t.afkEnabled) { stopAfk(t.name); logWarn(t.name, 'AFK stopped') } else { startAfk(t.name); logInfo(t.name, 'AFK started') } })) return
    scheduleSave(); return
  }

  if (cmd === 'jump') {
    if (!forTargets(args[0], (t) => {
      if (!t.bot) { logErr(t.name, 'Not connected'); return }
      t.autoJump = !t.autoJump
      if (t.autoJump) {
        t.autoJumpInterval = setInterval(() => {
          if (!t.connected || !t.joined || !t.bot?.entity?.onGround) return
          t.bot.setControlState('jump', true); setTimeout(() => t.bot.setControlState('jump', false), 200)
        }, 1500)
        logInfo(t.name, 'Auto-jump ON')
      } else {
        if (t.autoJumpInterval) { clearInterval(t.autoJumpInterval); t.autoJumpInterval = null }
        logInfo(t.name, 'Auto-jump OFF')
      }
    })) return
    scheduleSave(); return
  }

  if (cmd === 'eat') {
    if (!forTargets(args[0], (t) => { t.autoEat = !t.autoEat; logInfo(t.name, `Auto-eat ${t.autoEat ? 'ON' : 'OFF'}`) })) return
    scheduleSave(); return
  }

  if (cmd === 'shift') {
    if (!forTargets(args[0], (t) => {
      t.autoShift = !t.autoShift
      if (t.autoShift) {
        if (t.bot && t.connected) { t.bot.setControlState('sneak', true) }
        logInfo(t.name, 'Auto-shift ON')
      } else {
        if (t.bot && t.connected) { t.bot.setControlState('sneak', false) }
        logInfo(t.name, 'Auto-shift OFF')
      }
    })) return
    scheduleSave(); return
  }

  //  reconnect (reconnect all saved bots) ══
  if (cmd === 'reconnect') {
    const all = Object.keys(bots).filter(n => bots[n].host)
    if (all.length === 0) { logErr('', 'No saved bots'); return }
    logInfo('', `Reconnecting ${all.length} saved bot(s) with 8s delay...`)
    all.forEach((name, i) => setTimeout(() => createBot(name, bots[name].host, bots[name].port), i * 8000))
    return
  }

  if (cmd === 'respack') {
    if (!forTargets(args[0], (t) => {
      t.resourcePack = t.resourcePack === 'accept' ? 'deny' : 'accept'
      logInfo(t.name, `Resource pack: ${t.resourcePack === 'accept' ? C.g + 'auto-accept' + C.reset : C.y + 'deny' + C.reset}`)
    })) return
    scheduleSave(); return
  }

  //  chat / msg ══
  if (cmd === 'chat' || cmd === 'msg') {
    const text = args.join(' ')
    if (!text) { logErr('', 'Usage: chat <text>'); return }
    if (!forTargets(null, (t) => {
      if (!t.bot || !t.connected) { logErr(t.name, 'Not connected'); return }
      t.bot.chat(text); logChat(t.name, `> ${text}`)
    })) return
    return
  }

  //  players ══
  if (cmd === 'players') {
    const targets = getTargets(args[0] || null)
    if (targets.length === 0) return
    for (const t of targets) {
      if (!t.bot || !t.connected) { logErr(t.name, 'Not connected'); continue }
      const list = t.players ? Object.keys(t.players) : []
      logRaw(t.name, `${C.bold}Players online${C.reset} (${list.length}): ${list.length ? list.join(', ') : C.dim + 'none' + C.reset}`)
    }
    return
  }

  //  /command ══
  if (cmd.startsWith('/')) {
    if (!forTargets(null, (t) => {
      if (!t.bot || !t.connected) { logErr(t.name, 'Not connected'); return }
      t.bot.chat(trimmed); logInfo(t.name, `Cmd: ${trimmed.slice(0, 60)}`)
    })) return
    return
  }

  //  inv (inventory viewer) ══
  if (cmd === 'inv') {
    const targets = getTargets(args[0] || null)
    if (targets.length === 0) return
    for (const cfg of targets) {
      if (!cfg.bot || !cfg.connected) { logErr(cfg.name, 'Not connected'); continue }
      logRaw(cfg.name, `${C.bold}Inventory:${C.reset}`)
      if (cfg.heldItem) logRaw(cfg.name, `  ${C.gry}✊${C.reset} Held: ${C.bold}${cfg.heldItem.name}${C.reset} x${cfg.heldItem.count} (slot ${cfg.heldItem.slot})`)
      if (cfg.armor.length > 0) {
        const armorStr = cfg.armor.map(a => `${C.c}${a.name}${C.reset}`).join(', ')
        logRaw(cfg.name, `  ${C.gry}🪖${C.reset} Armor: ${armorStr}`)
      }
      if (cfg.inventoryItems.length === 0) { logRaw(cfg.name, `  ${C.dim}(empty)${C.reset}`); continue }
      const hotbar = cfg.inventoryItems.filter(i => i.slot < 9)
      const rest = cfg.inventoryItems.filter(i => i.slot >= 9)
      logRaw(cfg.name, `  ${C.gry}📦${C.reset} ${C.bold}Hotbar:${C.reset}`)
      for (const item of hotbar) {
        logRaw(cfg.name, `    [${item.slot}] ${item.name} x${item.count}`)
      }
      if (rest.length > 0) {
        logRaw(cfg.name, `  ${C.gry}📦${C.reset} ${C.bold}Inventory:${C.reset}`)
        for (const item of rest) {
          logRaw(cfg.name, `    [${item.slot}] ${item.name} x${item.count}`)
        }
      }
      logRaw(cfg.name, `  Total: ${cfg.inventoryCount} items | ${cfg.armor.length} armor pieces`)
    }
    return
  }

  //  mcbridge / bridge ══
  if (cmd === 'mcbridge' || cmd === 'bridge') {
    if (args[0] === 'stop') {
      if (discordBridge) { discordBridge.stop(); logInfo('', 'Discord bridge stopped') }
      else logWarn('', 'No bridge active')
      return
    }
    if (args.length < 3) { logErr('', 'Usage: mcbridge <botname> <discord_token> <channel_id>'); return }
    const botName = args[0]; const token = args[1]; const channelId = args[2]
    if (!bots[botName]) { logErr('', `No bot "${botName}"`); return }
    if (discordBridge) { discordBridge.stop(); logInfo('', 'Replacing existing bridge...') }
    discordBridge = new DiscordBridge(botName, token, channelId)
    if (!discordBridge.Ws) { discordBridge = null; return }
    // Forward from Discord to MC
    discordBridge.onDiscordMessage = (username, content) => {
      if (!bots[botName]?.bot || !bots[botName]?.connected) {
        logWarn('', 'Bot disconnected, bridge paused')
        return
      }
      // Ignore bot's own messages
      if (username.toLowerCase() === botName.toLowerCase()) return
      // Strip @mentions to prevent pings
      const clean = content.replace(/@/g, '@\u200b')
      try { bots[botName].bot.chat(clean); logChat(botName, `[Discord] ${username}: ${clean}`) } catch {}
    }
    logInfo(botName, `Bridge started → channel ${channelId}`)
    return
  }

  //  config ══
  if (cmd === 'config') {
    // config <bot> set <key> <val>
    if (args.length >= 4 && bots[args[0]] && args[1] === 'set') {
      return setConfig(bots[args[0]], args[2], args.slice(3).join(' '))
    }
    // config set <key> <val>
    if (args.length >= 3 && args[0] === 'set') {
      const targets = getTargets(null)
      if (targets.length === 0) return
      for (const t of targets) setConfig(t, args[1], args.slice(2).join(' '))
      return
    }
    // config <bot>
    if (args.length === 1 && bots[args[0]]) { showConfig(bots[args[0]]); return }
    // config (show current selection)
    if (args.length === 0) {
      const targets = getTargets(null)
      if (targets.length === 0) return
      for (const t of targets) showConfig(t)
      return
    }
    logErr('', 'Usage: config [name] | config set <key> <val> | config <bot> set <key> <val>')
    return
  }

  //  onjoin ══
  if (cmd === 'onjoin') {
    if (args.length < 2) { logErr('', 'Usage: onjoin <name> add command|chat <text> | list | remove <idx>'); return }
    const name = args[0]
    if (!bots[name]) { logErr('', `No bot "${name}"`); return }
    const cfg = bots[name]; const sub = args[1].toLowerCase()
    if (sub === 'add' && args.length >= 4) {
      const type = args[2].toLowerCase(); const text = args.slice(3).join(' ')
      cfg.onJoin = cfg.onJoin || { commands: [], chat: [] }
      if (type === 'command') { cfg.onJoin.commands.push(text); logInfo(name, `Added on-join cmd: /${text}`) }
      else if (type === 'chat') { cfg.onJoin.chat.push(text); logInfo(name, `Added on-join chat: ${text}`) }
      else { logErr('', 'Use "command" or "chat"'); return }
      scheduleSave(); return
    }
    if (sub === 'list') {
      const oj = cfg.onJoin || { commands: [], chat: [] }
      logRaw(name, `${C.bold}On-join actions:${C.reset}`)
      for (let i = 0; i < oj.commands.length; i++) logRaw(name, `  ${C.b}${i}${C.reset}. cmd: /${oj.commands[i]}`)
      for (let i = 0; i < oj.chat.length; i++) logRaw(name, `  ${C.b}${oj.commands.length + i}${C.reset}. chat: ${oj.chat[i]}`)
      if (oj.commands.length === 0 && oj.chat.length === 0) logRaw(name, '  (none)')
      return
    }
    if (sub === 'remove' && args.length >= 3) {
      const idx = parseInt(args[2], 10)
      if (isNaN(idx)) { logErr('', 'Invalid index'); return }
      const oj = cfg.onJoin || { commands: [], chat: [] }
      const total = oj.commands.length + oj.chat.length
      if (idx < 0 || idx >= total) { logErr('', `Index 0-${total - 1}`); return }
      if (idx < oj.commands.length) { const r = oj.commands.splice(idx, 1); logInfo(name, `Removed cmd: ${r[0]}`) }
      else { const r = oj.chat.splice(idx - oj.commands.length, 1); logInfo(name, `Removed chat: ${r[0]}`) }
      scheduleSave(); return
    }
    logErr('', 'Usage: onjoin <name> add command|chat <text> | list | remove <idx>')
    return
  }

  //  update ══
  if (cmd === 'update') { checkAutoUpdate(); return }

  //  web ══
  if (cmd === 'web') {
    if (args[0] === 'port') {
      appConfig.web.port = parseInt(args[1], 10) || 3000
      logInfo('', `Web port set to ${appConfig.web.port} (restart required)`)
    } else if (args[0] === 'on') {
      appConfig.web.enabled = true; scheduleSave(); logInfo('', 'Web server enabled (restart required)')
    } else if (args[0] === 'off') {
      appConfig.web.enabled = false; scheduleSave(); logInfo('', 'Web server disabled')
    } else {
      logRaw('', `Web dashboard: ${appConfig.web.enabled ? C.g + 'enabled' : C.r + 'disabled'}${C.reset} on port ${C.c}${appConfig.web.port}${C.reset}`)
    }
    scheduleSave(); return
  }

  //  group ══
  if (cmd === 'group') {
    if (args[0] === 'list') {
      const entries = Object.entries(botGroups)
      if (entries.length === 0) logInfo('', 'No groups')
      else for (const [g, members] of entries) logRaw('', `${C.b}${g}${C.reset}: ${members.join(', ')}`)
      return
    }
    if (args[0] === 'create' && args[1]) {
      if (botGroups[args[1]]) { logErr('', 'Group already exists'); return }
      botGroups[args[1]] = []; logInfo('', `Group "${args[1]}" created`); scheduleSave(); return
    }
    if (args[0] === 'delete' && args[1]) {
      if (!botGroups[args[1]]) { logErr('', 'No such group'); return }
      delete botGroups[args[1]]; logInfo('', `Group "${args[1]}" deleted`); scheduleSave(); return
    }
    if (args[0] === 'rename' && args[1] && args[2]) {
      if (!botGroups[args[1]]) { logErr('', 'No such group'); return }
      if (botGroups[args[2]]) { logErr('', 'Name already taken'); return }
      botGroups[args[2]] = botGroups[args[1]]; delete botGroups[args[1]]; logInfo('', `Renamed to "${args[2]}"`); scheduleSave(); return
    }
    if (args[0] === 'add' && args[1] && args[2]) {
      if (!botGroups[args[1]]) { logErr('', 'No such group'); return }
      if (!bots[args[2]]) { logErr('', 'No such bot'); return }
      if (botGroups[args[1]].includes(args[2])) { logErr('', 'Bot already in group'); return }
      botGroups[args[1]].push(args[2]); logInfo('', `Added ${args[2]} to ${args[1]}`); scheduleSave(); return
    }
    if (args[0] === 'remove' && args[1] && args[2]) {
      if (!botGroups[args[1]]) { logErr('', 'No such group'); return }
      const idx = botGroups[args[1]].indexOf(args[2])
      if (idx === -1) { logErr('', 'Bot not in group'); return }
      botGroups[args[1]].splice(idx, 1); logInfo('', `Removed ${args[2]} from ${args[1]}`); scheduleSave(); return
    }
    logErr('', 'Usage: group list | create <name> | delete <name> | add <group> <bot> | remove <group> <bot>')
    return
  }

  //  savecmd ══
  if (cmd === 'savecmd') {
    if (args[0] === 'list') {
      if (savedCommands.length === 0) logInfo('', 'No saved commands')
      else savedCommands.forEach((c, i) => logRaw('', `${C.b}${i}${C.reset}. ${c.label}: ${c.command}`))
      return
    }
    if (args[0] === 'add' && args[1] && args[2]) {
      savedCommands.push({ label: args[1], command: args.slice(2).join(' ') })
      logInfo('', `Saved command "${args[1]}"`); scheduleSave(); return
    }
    if (args[0] === 'remove' && args[1]) {
      const idx = parseInt(args[1], 10)
      if (isNaN(idx) || idx < 0 || idx >= savedCommands.length) { logErr('', 'Invalid index'); return }
      savedCommands.splice(idx, 1); logInfo('', 'Removed'); scheduleSave(); return
    }
    if (args[0] === 'run' && args[1]) {
      const idx = parseInt(args[1], 10)
      if (isNaN(idx) || idx < 0 || idx >= savedCommands.length) { logErr('', 'Invalid index'); return }
      const cmd = savedCommands[idx]
      if (!forTargets(null, (t) => {
        if (!t.bot || !t.connected) { logErr(t.name, 'Not connected'); return }
        t.bot.chat(cmd.command); logChat(t.name, `[saved] ${cmd.command}`)
      })) return
      return
    }
    logErr('', 'Usage: savecmd list | add <label> <cmd> | remove <idx> | run <idx>')
    return
  }

  //  script ══
  if (cmd === 'script') {
    if (args[0] === 'list') {
      const entries = Object.entries(savedScripts)
      if (entries.length === 0) logInfo('', 'No scripts')
      else for (const [s, steps] of entries) logRaw('', `${C.b}${s}${C.reset}: ${steps.length} steps`)
      return
    }
    if (args[0] === 'create' && args[1]) {
      if (savedScripts[args[1]]) { logErr('', 'Script already exists'); return }
      savedScripts[args[1]] = []; logInfo('', `Script "${args[1]}" created`); scheduleSave(); return
    }
    if (args[0] === 'delete' && args[1]) {
      if (!savedScripts[args[1]]) { logErr('', 'No such script'); return }
      delete savedScripts[args[1]]; logInfo('', 'Deleted'); scheduleSave(); return
    }
    if (args[0] === 'addstep' && args[1] && args[2] && args[3]) {
      if (!savedScripts[args[1]]) { logErr('', 'No such script'); return }
      savedScripts[args[1]].push({ delay: parseInt(args[2], 10) || 1000, content: args.slice(3).join(' ') })
      logInfo('', 'Step added'); scheduleSave(); return
    }
    if (args[0] === 'run' && args[1]) {
      const script = savedScripts[args[1]]
      if (!script) { logErr('', 'No such script'); return }
      let totalDelay = 0
      for (const step of script) {
        totalDelay += step.delay
        setTimeout(() => {
          if (!forTargets(null, (t) => {
            if (!t.bot || !t.connected) { logErr(t.name, 'Not connected'); return }
            t.bot.chat(step.content); logChat(t.name, `[script] ${step.content}`)
          })) return
        }, totalDelay)
      }
      logInfo('', `Running script "${args[1]}" (${script.length} steps)`)
      return
    }
    logErr('', 'Usage: script list | create <name> | delete <name> | addstep <name> <delay> <cmd> | run <name>')
    return
  }

  //  save ══
  if (cmd === 'save') { saveConfig(); logInfo('', 'Config saved'); return }

  logErr('', `Unknown: "${cmd}". Type ${C.bold}help${C.reset}.`)
}

//  input handling

function onKeypress(str, key) {
  if (!key) return
  if (key.ctrl && key.name === 'c') { cleanup(); process.exit(0) }
  if (key.ctrl && key.name === 'l') { logInfo('', '—'.repeat(20)); return }

  if (key.name === 'return' || key.name === 'enter') {
    const cmd = input; input = ''; cursor = 0
    redrawPrompt()
    execCmd(cmd)
    redrawPrompt()
    return
  }

  if (key.name === 'backspace') { if (cursor > 0) { input = input.slice(0, cursor - 1) + input.slice(cursor); cursor--; redrawPrompt() } return }
  if (key.name === 'delete') { if (cursor < input.length) { input = input.slice(0, cursor) + input.slice(cursor + 1); redrawPrompt() } return }
  if (key.name === 'left') { if (cursor > 0) { cursor--; redrawPrompt() } return }
  if (key.name === 'right') { if (cursor < input.length) { cursor++; redrawPrompt() } return }
  if (key.name === 'home') { cursor = 0; redrawPrompt(); return }
  if (key.name === 'end') { cursor = input.length; redrawPrompt(); return }

  if (key.name === 'up') {
    if (history.length > 0) {
      if (histIdx === -1) histIdx = history.length - 1
      else histIdx = Math.max(0, histIdx - 1)
      input = history[histIdx]; cursor = input.length; redrawPrompt()
    }
    return
  }

  if (key.name === 'down') {
    if (histIdx !== -1) {
      histIdx++
      if (histIdx >= history.length) { histIdx = -1; input = '' }
      else input = history[histIdx]
      cursor = input.length; redrawPrompt()
    }
    return
  }

  if (key.name === 'tab') {
    const parts = input.split(/\s+/); const partial = parts[0].toLowerCase()
    if (parts.length === 1) {
      const matches = CMD_LIST.filter(c => c.startsWith(partial))
      if (matches.length === 1) { input = matches[0] + ' '; cursor = input.length; redrawPrompt() }
      else if (matches.length > 1) { logInfo('', C.gry + matches.join('  ') + C.reset) }
    } else if (parts.length >= 2) {
      const botCmds = ['select', 'control', 'disconnect', 'config', 'onjoin', 'afk', 'jump', 'eat', 'reconnect', 'respack', 'inv', 'mcbridge', 'bridge', 'players', 'group']
      if (botCmds.includes(parts[0])) {
        const lastPart = parts[parts.length - 1]
        const prefix = lastPart.includes(',') ? lastPart.slice(0, lastPart.lastIndexOf(',') + 1) : ''
        const current = lastPart.includes(',') ? lastPart.slice(lastPart.lastIndexOf(',') + 1) : lastPart
        const matches = Object.keys(bots).filter(n => n.startsWith(current))
        if (matches.length === 1) {
          parts[parts.length - 1] = prefix + matches[0]
          input = parts.join(' ') + ' '; cursor = input.length; redrawPrompt()
        } else if (matches.length > 1) { logInfo('', C.gry + matches.join('  ') + C.reset) }
      }
    }
    return
  }

  if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
    input = input.slice(0, cursor) + str + input.slice(cursor); cursor++; redrawPrompt()
  }
}

//  web server

function getState() {
  const state = {
    bots: {}, groups: botGroups, serverCounts,
    commandHistory: commandHistory.slice(-100), alertLog: alertLog.slice(-100),
    playerHistory: playerCountHistory,
    savedCommands, savedScripts, logLines: logLines.slice(-100).map(e => ({ ...e, text: stripAnsi(e.text) })),
  }
  for (const [name, cfg] of Object.entries(bots)) {
    state.bots[name] = {
      name, host: cfg.host, port: cfg.port, connected: !!cfg.connected,
      joined: !!cfg.joined, health: cfg.health, food: cfg.food,
      x: cfg.x, y: cfg.y, z: cfg.z, ping: cfg.ping, dimension: cfg.dimension,
      error: cfg.error, kickedReason: cfg.kickedReason,
      connectedAt: cfg.connectedAt, afkEnabled: !!cfg.afkEnabled,
      players: cfg.players,
    }
  }
  return state
}

function broadcast() {
  if (!wss) return
  const data = JSON.stringify(getState())
  for (const ws of wsClients) {
    if (ws.readyState === 1) { try { ws.send(data) } catch {} }
  }
}

function startBroadcast() {
  if (broadcastInterval) clearInterval(broadcastInterval)
  broadcastInterval = setInterval(broadcast, 1000)
}

function startWebServer(port) {
  try {
    webApp = express()
    webServer = http.createServer(webApp)
    wss = new WebSocketServer({ server: webServer })

    webApp.use(express.static(path.join(__dirname, 'public')))

    wss.on('connection', (ws) => {
      wsClients.add(ws)
      ws.send(JSON.stringify(getState()))
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          msg.ws = ws
          handleWSCommand(msg)
        } catch {}
      })
      ws.on('close', () => { wsClients.delete(ws) })
    })

    webServer.listen(port, () => {
      logInfo('', `Web dashboard at ${C.c}http://localhost:${port}${C.reset}`)
    })
    startBroadcast()
  } catch (e) {
    logErr('', `Web server failed: ${e.message}`)
  }
}

function handleWSCommand(msg) {
  if (msg.type === 'command') {
    const names = msg.targets ? msg.targets.split(',').filter(Boolean) : []
    const text = msg.content || ''
    for (const n of names) {
      const cfg = bots[n]
      if (!cfg || !cfg.bot || !cfg.connected) continue
      if (text.startsWith('/')) {
        cfg.bot.chat(text)
        logInfo(n, `Cmd: ${text.slice(0, 60)}`)
      } else {
        cfg.bot.chat(text)
        logChat(n, `> ${text}`)
      }
    }
    commandHistory.push({ t: ts(), bots: names.join(','), type: text.startsWith('/') ? 'cmd' : 'chat', content: text })
    if (commandHistory.length > 500) commandHistory.splice(0, commandHistory.length - 500)
    broadcast()
  }
  if (msg.type === 'preset') {
    const names = msg.targets ? msg.targets.split(',').filter(Boolean) : []
    const action = msg.action
    for (const n of names) {
      const cfg = bots[n]
      if (!cfg) continue
      if (action === 'afk') {
        if (cfg.afkEnabled) stopAfk(n)
        else startAfk(n)
      }
      if (action === 'jump' || action === 'eat' || action === 'shift') {
        if (!cfg.bot || !cfg.connected) continue
        cfg[`auto${action.charAt(0).toUpperCase() + action.slice(1)}`] = !cfg[`auto${action.charAt(0).toUpperCase() + action.slice(1)}`]
      }
    }
    scheduleSave()
    broadcast()
  }
  if (msg.type === 'connect') {
    const name = msg.name, host = msg.host, port = msg.port || '25565'
    if (!name || !host) return
    if (bots[name]) { logWarn('', `Bot "${name}" already exists`); broadcast(); return }
    bots[name] = { ...DEFAULT_BOT_CONFIG, host, port: parseInt(port, 10), name, connected: false, joined: false }
    logInfo('', `Configured bot "${name}" → ${host}:${port}`)
    scheduleSave()
    setTimeout(() => createBot(name, host, port), 1000)
    broadcast()
  }
  if (msg.type === 'disconnect') {
    const name = msg.name
    if (name && bots[name]) disconnectBot(name)
    broadcast()
  }
  if (msg.type === 'deleteBot') {
    const name = msg.name
    if (name && bots[name]) {
      if (bots[name].connected) disconnectBot(name)
      delete bots[name]
      scheduleSave()
      broadcast()
    }
  }
  if (msg.type === 'group') {
    const { action, name, bot } = msg
    if (action === 'create' && name && !botGroups[name]) { botGroups[name] = []; scheduleSave(); broadcast() }
    if (action === 'delete' && name && botGroups[name]) { delete botGroups[name]; scheduleSave(); broadcast() }
    if (action === 'rename' && name && msg.newName && botGroups[name]) { botGroups[msg.newName] = botGroups[name]; delete botGroups[name]; scheduleSave(); broadcast() }
    if (action === 'add' && name && bot && botGroups[name] && bots[bot] && !botGroups[name].includes(bot)) { botGroups[name].push(bot); scheduleSave(); broadcast() }
    if (action === 'remove' && name && bot && botGroups[name]) {
      const idx = botGroups[name].indexOf(bot)
      if (idx !== -1) { botGroups[name].splice(idx, 1); scheduleSave(); broadcast() }
    }
  }
  if (msg.type === 'savecmd') {
    const { action, label, command, idx } = msg
    if (action === 'add' && label && command) { savedCommands.push({ label, command }); scheduleSave(); broadcast() }
    if (action === 'remove' && typeof idx === 'number' && idx >= 0 && idx < savedCommands.length) { savedCommands.splice(idx, 1); scheduleSave(); broadcast() }
    if (action === 'run' && typeof idx === 'number' && idx >= 0 && idx < savedCommands.length) {
      const cmd = savedCommands[idx]
      const targets = Object.values(bots).filter(b => b.connected)
      for (const t of targets) { if (t.bot) t.bot.chat(cmd.command) }
      broadcast()
    }
  }
  if (msg.type === 'script') {
    const { action, name, step } = msg
    if (action === 'create' && name && !savedScripts[name]) { savedScripts[name] = []; scheduleSave(); broadcast() }
    if (action === 'delete' && name && savedScripts[name]) { delete savedScripts[name]; scheduleSave(); broadcast() }
    if (action === 'addstep' && name && savedScripts[name]) {
      savedScripts[name].push({ delay: step?.delay || 1000, content: step?.content || '' })
      scheduleSave(); broadcast()
    }
    if (action === 'removestep' && name && savedScripts[name] && typeof step === 'number') {
      savedScripts[name].splice(step, 1); scheduleSave(); broadcast()
    }
    if (action === 'run' && name && savedScripts[name]) {
      const script = savedScripts[name]; let totalDelay = 0
      for (const s of script) {
        totalDelay += s.delay
        setTimeout(() => {
          const targets = Object.values(bots).filter(b => b.connected)
          for (const t of targets) { if (t.bot) t.bot.chat(s.content) }
        }, totalDelay)
      }
    }
  }
  if (msg.type === 'exportConfig') {
    const safe = JSON.parse(JSON.stringify({ version: VERSION, web: appConfig.web, autoUpdate: appConfig.autoUpdate, groups: botGroups, savedCommands, savedScripts, bots: Object.entries(bots).reduce((a, [k, v]) => { a[k] = { host: v.host, port: v.port, autoAfk: !!v.autoAfk, autoJump: !!v.autoJump, autoShift: !!v.autoShift, autoEat: !!v.autoEat, resourcePack: v.resourcePack || 'accept' }; return a }, {}) }))
    if (msg.ws && msg.ws.readyState === 1) {
      try { msg.ws.send(JSON.stringify({ type: 'configExport', data: safe })) } catch {}
    }
  }
  if (msg.type === 'importConfig') {
    try {
      const d = msg.data
      if (d.groups) botGroups = d.groups
      if (d.savedCommands) savedCommands = d.savedCommands
      if (d.savedScripts) savedScripts = d.savedScripts
      if (d.bots) {
        for (const [name, cfg] of Object.entries(d.bots)) {
          if (!bots[name]) bots[name] = { ...DEFAULT_BOT_CONFIG, ...cfg, name, connected: false, joined: false }
        }
      }
      if (d.web) appConfig.web = { ...appConfig.web, ...d.web }
      scheduleSave()
      logInfo('', 'Config imported')
      broadcast()
    } catch (e) { logErr('', `Import failed: ${e.message}`) }
  }
}

//  auto-update

function promptUpdate(currentVer, remoteVer) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = () => {
    rl.question(`\n${C.c}Hello. We detected you are using version ${C.bold}${currentVer}${C.reset}${C.c}.${C.reset}\n` +
      `${C.c}Would you like us to automatically update to the latest version ${C.bold}${remoteVer}${C.reset}${C.c}?${C.reset}\n` +
      `${C.g}[Y]es${C.reset}  ${C.y}[N]o${C.reset}  ${C.dim}[Never] ask again${C.reset}\n> `, (answer) => {
      const a = answer.trim().toLowerCase()
      if (a === 'y' || a === 'yes') {
        rl.close(); doUpdate(remoteVer)
      } else if (a === 'never' || a === 'n') {
        appConfig.autoUpdate = false; scheduleSave()
        logInfo('', 'Auto-update disabled.'); rl.close(); redrawPrompt()
      } else {
        logWarn('', 'Please answer Y, N, or Never.')
        ask()
      }
    })
  }
  ask()
}

function doUpdate(remoteVer) {
  const mainUrl = `${REPO_BASE}/minecline.js`
  const publicFiles = ['index.html', 'style.css', 'app.js']
  let completed = 0; const total = 1 + publicFiles.length; let hadError = false
  let dlDone = false

  const startTime = Date.now()
  const animFrames = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
  let frame = 0
  let lastProgress = 0

  function drawProgress(pct, status) {
    const elapsed = Math.min(8000, Date.now() - startTime)
    const overallPct = Math.min(100, Math.round((pct * 0.5 + (elapsed / 8000) * 0.5) * 100))
    const w = 30
    const filled = Math.round(w * overallPct / 100)
    const bar = `${C.g}${'█'.repeat(filled)}${C.dim}${'░'.repeat(w - filled)}${C.reset}`
    const spinner = animFrames[frame % animFrames.length]
    const prefix = overallPct < 100 ? `${C.bold}${C.c}${spinner}${C.reset} ${C.bold}UPDATE${C.reset}` : `${C.g}${C.bold}✔${C.reset} ${C.bold}UPDATE${C.reset}`
    process.stdout.write(`\r${prefix} ${bar} ${C.bold}${overallPct}%${C.reset} ${C.dim}${status || ''}${C.reset}\x1b[K`)
    if (overallPct < 100) frame++
  }

  const animInterval = setInterval(() => {
    const pct = dlDone ? 1 : (completed / total)
    drawProgress(pct, dlDone ? 'Finishing...' : `Downloading (${completed}/${total})`)
    if (dlDone && Date.now() - startTime >= 8000) {
      clearInterval(animInterval)
      const color = hadError ? C.r : C.g
      const icon = hadError ? '✖' : '✔'
      process.stdout.write(`\r${color}${C.bold}${icon}${C.reset} ${C.bold}UPDATE${C.reset} ${hadError ? `${C.r}completed with errors${C.reset}` : `${C.g}to v${remoteVer}${C.reset}`} ${C.dim}(8.0s)${C.reset}\x1b[K\n`)
      if (hadError) { redrawPrompt(); return }
      logInfo('', `${C.g}Updated to v${remoteVer}! Restarting...${C.reset}`)
      setTimeout(() => process.exit(0), 1500)
    }
  }, 80)

  function dl(url, dest) {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { logErr('', `Download failed: ${url}`); hadError = true; checkDone(); return }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          if (dest) {
            const dir = path.dirname(dest)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(dest, data, 'utf8')
          }
          completed++; checkDone()
        } catch (e) { logErr('', `Write failed: ${dest}: ${e.message}`); hadError = true; checkDone() }
      })
    }).on('error', (e) => { logErr('', `Download error: ${e.message}`); hadError = true; checkDone() })
  }

  function checkDone() {
    if (completed < total) return
    dlDone = true
  }

  const bak = __filename + '.bak'
  if (fs.existsSync(__filename)) fs.copyFileSync(__filename, bak)
  dl(mainUrl, __filename)
  for (const f of publicFiles) dl(`${REPO_BASE}/public/${f}`, path.join(__dirname, 'public', f))
}

function checkForceUpdate() {
  return new Promise((resolve) => {
    const url = `${REPO_BASE_REF}/UPDATENOW.txt`
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        const lines = data.trim().split('\n')
        const isForce = lines[0]?.trim().toUpperCase() === 'TRUE'
        resolve(isForce)
      })
      res.on('error', () => resolve(false))
    }).on('error', () => resolve(false))
  })
}

function checkAutoUpdate() {
  if (!appConfig.autoUpdate && !exitFlag) return
  const url = `${REPO_BASE}/minecline.js`
  https.get(url, (res) => {
    let data = ''
    res.on('data', (chunk) => { data += chunk })
    res.on('end', async () => {
      const match = data.match(/const VERSION = '([^']+)'/)
      if (!match) return
      const remoteVer = match[1]
      if (remoteVer === VERSION) return

      setTimeout(async () => {
        const forced = await checkForceUpdate()
        if (forced) {
          setTimeout(() => doUpdate(remoteVer), 500)
        } else if (appConfig.autoUpdate) {
          promptUpdate(VERSION, remoteVer)
        } else {
          logInfo('', `Update available: v${VERSION} → ${C.c}v${remoteVer}${C.reset} (use "update" to install)`)
          redrawPrompt()
        }
      }, 500)
    })
  }).on('error', () => {})
}

//  lifecycle / init

function cleanup() {
  try { process.stdin.setRawMode(false) } catch {}
  process.stdin.pause()
  process.stdout.write('\x1b[?25h\x1b[0m\n')
}

function init() {
  try { fs.writeFileSync(LOG_PATH, '', 'utf8') } catch {} // ¯\_(ツ)_/¯
  process.stdout.write('\x1b[?25l')
  loadConfig()
  registerLifecycle()

  // first-time setup
  if (!appConfig._setup) {
    process.stdout.write(`\n${C.c}Do you want to enable the web dashboard panel?${C.reset}\n${C.g}[Y]es${C.reset}  ${C.dim}[n]o${C.reset}\n> `)
    process.stdin.resume()
    process.stdin.once('data', (buf) => {
      const ans = buf.toString().trim().toLowerCase()
      if (ans === '' || ans === 'y' || ans === 'yes') {
        appConfig.web.enabled = true
        logInfo('', `Web dashboard ${C.g}enabled${C.reset}`)
      } else {
        appConfig.web.enabled = false
        logInfo('', 'Web dashboard disabled (can be changed in config.json)')
      }
      appConfig._setup = true
      scheduleSave()
      showLogo()
    })
    return
  }

  showLogo()
}

function showLogo() {
  const logo = [
    `${C.m}  ════════════════════════════${C.reset}`,
    `${C.m}  ║${C.reset}  ${C.c}███╗   ███╗${C.reset}${C.g}██╗${C.reset}${C.y}███╗${C.reset}   ${C.b}██╗${C.reset}  ${C.m}║${C.reset}`,
    `${C.m}  ║${C.reset}  ${C.c}████╗ ████║${C.reset}${C.g}██║${C.reset}${C.y}████╗${C.reset}  ${C.b}██║${C.reset}  ${C.m}║${C.reset}`,
    `${C.m}  ║${C.reset}  ${C.c}██╔████╔██║${C.reset}${C.g}██║${C.reset}${C.y}██╔██╗${C.reset} ${C.b}██║${C.reset}  ${C.m}║${C.reset}`,
    `${C.m}  ║${C.reset}  ${C.c}██║╚██╔╝██║${C.reset}${C.g}██║${C.reset}${C.y}██║╚██╗${C.reset}${C.b}██║${C.reset}  ${C.m}║${C.reset}`,
    `${C.m}  ║${C.reset}  ${C.c}██║ ╚═╝ ██║${C.reset}${C.g}██║${C.reset}${C.y}██║ ╚████║${C.reset}  ${C.m}║${C.reset}`,
    `${C.m}  ║${C.reset}  ${C.c}╚═╝     ╚═╝${C.reset}${C.g}╚═╝${C.reset}${C.y}╚═╝  ╚═══╝${C.reset}  ${C.m}║${C.reset}`,
    `${C.m}  ════════════════════════════${C.reset}`,
  ]

  const bars = ['▁▂▃▄▅▆▇█▇▆▅▄▃▂▁', '█▇▆▅▄▃▂▁▂▃▄▅▆▇█', '▁▃▅▇█▇▅▃▁', '█▆▄▂▄▆█']
  const msgs = ['  firing up mineflayer...', '  loading your bots...', '  almost there...', '  ready!']

  let step = 0, frame = 0
  const loadInterval = setInterval(() => {
    process.stdout.write('\r\x1b[K')
    if (step < logo.length) {
      process.stdout.write(`${logo[step]}\n`)
      step++
    } else if (step < logo.length + 40) {
      const idx = Math.min(step - logo.length, msgs.length - 1)
      const bar = bars[Math.floor((frame / 6) % bars.length)]
      const p = Math.min(Math.floor((step - logo.length) / 10) * 25, 100)
      process.stdout.write(`\r${C.dim}  ${bar} ${p}%${C.reset} ${C.c}${msgs[idx]}${C.reset}`)
      frame++
      step++
    } else {
      clearInterval(loadInterval)
      process.stdout.write('\r\x1b[K')
      afterLoad()
    }
  }, 80)

  function afterLoad() {
    const w = process.stdout.columns || 80
    const title = `${C.bold} MineCline ${VERSION} ${C.reset}`
    const titleBare = stripAnsi(title)
    const dash = Math.max(0, w - titleBare.length - 2)
    const left = Math.floor(dash / 2); const right = dash - left
    process.stdout.write(`┌${'─'.repeat(left)}${title}${'─'.repeat(right)}┐\n`)
    logInfo('', `${C.dim}ready — type ${C.c}help${C.dim} for commands${C.reset}`)

    if (appConfig.web.enabled) startWebServer(appConfig.web.port)
    setTimeout(checkAutoUpdate, 2000)

    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('keypress', onKeypress)
    redrawPrompt()
  }
}

function registerLifecycle() {
  process.on('SIGINT', () => { process.exit(0) })
  process.on('SIGTERM', () => { process.exit(0) })
  process.on('exit', () => {
    exitFlag = true
    if (discordBridge) discordBridge.stop()
    for (const n of Object.keys(bots)) {
      const cfg = bots[n]
      if (cfg && cfg.bot) { try { cfg.bot.end() } catch {} }
    }
    cleanup()
  })
}

init()
