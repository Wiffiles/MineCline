const mineflayer = require('mineflayer')
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const https = require('https')

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

const VERSION = '2.2.3'
const REPO_BASE = 'https://raw.githubusercontent.com/Wiffiles/MineCline/main'
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
  autoUpdate: true,
  autoRegister: '',
}

const DEFAULT_BOT_CONFIG = {
  host: 'localhost', port: 25565,
  autoAfk: false, autoJump: false, autoShift: false, autoEat: false, resourcePack: 'accept',
  onJoin: { commands: [], chat: [] },
}

const bots = {}
let activeBot = null, activeBots = new Set(), selMode = 'single'
let logLines = [], input = '', cursor = 0, history = [], histIdx = -1
let exitFlag = false, saveTimer = null
let appConfig = { ...DEFAULT_CONFIG }
let commandHistory = [], alertLog = [], playerCountHistory = {}, serverCounts = {}
let botGroups = {}, savedCommands = [], savedScripts = {}

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, '') }
function padAnsi(str, len) { const s = String(str); const b = stripAnsi(s); return s + ' '.repeat(Math.max(0, len - b.length)) }

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
      if (data._setup) appConfig._setup = true
      if (data.autoRegister) appConfig.autoRegister = data.autoRegister
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
  const data = { version: VERSION, autoUpdate: appConfig.autoUpdate, autoRegister: appConfig.autoRegister || '', _setup: appConfig._setup || true, bots: {}, groups: botGroups, savedCommands, savedScripts }
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

  const b = mineflayer.createBot({ host, port: parseInt(port, 10), username: name, version: '1.21.5', timeout: 30000, checkTimeoutInterval: 5000 })
  cfg.bot = b; cfg.connectedAt = Date.now(); cfg.uptime = 0
  logInfo(name, `Connecting to ${host}:${port}...`)

  b.on('login', () => {
    cfg.connected = true; cfg.error = null; cfg.onJoinExecuted = false
    cfg.dimension = b.game?.dimension || 'unknown'; cfg.kickedReason = null
    cfg.health = Math.round(b.health ?? 20); cfg.food = Math.round(b.food ?? 20)
    updateInv(cfg, b); logInfo(name, `Logged in as ${b.username}`)
    const pw = appConfig.autoRegister
    if (pw) {
      setTimeout(() => {
        if (!cfg.connected) return
        b.chat(`/register ${pw} ${pw}`); logChat(name, `Auto: /register ***`)
        setTimeout(() => {
          if (!cfg.connected) return
          b.chat(`/login ${pw}`); logChat(name, `Auto: /login ***`)
        }, 2000)
      }, 500)
    }
    if (cfg.onJoin && !cfg.onJoinExecuted) {
      cfg.onJoinExecuted = true
      if (cfg.onJoin.commands) for (const c of cfg.onJoin.commands) { try { b.chat(`/${c}`); logChat(name, `Auto-cmd: /${c}`) } catch {} }
      if (cfg.onJoin.chat) for (const msg of cfg.onJoin.chat) { try { b.chat(msg); logChat(name, `Auto-chat: ${msg}`) } catch {} }
    }
  })

  b.on('spawn', () => {
    cfg.joined = true; updateInv(cfg, b); logInfo(name, 'Spawned into world')
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
    let msg
    if (typeof reason === 'object' && reason !== null) {
      const flatten = (obj) => {
        if (!obj) return ''
        if (typeof obj === 'string') return obj
        if (Array.isArray(obj)) return obj.map(f => typeof f === 'string' ? f : flatten(f)).join('')
        if (obj.value && typeof obj.value === 'object') return flatten(obj.value)
        if (obj.value && typeof obj.value === 'string') return obj.value
        if (obj.text && typeof obj.text === 'string') return obj.text
        if (obj.text && typeof obj.text === 'object') return flatten(obj.text)
        if (obj.extra) return flatten(obj.extra)
        return JSON.stringify(obj)
      }
      msg = flatten(reason) || JSON.stringify(reason)
    } else {
      msg = String(reason)
    }
    cfg.kickedReason = msg.slice(0, 200).replace(/\n/g, ' | '); logErr(name, `Kicked: ${cfg.kickedReason}`)
    alertLog.push({ t: ts(), bot: name, type: 'warn', message: `Kicked: ${cfg.kickedReason}` })
    if (alertLog.length > 500) alertLog.splice(0, alertLog.length - 500)
  })

  b.on('message', (msg) => {
    if (msg.fromMob) return
    const from = msg.to?.username || 'SERVER'
    const text = msg.toString().replace(/\xA7[0-9a-fk-or]/gi, '').trim()
    logMsg(name, `<${from}> ${text}`)
  })

  b.on('whisper', (from, msg) => {
    logMsg(name, `[whisper] ${from}: ${msg}`)
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
  const total = Object.keys(bots).length
  const connected = Object.values(bots).filter(b => b.connected).length
  const counts = total > 0 ? `${C.dim}[${connected}/${total}]${C.reset} ` : ''
  let ctx
  if (selMode === 'multi' && activeBots.size > 0) {
    const names = [...activeBots]
    ctx = names.length <= 2 ? `${C.m}${names.join('+')}${C.reset}` : `${C.m}${names[0]}+${names.length - 1}${C.reset}`
  } else if (activeBot) {
    ctx = `${C.g}${activeBot}${C.reset}`
  } else {
    ctx = `${C.dim}global${C.reset}`
  }
  return `${counts}${ctx} > `
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
  if (activeBot && botName && botName !== activeBot) return
  process.stdout.write(`\r\x1b[K${line}\n`)
  redrawPrompt()
}

function logInfo(botName, msg) { addLog(botName, `${C.g}>>${C.reset} ${msg}`) }
function logWarn(botName, msg) { addLog(botName, `${C.y}!!${C.reset} ${msg}`) }
function logErr(botName, msg) { addLog(botName, `${C.r}xx${C.reset} ${msg}`) }
function logChat(botName, msg) { addLog(botName, `${C.gry}>>${C.reset} ${msg}`) }
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
  'chat', 'msg', 'inv',
  'config', 'onjoin', 'clear', 'help', 'quit', 'exit',
  'update', 'group', 'savecmd', 'script', 'players', 'save',
  'mcpwd',
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
  logRaw('', `${C.bold}${cfg.name}${C.reset} - ${cfg.host}:${cfg.port}  ${cfg.connected ? C.g + 'O' : C.r + 'o'}${C.reset}`)
  logRaw('', `  autoAfk: ${cfg.autoAfk}  autoJump: ${cfg.autoJump}  autoShift: ${cfg.autoShift}  autoEat: ${cfg.autoEat}  respack: ${cfg.resourcePack}`)
  logRaw('', `  onJoin: [${(cfg.onJoin?.commands || []).join(', ')}] [${(cfg.onJoin?.chat || []).join(', ')}]`)
}

function printHelp() {
  logRaw('', `${C.bold}-- ${C.c}MineCline v${VERSION}${C.reset} Commands --${C.reset}`)
  logRaw('', `  ${C.g}connect${C.reset} <name,names...> <host> [port] - Connect bot(s) (5s delay)`)
  logRaw('', `  ${C.g}disconnect${C.reset} [name | all]          - Disconnect bot(s)`)
  logRaw('', `  ${C.g}select${C.reset} <name>                  - Select single bot`)
  logRaw('', `  ${C.g}control${C.reset} <name1,name2|all>        - Multi-select bots`)
  logRaw('', `  ${C.g}global${C.reset}                         - Clear selection`)
  logRaw('', `  ${C.g}bots${C.reset}                           - List all bots`)
  logRaw('', `  ${C.y}Toggles:${C.reset} ${C.g}afk${C.reset}, ${C.g}jump${C.reset}, ${C.g}shift${C.reset}, ${C.g}eat${C.reset}, ${C.g}respack${C.reset}`)
  logRaw('', `  ${C.g}reconnect${C.reset} - Reconnect selected bot(s) (5s delay)`)
  logRaw('', `  ${C.g}chat/msg${C.reset} <text>                - Send chat`)
  logRaw('', `  ${C.g}/<cmd>${C.reset}                         - Server command`)
  logRaw('', `  ${C.g}inv${C.reset} [name]                     - Show inventory`)
  logRaw('', `  ${C.g}config${C.reset} [name] [set k v]        - View/change config`)
  logRaw('', `  ${C.g}onjoin${C.reset} <name> add cmd|chat     - Join actions`)
  logRaw('', `  ${C.g}clear${C.reset}, ${C.g}save${C.reset}, ${C.g}quit${C.reset} - Utility`)
  logRaw('', `  ${C.g}update${C.reset} - Check for updates`)
  logRaw('', `  ${C.g}group${C.reset} list|create|delete|rename|add|remove - Bot groups`)
  logRaw('', `  ${C.g}savecmd${C.reset} list|add|remove|run - Saved commands`)
  logRaw('', `  ${C.g}script${C.reset} list|create|delete|addstep|run - Script runner`)
  logRaw('', `  ${C.g}players${C.reset} [name] - List players seen by a bot`)
  logRaw('', `  ${C.g}save${C.reset} - Save config to disk`)
  logRaw('', `  ${C.g}mcpwd${C.reset} [password] - View/set auto-login password`)
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

  //  quit / exit ----
  if (cmd === 'quit' || cmd === 'exit') {
    exitFlag = true
    for (const n of Object.keys(bots)) disconnectBot(n)
    setTimeout(() => process.exit(0), 200)
    return
  }

  //  help / clear ----
  if (cmd === 'help') {
    if (args[0]) {
      const details = {
        connect:    'connect <name,names...> <host> [port]\n  Connect one or more bots (comma-separated names) to a server. 5s delay between each.',
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
        reconnect:  'reconnect\n  Reconnect selected bot(s) with 5s delay between each.',
        chat:       'chat/msg <text>\n  Send a chat message as the selected bot(s).',
        inv:        'inv [name]\n  Show a bot\'s inventory (held item, armor, hotbar).',

        config:     'config [name] [set <key> <val>]\n  View or change bot config (host, port, autoAfk, etc.).',
        onjoin:     'onjoin <name> add command|chat <text> | list | remove <idx>\n  Manage commands that run when a bot joins a server.',
        players:    'players [name]\n  List online players seen by the selected or named bot.',
        update:     'update\n  Check GitHub for a new version and update if available.',
        group:      'group list | create <name> | delete <name> | rename <old> <new> | add <group> <bot> | remove <group> <bot>\n  Manage bot groups.',
        savecmd:    'savecmd list | add <label> <cmd> | remove <idx> | run <idx>\n  Manage saved commands (quick-run from web/CLI).',
        script:     'script list | create <name> | delete <name> | addstep <name> <delay> <cmd> | run <name>\n  Run multi-step scripts with delays.',
        mcpwd:      'mcpwd [password]\n  View or set the auto-login password for /register and /login.',
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

  //  connect ----
  if (cmd === 'connect') {
    if (args.length < 2) { logErr('', 'Usage: connect <name,names...> <host> [port]'); return }
    const rawNames = args[0]
    const host = args[1]
    const port = args[2] || '25565'
    const names = rawNames.split(',').map(s => s.trim()).filter(Boolean)
    if (names.length === 0) { logErr('', 'No bot names'); return }
    logInfo('', `Connecting ${names.length} bot(s) with 5s delay...`)
    names.forEach((name, i) => setTimeout(() => {
      if (bots[name] && bots[name].connected) { logWarn(name, 'Already connected'); return }
      createBot(name, host, port)
    }, i * 5000))
    activeBot = names[0]; selMode = 'single'; activeBots.clear()
    return
  }

  //  disconnect ----
  if (cmd === 'disconnect') {
    if (args[0] === 'all') { for (const n of Object.keys(bots)) disconnectBot(n); return }
    const name = args[0] || activeBot
    if (!name) { logErr('', 'Usage: disconnect [name | all]'); return }
    disconnectBot(name)
    return
  }

  //  bots ----
  if (cmd === 'bots') {
    const names = Object.keys(bots)
    if (names.length === 0) { logInfo('', 'No bots configured'); return }
    for (const n of names) {
      const b = bots[n]
      const status = b.connected ? `${C.g}●${C.reset}` : `${C.r}○${C.reset}`
      const hp = b.connected ? `${padAnsi(b.health ?? '-', 2)}/${padAnsi(b.food ?? '-', 2)}` : `${C.dim} -/- ${C.reset}`
      const toggles = []
      if (b.afkEnabled) toggles.push(`${C.g}A${C.reset}`)
      if (b.autoJump) toggles.push(`${C.y}J${C.reset}`)
      if (b.autoEat) toggles.push(`${C.c}E${C.reset}`)
      if (b.autoShift) toggles.push(`${C.b}S${C.reset}`)
      if (b.resourcePack === 'accept') toggles.push(`${C.m}R${C.reset}`)
      const togStr = toggles.length ? toggles.join(' ') : `${C.dim}-${C.reset}`
      logRaw('', ` ${C.bold}${n}${C.reset}  ${status}  ${hp}  ${C.dim}${b.host}:${b.port}${C.reset}  ${togStr}`)
    }
    return
  }

  //  select ----
  if (cmd === 'select') {
    if (!args[0]) { logErr('', 'Usage: select <name>'); return }
    if (!bots[args[0]]) { logErr('', `No bot "${args[0]}"`); return }
    activeBot = args[0]; activeBots.clear(); selMode = 'single'
    logInfo('', `Selected ${C.bold}${activeBot}${C.reset}`)
    return
  }

  //  control ----
  if (cmd === 'control') {
    if (args.length === 0) {
      if (selMode === 'multi' && activeBots.size > 0) logInfo('', `Multi: ${C.m}${[...activeBots].join(', ')}${C.reset}`)
      else if (activeBot) logInfo('', `Selected: ${C.bold}${activeBot}${C.reset}`)
      else logInfo('', 'No selection')
      return
    }
    const rawNames = args.join(',')
    if (rawNames === 'all') {
      const all = Object.entries(bots).filter(([, b]) => b.connected).map(([n]) => n)
      if (all.length === 0) { logErr('', 'No bots connected'); return }
      activeBots = new Set(all); selMode = 'multi'; activeBot = null
      logInfo('', `Selected ${all.length} connected bot(s)`); return
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

  //  global ----
  if (cmd === 'global' || cmd === 'gloval') {
    const all = Object.keys(bots)
    if (all.length === 0) { logErr('', 'No bots'); return }
    activeBots = new Set(all); selMode = 'multi'; activeBot = null
    logInfo('', `Selected all ${all.length} bots`)
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

  //  reconnect ----
  if (cmd === 'reconnect') {
    const targets = getTargets(null)
    if (targets.length === 0) return
    const names = targets.map(t => t.name)
    logInfo('', `Reconnecting ${names.length} bot(s) with 5s delay...`)
    names.forEach((name, i) => setTimeout(() => createBot(name, bots[name].host, bots[name].port), i * 5000))
    return
  }

  if (cmd === 'respack') {
    if (!forTargets(args[0], (t) => {
      t.resourcePack = t.resourcePack === 'accept' ? 'deny' : 'accept'
      logInfo(t.name, `Resource pack: ${t.resourcePack === 'accept' ? C.g + 'auto-accept' + C.reset : C.y + 'deny' + C.reset}`)
    })) return
    scheduleSave(); return
  }

  //  chat / msg ----
  if (cmd === 'chat' || cmd === 'msg') {
    const text = args.join(' ')
    if (!text) { logErr('', 'Usage: chat <text>'); return }
    if (!forTargets(null, (t) => {
      if (!t.bot || !t.connected) { logErr(t.name, 'Not connected'); return }
      t.bot.chat(text); logChat(t.name, `> ${text}`)
    })) return
    return
  }

  //  players ----
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

  //  /command ----
  if (cmd.startsWith('/')) {
    if (!forTargets(null, (t) => {
      if (!t.bot || !t.connected) { logErr(t.name, 'Not connected'); return }
      t.bot.chat(trimmed); logInfo(t.name, `Cmd: ${trimmed.slice(0, 60)}`)
    })) return
    return
  }

  //  inv ----
  if (cmd === 'inv') {
    const targets = getTargets(args[0] || null)
    if (targets.length === 0) return
    for (const cfg of targets) {
      if (!cfg.bot || !cfg.connected) { logErr(cfg.name, 'Not connected'); continue }
      logRaw(cfg.name, `${C.bold}Inventory:${C.reset}`)
      if (cfg.heldItem) logRaw(cfg.name, `  ${C.gry}[*]${C.reset} Held: ${C.bold}${cfg.heldItem.name}${C.reset} x${cfg.heldItem.count} (slot ${cfg.heldItem.slot})`)
      if (cfg.armor.length > 0) {
        const armorStr = cfg.armor.map(a => `${C.c}${a.name}${C.reset}`).join(', ')
        logRaw(cfg.name, `  ${C.gry}[A]${C.reset} Armor: ${armorStr}`)
      }
      if (cfg.inventoryItems.length === 0) { logRaw(cfg.name, `  ${C.dim}(empty)${C.reset}`); continue }
      const hotbar = cfg.inventoryItems.filter(i => i.slot < 9)
      const rest = cfg.inventoryItems.filter(i => i.slot >= 9)
      logRaw(cfg.name, `  ${C.gry}[i]${C.reset} ${C.bold}Hotbar:${C.reset}`)
      for (const item of hotbar) {
        logRaw(cfg.name, `    [${item.slot}] ${item.name} x${item.count}`)
      }
      if (rest.length > 0) {
        logRaw(cfg.name, `  ${C.gry}[i]${C.reset} ${C.bold}Inventory:${C.reset}`)
        for (const item of rest) {
          logRaw(cfg.name, `    [${item.slot}] ${item.name} x${item.count}`)
        }
      }
      logRaw(cfg.name, `  Total: ${cfg.inventoryCount} items | ${cfg.armor.length} armor pieces`)
    }
    return
  }

  //  config ----
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

  //  onjoin ----
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

  //  update ----
  if (cmd === 'update') { checkAutoUpdate(); return }

  //  group ----
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

  //  savecmd ----
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

  //  script ----
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

  //  save ----
  if (cmd === 'save') { saveConfig(); logInfo('', 'Config saved'); return }

  //  mcpwd ----
  if (cmd === 'mcpwd') {
    if (args[0]) {
      appConfig.autoRegister = args.join(' ')
      scheduleSave()
      logInfo('', 'MC password updated.')
    } else if (appConfig.autoRegister) {
      logInfo('', `MC password is set (${'*'.repeat(appConfig.autoRegister.length)})`)
    } else {
      logWarn('', 'No MC password set. Use "mcpwd <password>" to set one.')
    }
    return
  }

  logErr('', `Unknown: "${cmd}". Type ${C.bold}help${C.reset}.`)
}

//  input handling

function onKeypress(str, key) {
  if (!key) return
  if (key.ctrl && key.name === 'c') { cleanup(); process.exit(0) }
  if (key.ctrl && key.name === 'l') { logInfo('', '-'.repeat(20)); return }

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
      const subCmds = {
        group:   ['list','create','delete','rename','add','remove'],
        config:  ['set'],
        onjoin:  ['add','list','remove'],
        script:  ['list','create','delete','addstep','run'],
        savecmd: ['list','add','remove','run'],
        mcpwd:   ['password'],
      }
      const subs = subCmds[parts[0]]
      if (subs && parts.length === 2) {
        const current = parts[1]
        const matches = subs.filter(s => s.startsWith(current))
        if (matches.length === 1) {
          parts[1] = matches[0]; input = parts.join(' ') + ' '; cursor = input.length; redrawPrompt()
        } else if (matches.length > 1) { logInfo('', C.gry + matches.join('  ') + C.reset) }
        return
      }
      const botCmds = ['select', 'control', 'disconnect', 'config', 'onjoin', 'afk', 'jump', 'eat', 'reconnect', 'respack', 'inv', 'players', 'group']
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

function promptUpdate(currentVer, remoteVer) {
  process.stdin.removeAllListeners('keypress')
  try { process.stdin.setRawMode(false) } catch {}
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = () => {
    rl.question(`\n${C.c}Hello. We detected you are using version ${C.bold}${currentVer}${C.reset}${C.c}.${C.reset}\n` +
      `${C.c}Would you like us to automatically update to the latest version ${C.bold}${remoteVer}${C.reset}${C.c}?${C.reset}\n` +
      `${C.g}[Y]es${C.reset}  ${C.y}[N]o${C.reset}  ${C.dim}[Never] ask again${C.reset}\n> `, (answer) => {
      const a = answer.trim().toLowerCase()
      rl.close()
      readline.emitKeypressEvents(process.stdin)
      if (process.stdin.isTTY) process.stdin.setRawMode(true)
      process.stdin.on('keypress', onKeypress)
      if (a === 'y' || a === 'yes') {
        doUpdate(remoteVer)
      } else if (a === 'never') {
        appConfig.autoUpdate = false; scheduleSave()
        logInfo('', 'Auto-update disabled.'); redrawPrompt()
      } else {
        logWarn('', 'Please answer Y, N, or Never.')
        ask()
      }
    })
  }
  ask()
}

function doUpdate(remoteVer) {
  let completed = 0; const total = 1; let hadError = false
  let dlDone = false

  const startTime = Date.now()
  const animFrames = ['|', '/', '-', '\\']
  let frame = 0
  let lastProgress = 0

  function drawProgress(pct, status) {
    const elapsed = Math.min(8000, Date.now() - startTime)
    const overallPct = Math.min(100, Math.round((pct * 0.5 + (elapsed / 8000) * 0.5) * 100))
    const w = 30
    const filled = Math.round(w * overallPct / 100)
    const bar = `${C.g}${'#'.repeat(filled)}${C.dim}${'.'.repeat(w - filled)}${C.reset}`
    const spinner = animFrames[frame % animFrames.length]
    const prefix = overallPct < 100 ? `${C.bold}${C.c}${spinner}${C.reset} ${C.bold}UPDATE${C.reset}` : `${C.g}${C.bold}OK${C.reset} ${C.bold}UPDATE${C.reset}`
    process.stdout.write(`\r${prefix} ${bar} ${C.bold}${overallPct}%${C.reset} ${C.dim}${status || ''}${C.reset}\x1b[K`)
    if (overallPct < 100) frame++
  }

  const animInterval = setInterval(() => {
    const pct = dlDone ? 1 : (completed / total)
    drawProgress(pct, dlDone ? 'Finishing...' : `Downloading (${completed}/${total})`)
    if (dlDone && Date.now() - startTime >= 8000) {
      clearInterval(animInterval)
      const color = hadError ? C.r : C.g
      const icon = hadError ? 'x' : '+'
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
  dl(`${REPO_BASE}/minecline.js?t=${Date.now()}`, __filename)
}

function checkForceUpdate() {
  return new Promise((resolve) => {
    const url = `${REPO_BASE}/UPDATENOW.txt?t=${Date.now()}`
    https.get(url, { headers: { 'User-Agent': 'MineCline/2.1' } }, (res) => {
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
  logInfo('', `${C.dim}Checking for updates...${C.reset}`)
  const cb = Date.now()
  const urls = [
    `${REPO_BASE}/minecline.js?t=${cb}`,
    `https://github.com/Wiffiles/MineCline/raw/main/minecline.js?t=${cb}`,
  ]
  tryFetch(0)

  function tryFetch(idx) {
    if (idx >= urls.length) { logWarn('', 'All update sources unreachable'); return }
    const url = urls[idx]
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; req.destroy(); tryFetch(idx + 1) }, 10000)
    const req = https.get(url, { headers: { 'User-Agent': 'MineCline/2.1' } }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', async () => {
        clearTimeout(timer)
        if (timedOut) return
        const match = data.match(/const VERSION = '([^']+)'/)
        if (!match) { logWarn('', 'Could not check version (bad response)'); return }
        const remoteVer = match[1]
        if (remoteVer === VERSION) {
          logInfo('', `${C.dim}Already up to date (v${VERSION})${C.reset}`)
          return
        }

        setTimeout(async () => {
          const forced = await checkForceUpdate()
          if (forced) {
            setTimeout(() => doUpdate(remoteVer), 500)
          } else if (appConfig.autoUpdate) {
            promptUpdate(VERSION, remoteVer)
          } else {
            logInfo('', `Update available: v${VERSION} -> ${C.c}v${remoteVer}${C.reset} (use "update" to install)`)
            redrawPrompt()
          }
        }, 500)
      })
    })
    req.on('error', (e) => { clearTimeout(timer); if (!timedOut) { logWarn('', `Update check failed (${idx + 1}/${urls.length}): ${e.message}`); tryFetch(idx + 1) } })
  }
}

//  lifecycle / init

function cleanup() {
  try { process.stdin.setRawMode(false) } catch {}
  process.stdin.pause()
  process.stdout.write('\x1b[?25h\x1b[0m\n')
}

function init() {
  try { fs.writeFileSync(LOG_PATH, '', 'utf8') } catch {} // clear log
  process.stdout.write('\x1b[?25l')
  loadConfig()
  registerLifecycle()
  showLogo()
}

function showLogo() {
  const logo = [
    `${C.g}  ██▄  ▄██ ▄▄ ▄▄  ▄▄ ▄▄▄▄▄ ▄█████ ▄▄    ▄▄ ▄▄  ▄▄ ▄▄▄▄▄ ${C.reset}`,
    `${C.c}  ██ ▀▀ ██ ██ ███▄██ ██▄▄  ██     ██    ██ ███▄██ ██▄▄  ${C.reset}`,
    `${C.b}  ██    ██ ██ ██ ▀██ ██▄▄▄ ▀█████ ██▄▄▄ ██ ██ ▀██ ██▄▄▄ ${C.reset}`,
  ]

  const bar1 = '█' + '▓'.repeat(10) + '▒'.repeat(4) + '░'
  const bar2 = '░' + '█' + '▓'.repeat(9) + '▒'.repeat(4)
  const bar3 = '░' + '▒' + '█' + '▓'.repeat(8) + '▒'.repeat(3)
  const bar4 = '░' + '▒'.repeat(3) + '▓'.repeat(8) + '█'
  const bars = [bar1, bar2, bar3, bar4]
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
    process.stdout.write(` ${'='.repeat(Math.max(0, left - 1))}${title}${'='.repeat(Math.max(0, right - 1))} \n`)
    logInfo('', `${C.dim}ready - type ${C.c}help${C.dim} for commands${C.reset}`)

    if (!appConfig.autoRegister) {
      process.stdin.removeAllListeners('keypress')
      try { process.stdin.setRawMode(false) } catch {}
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      rl.question(`${C.y}No MC password set. Enter password for auto /register & /login:${C.reset} `, (answer) => {
        const pw = answer.trim()
        if (pw) {
          appConfig.autoRegister = pw
          scheduleSave()
          logInfo('', 'Password saved to config.')
        }
        rl.close()
        setupStdin()
      })
      return
    }

    setupStdin()
  }

  function setupStdin() {
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('keypress', onKeypress)
    redrawPrompt()
    setTimeout(checkAutoUpdate, 1000)
  }
}

function registerLifecycle() {
  process.on('uncaughtException', (err) => {
    if (err.code === 'EPIPE') return
    logErr('', `Fatal: ${err.message}`)
    cleanup()
    process.exit(1)
  })
  process.on('SIGINT', () => { process.exit(0) })
  process.on('SIGTERM', () => { process.exit(0) })
  process.on('exit', () => {
    exitFlag = true
    for (const n of Object.keys(bots)) {
      const cfg = bots[n]
      if (cfg && cfg.bot) { try { cfg.bot.end() } catch {} }
    }
    cleanup()
  })
}

init()
