const ws = new WebSocket(`ws://${location.host}`)
let state = { bots: {}, groups: {}, serverCounts: {}, commandHistory: [], alertLog: [], playerHistory: {}, savedCommands: [] }
let playerChart = null
let selectedBotGraph = null
let selectedTargets = new Set()

ws.onmessage = (e) => {
  state = JSON.parse(e.data)
  render()
}
ws.onclose = () => {
  document.getElementById('navStatus').textContent = 'Disconnected'
  document.getElementById('navStatus').className = 'nav-status'
}
ws.onopen = () => {
  document.getElementById('navStatus').textContent = 'Connected'
  document.getElementById('navStatus').className = 'nav-status connected'
}

function render() {
  renderBots()
  renderBotList()
  renderServerList()
  renderStats()
  renderGroups()
  renderPresets()
  renderCommandHistory()
  renderAlertLog()
  renderSavedCommands()
}

// Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active')
  })
})

// Bot cards (Status page)
function renderBots() {
  const grid = document.getElementById('statusGrid')
  const bots = Object.values(state.bots).sort((a, b) => a.name.localeCompare(b.name))
  grid.innerHTML = bots.map(b => {
    const on = b.connected
    const uptime = b.connected && b.connectedAt ? fmtUptime((Date.now() - b.connectedAt) / 1000) : '-'
    return `<div class="bot-card" onclick="showBotModal('${b.name}')">
      <div class="name"><span class="status-dot ${on?'on':'off'}"></span>${b.name}<span class="card-tag ${on?'online':'offline'}">${on?'ONLINE':'OFFLINE'}</span></div>
      <div class="info">
        ${on ? `<div>Health <span>${b.health ?? '?'}</span> &middot; Food <span>${b.food ?? '?'}</span> &middot; Ping <span>${b.ping ?? '?'}ms</span></div>
        <div>${b.host}:${b.port} &middot; <span>${b.dimension || '?'}</span></div>
        <div>${b.x ?? '?'}, ${b.y ?? '?'}, ${b.z ?? '?'} &middot; Uptime <span>${uptime}</span></div>`
        : `<div>Offline &middot; ${b.host}:${b.port}</div>
        ${b.error ? `<div style="color:var(--red)">${b.error}</div>` : ''}`}
      </div>
    </div>`
  }).join('')
}

function showBotModal(name) {
  const b = state.bots[name]
  if (!b) return
  const uptime = b.connected && b.connectedAt ? fmtUptime((Date.now() - b.connectedAt) / 1000) : '-'
  const seen = b.players ? Object.keys(b.players).join(', ') : 'none'
  document.getElementById('botModalContent').innerHTML = `
    <button class="close-btn" onclick="document.getElementById('botModal').classList.remove('open')">&times;</button>
    <h2>${b.name}</h2>
    <div class="row"><span class="label">Server</span><span>${b.host}:${b.port}</span></div>
    <div class="row"><span class="label">Status</span><span style="color:${b.connected?'var(--green)':'var(--red)'}">${b.connected?'Online':'Offline'}</span></div>
    ${b.connected ? `
    <div class="row"><span class="label">Health</span><span>${b.health ?? '?'}</span></div>
    <div class="row"><span class="label">Food</span><span>${b.food ?? '?'}</span></div>
    <div class="row"><span class="label">Ping</span><span>${b.ping ?? '?'}ms</span></div>
    <div class="row"><span class="label">Coords</span><span>${b.x ?? '?'}, ${b.y ?? '?'}, ${b.z ?? '?'}</span></div>
    <div class="row"><span class="label">World</span><span>${b.dimension || '?'}</span></div>
    <div class="row"><span class="label">Uptime</span><span>${uptime}</span></div>
    <div class="row"><span class="label">Players seen</span><span>${seen}</span></div>` : `
    <div class="row"><span class="label">Last coords</span><span>${b.x ?? '?'}, ${b.y ?? '?'}, ${b.z ?? '?'}</span></div>
    <div class="row"><span class="label">Last world</span><span>${b.dimension || '?'}</span></div>
    ${b.error ? `<div class="row"><span class="label">Error</span><span style="color:var(--red)">${b.error}</span></div>` : ''}`}
  `
  document.getElementById('botModal').classList.add('open')
}
document.getElementById('botModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.target.classList.remove('open')
})

// Bot list (CRP sidebar)
function renderBotList() {
  const el = document.getElementById('botList')
  const activeFilter = document.querySelector('.filter-btn.active')?.dataset?.filter || 'all'
  let bots = Object.values(state.bots).sort((a, b) => a.name.localeCompare(b.name))
  if (activeFilter === 'active') bots = bots.filter(b => b.connected)
  if (activeFilter === 'dead') bots = bots.filter(b => !b.connected)

  el.innerHTML = bots.map(b => {
    const sel = selectedTargets.has(b.name) ? ' selected' : ''
    return `<div class="bot-entry${sel}" onclick="toggleTarget('${b.name}')">
      <span class="dot ${b.connected?'green':'red'}"></span>
      <span class="bname">${b.name}</span>
      <span class="bserver">${b.connected ? b.host : 'offline'}</span>
    </div>`
  }).join('')
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    renderBotList()
  })
})

function toggleTarget(name) {
  if (selectedTargets.has(name)) selectedTargets.delete(name)
  else selectedTargets.add(name)
  updateTargetSelect()
  renderBotList()
}

function updateTargetSelect() {
  const sel = document.getElementById('targetSelect')
  sel.innerHTML = ''
  Object.values(state.bots).forEach(b => {
    const opt = document.createElement('option')
    opt.value = b.name; opt.textContent = b.name
    if (selectedTargets.has(b.name)) opt.selected = true
    sel.appendChild(opt)
  })
}

document.getElementById('targetSelect').addEventListener('change', (e) => {
  selectedTargets = new Set([...e.target.options].filter(o => o.selected).map(o => o.value))
})

// Server list (CRP top bar)
function renderServerList() {
  const el = document.getElementById('serverList')
  const servers = Object.entries(state.serverCounts || {})
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
  el.innerHTML = servers.map(([srv, data]) =>
    `<span class="server-badge">${srv} <span class="count">${data.count}</span></span>`
  ).join('')
  document.getElementById('statTopServer').textContent = servers[0]?.[0] || '-'
}

// Stats (CRP top bar)
function renderStats() {
  const bots = Object.values(state.bots)
  document.getElementById('statTotal').textContent = bots.length
  document.getElementById('statActive').textContent = bots.filter(b => b.connected).length
}

// Groups (CRP sidebar)
function renderGroups() {
  const el = document.getElementById('groupsPanel')
  const groups = Object.entries(state.groups || {})
  el.innerHTML = groups.length
    ? groups.map(([name, members]) =>
        `<div class="group-entry" onclick="selectGroup('${name}')">
          <span class="gname">${name}</span>
          <span class="gcount">${members.length}</span>
        </div>`).join('')
    : '<div style="font-size:11px;color:var(--dim);padding:4px;">No groups</div>'
}

function selectGroup(name) {
  const members = state.groups[name] || []
  selectedTargets = new Set(members)
  updateTargetSelect()
  renderBotList()
}

// Presets (CRP sidebar)
function renderPresets() {
  const el = document.getElementById('presetsPanel')
  const presets = [
    { label: 'AFK All', action: 'afk' },
    { label: 'Jump All', action: 'jump' },
    { label: 'Shift All', action: 'shift' },
    { label: 'Eat All', action: 'eat' },
    { label: 'Reconnect Dead', action: 'reconnect' },
  ]
  el.innerHTML = presets.map(p =>
    `<button class="preset-btn" onclick="runPreset('${p.action}')">${p.label}</button>`
  ).join('')
}

function runPreset(action) {
  const bots = Object.values(state.bots).filter(b => b.connected)
  const names = bots.map(b => b.name).join(',')
  ws.send(JSON.stringify({ type: 'preset', action, targets: names }))
}

// Command History
function renderCommandHistory() {
  const el = document.getElementById('commandHistory')
  const ch = (state.commandHistory || []).slice(-50).reverse()
  el.innerHTML = ch.map(c =>
    `<div class="ch-entry">
      <span class="ch-time">${c.t}</span>
      <span class="ch-bot">${c.bots}</span>
      <span class="ch-cmd">${c.content}</span>
    </div>`
  ).join('')
}

// Alert Log
function renderAlertLog() {
  const el = document.getElementById('alertLog')
  const log = (state.alertLog || []).slice(-50).reverse()
  el.innerHTML = log.map(a =>
    `<div class="al-entry">
      <span class="al-time">${a.t}</span>
      <span class="al-${a.type} al-bot">${a.bot}</span>
      <span>${a.message}</span>
    </div>`
  ).join('')
}

// Saved Commands (CRP chat header)
function renderSavedCommands() {
  const el = document.getElementById('savedCommands')
  const cmds = state.savedCommands || []
  el.innerHTML = cmds.map(c =>
    `<button class="saved-cmd-btn" onclick="runSavedCmd('${c.command.replace(/'/g, "\\'")}')">${c.label}</button>`
  ).join('')
}

function runSavedCmd(cmd) {
  sendCommand(cmd)
}

// Chat / Command sending
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat()
})
document.getElementById('chatSend').addEventListener('click', sendChat)

function sendChat() {
  const input = document.getElementById('chatInput')
  const text = input.value.trim()
  if (!text) return
  sendCommand(text)
  input.value = ''
}

function sendCommand(text) {
  const targets = [...selectedTargets]
  if (targets.length === 0) return
  ws.send(JSON.stringify({ type: 'command', targets: targets.join(','), content: text }))
}

// Chart
function updateChart(botName) {
  selectedBotGraph = botName
  document.getElementById('selectedBotGraph').textContent = `(${botName})`
  const data = state.playerHistory?.[botName] || []
  const labels = data.map(d => {
    const t = new Date(d.t)
    return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
  })
  const counts = data.map(d => d.count)

  if (!playerChart) {
    const ctx = document.getElementById('playerChart').getContext('2d')
    playerChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{
        label: 'Players',
        data: counts,
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88, 166, 255, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      }]},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8b949e', font: { size: 10 } }, grid: { color: '#21262d' } },
          y: { ticks: { color: '#8b949e', font: { size: 10 }, stepSize: 1 }, grid: { color: '#21262d' }, beginAtZero: true }
        }
      }
    })
  } else {
    playerChart.data.labels = labels
    playerChart.data.datasets[0].data = counts
    playerChart.update()
  }
}

// Click on a bot in the chart area to select for graph
document.addEventListener('click', (e) => {
  const botEntry = e.target.closest('.bot-entry')
  if (botEntry && e.ctrlKey) {
    const name = botEntry.querySelector('.bname')?.textContent
    if (name && state.playerHistory?.[name]) updateChart(name)
  }
})

// Auto-select first bot with data for graph
setInterval(() => {
  if (!selectedBotGraph && state.playerHistory) {
    const first = Object.keys(state.playerHistory)[0]
    if (first) updateChart(first)
  }
  // Also refresh chart data
  if (selectedBotGraph && playerChart) {
    const data = state.playerHistory?.[selectedBotGraph] || []
    const labels = data.map(d => {
      const t = new Date(d.t)
      return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
    })
    const counts = data.map(d => d.count)
    playerChart.data.labels = labels
    playerChart.data.datasets[0].data = counts
    playerChart.update()
  }
}, 5000)

// Message log
let msgBuffer = []
ws.onmessage = (e) => {
  state = JSON.parse(e.data)
  render()
  // Messages come through the state now (from the logLines)
  renderMessages()
}

function renderMessages() {
  const el = document.getElementById('messageLog')
  const lines = (state.logLines || []).slice(-100)
  el.innerHTML = lines.map(l => {
    const cls = l.text.includes('[SERVER]') ? 'msg-server' :
               l.text.startsWith('>') ? 'msg-chat' : ''
    return `<div><span class="msg-time">${l.time}</span>${l.bot ? `<span class="msg-bot">[${l.bot}]</span>` : ''}<span class="${cls}">${l.text}</span></div>`
  }).join('')
  el.scrollTop = el.scrollHeight
}

// Helper
function fmtUptime(s) {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
