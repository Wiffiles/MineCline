const ws = new WebSocket(`ws://${location.host}`)
let state = { bots: {}, groups: {}, serverCounts: {}, commandHistory: [], alertLog: [], playerHistory: {}, savedCommands: [] }
let playerChart = null, selectedBot = null, selTargets = new Set(), prevState = ''

ws.onmessage = (e) => {
  state = JSON.parse(e.data)
  render()
  renderMessages()
  updateToasts()
}
ws.onclose = () => setStatus(false)
ws.onopen = () => setStatus(true)

function setStatus(ok) {
  const el = document.getElementById('navStatus')
  el.className = 'nav-status' + (ok ? ' connected' : '')
  el.querySelector('.nav-status-text').textContent = ok ? 'Connected' : 'Disconnected'
}

// Toast system
let toastId = 0
function toast(msg, type = 'info') {
  const c = document.getElementById('toasts')
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = msg
  el.id = `t-${++toastId}`
  c.appendChild(el)
  setTimeout(() => { const e = document.getElementById(el.id); if (e) { e.style.opacity = '0'; e.style.transition = '0.3s'; setTimeout(() => e.remove(), 300) } }, 4000)
}

function updateToasts() {
  // connectivity changes
  if (prevState && state.alertLog?.length > 0) {
    const prev = prevState.alertLog?.length || 0
    if (state.alertLog.length > prev) {
      const newAlerts = state.alertLog.slice(prev - state.alertLog.length)
      for (const a of newAlerts) {
        if (a.type === 'error') toast(`[${a.bot}] ${a.message}`, 'error')
        else if (a.type === 'warn') toast(`[${a.bot}] ${a.message}`, 'info')
      }
    }
  }
  prevState = JSON.parse(JSON.stringify(state))
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
  updateHeaderStats()
}

// Header stats
function updateHeaderStats() {
  const bots = Object.values(state.bots)
  document.getElementById('hdrTotal').textContent = bots.length
  const active = bots.filter(b => b.connected).length
  document.getElementById('hdrActive').textContent = active
  document.getElementById('hdrDead').textContent = bots.length - active
}

// Bot cards (Status page)
function renderBots() {
  const grid = document.getElementById('statusGrid')
  const bots = Object.values(state.bots).sort((a, b) => a.name.localeCompare(b.name))
  grid.innerHTML = bots.length
    ? bots.map(b => {
        const on = b.connected
        const u = on && b.connectedAt ? fmtU((Date.now() - b.connectedAt) / 1000) : '-'
        const hp = b.health ?? 0
        const food = b.food ?? 0
        return `<div class="bot-card" onclick="showBotModal('${b.name}')">
          <div class="bc-top">
            <span class="bc-dot ${on?'on':'off'}"></span>
            <span class="bc-name">${b.name}</span>
            <span class="bc-tag${on?'':' off'}">${on?'ACTIVE':'OFFLINE'}</span>
          </div>
          <div class="bc-body">
            ${on ? `<div>Health <span>${hp}</span> / 20 &middot; Food <span>${food}</span> / 20 &middot; Ping <span>${b.ping ?? '?'}ms</span></div>
            ${hp ? `<div class="bc-bar"><div class="bc-bar-track"><div class="bc-bar-fill hp" style="width:${Math.min(hp/20*100,100)}%"></div></div><div class="bc-bar-track"><div class="bc-bar-fill food" style="width:${Math.min(food/20*100,100)}%"></div></div></div>` : ''}
            <div>${b.host}:${b.port} &middot; <span>${b.dimension || '?'}</span></div>
            <div>${b.x ?? '?'}, ${b.y ?? '?'}, ${b.z ?? '?'} &middot; Uptime <span>${u}</span></div>`
            : `<div>Offline &middot; ${b.host}:${b.port}</div>
            ${b.error ? `<div style="color:var(--red);margin-top:4px;font-size:11px">${b.error}</div>` : ''}`}
          </div>
        </div>`
      }).join('')
    : '<div class="empty">No bots configured yet</div>'
}

function showBotModal(name) {
  const b = state.bots[name]
  if (!b) return
  const u = b.connected && b.connectedAt ? fmtU((Date.now() - b.connectedAt) / 1000) : '-'
  const seen = b.players ? Object.keys(b.players).join(', ') : 'none'
  document.getElementById('botModalContent').innerHTML = `
    <button class="modal-close" onclick="document.getElementById('botModal').classList.remove('open')">&times;</button>
    <h2>${b.name}</h2>
    <div class="row"><span class="lbl">Server</span><span>${b.host}:${b.port}</span></div>
    <div class="row"><span class="lbl">Status</span><span style="color:${b.connected?'var(--green)':'var(--red)'}">${b.connected?'Online':'Offline'}</span></div>
    ${b.connected ? `
    <div class="row"><span class="lbl">Health</span><span>${b.health ?? '?'} / 20</span></div>
    <div class="row"><span class="lbl">Food</span><span>${b.food ?? '?'} / 20</span></div>
    <div class="row"><span class="lbl">Ping</span><span>${b.ping ?? '?'}ms</span></div>
    <div class="row"><span class="lbl">Coordinates</span><span>${b.x ?? '?'}, ${b.y ?? '?'}, ${b.z ?? '?'}</span></div>
    <div class="row"><span class="lbl">World</span><span>${b.dimension || '?'}</span></div>
    <div class="row"><span class="lbl">Uptime</span><span>${u}</span></div>
    <div class="row"><span class="lbl">Players seen</span><span>${seen}</span></div>` : `
    <div class="row"><span class="lbl">Last coords</span><span>${b.x ?? '?'}, ${b.y ?? '?'}, ${b.z ?? '?'}</span></div>
    <div class="row"><span class="lbl">Last world</span><span>${b.dimension || '?'}</span></div>
    ${b.error ? `<div class="row"><span class="lbl">Error</span><span style="color:var(--red)">${b.error}</span></div>` : ''}`}
  `
  document.getElementById('botModal').classList.add('open')
}
document.getElementById('botModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.target.classList.remove('open')
})

// Bot list (CRP sidebar)
function renderBotList() {
  const el = document.getElementById('botList')
  const act = document.querySelector('.filter-btn.active')?.dataset?.filter || 'all'
  let bots = Object.values(state.bots).sort((a, b) => a.name.localeCompare(b.name))
  if (act === 'active') bots = bots.filter(b => b.connected)
  if (act === 'dead') bots = bots.filter(b => !b.connected)
  el.innerHTML = bots.length
    ? bots.map(b => {
        const sel = selTargets.has(b.name) ? ' sel' : ''
        return `<div class="bot-e${sel}" onclick="toggleTarget('${b.name}')">
          <span class="dot ${b.connected?'green':'red'}"></span>
          <span class="bname">${b.name}</span>
          <span class="bserver">${b.connected ? b.host : 'offline'}</span>
        </div>`
      }).join('')
    : '<div class="empty">No bots</div>'
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    renderBotList()
  })
})

function toggleTarget(name) {
  if (selTargets.has(name)) selTargets.delete(name)
  else selTargets.add(name)
  updateTargetSelect()
  renderBotList()
}

function updateTargetSelect() {
  const sel = document.getElementById('targetSelect')
  sel.innerHTML = ''
  Object.values(state.bots).forEach(b => {
    const opt = document.createElement('option')
    opt.value = b.name; opt.textContent = b.name
    if (selTargets.has(b.name)) opt.selected = true
    sel.appendChild(opt)
  })
}

document.getElementById('targetSelect').addEventListener('change', (e) => {
  selTargets = new Set([...e.target.options].filter(o => o.selected).map(o => o.value))
})

// Server list
function renderServerList() {
  const el = document.getElementById('serverList')
  const servers = Object.entries(state.serverCounts || {}).sort((a, b) => b[1].count - a[1].count).slice(0, 10)
  el.innerHTML = servers.length
    ? servers.map(([srv, data]) => `<span class="server-badge">${srv} <span class="count">${data.count}</span></span>`).join('')
    : '<span style="font-size:11px;color:var(--dim)">No servers yet</span>'
  document.getElementById('statTopServer').textContent = servers[0]?.[0] || '-'
  document.getElementById('statServerCount').textContent = servers.length
}

// Stats
function renderStats() {
  const bots = Object.values(state.bots)
  document.getElementById('statTotal').textContent = bots.length
  document.getElementById('statActive').textContent = bots.filter(b => b.connected).length
}

// Groups
function renderGroups() {
  const el = document.getElementById('groupsPanel')
  const groups = Object.entries(state.groups || {})
  el.innerHTML = groups.length
    ? groups.map(([name, members]) =>
        `<div class="group-e" onclick="selectGroup('${name}')"><span class="gn">${name}</span><span class="gc">${members.length}</span></div>`).join('')
    : '<div class="empty">No groups</div>'
}

function selectGroup(name) {
  selTargets = new Set(state.groups[name] || [])
  updateTargetSelect()
  renderBotList()
}

// Presets
function renderPresets() {
  const el = document.getElementById('presetsPanel')
  el.innerHTML = [
    { label: 'AFK All', action: 'afk' },
    { label: 'Jump All', action: 'jump' },
    { label: 'Shift All', action: 'shift' },
    { label: 'Eat All', action: 'eat' },
    { label: 'Reconnect', action: 'reconnect' },
  ].map(p => `<button class="preset-btn" onclick="runPreset('${p.action}')">${p.label}</button>`).join('')
}

function runPreset(action) {
  const names = Object.values(state.bots).filter(b => b.connected).map(b => b.name).join(',')
  ws.send(JSON.stringify({ type: 'preset', action, targets: names }))
}

// Command History
function renderCommandHistory() {
  const el = document.getElementById('commandHistory')
  const ch = (state.commandHistory || []).slice(-50).reverse()
  el.innerHTML = ch.length
    ? ch.map(c => `<div class="ch-e"><span class="ch-t">${c.t}</span><span class="ch-b">${c.bots}</span><span class="ch-c">${c.content}</span></div>`).join('')
    : '<div class="empty">No commands yet</div>'
}

// Alert Log
function renderAlertLog() {
  const el = document.getElementById('alertLog')
  const log = (state.alertLog || []).slice(-50).reverse()
  el.innerHTML = log.length
    ? log.map(a => `<div class="al-e"><span class="al-t">${a.t}</span><span class="al-${a.type} al-b">${a.bot}</span><span>${a.message}</span></div>`).join('')
    : '<div class="empty">No alerts</div>'
}

// Saved Commands
function renderSavedCommands() {
  const el = document.getElementById('savedCommands')
  const cmds = state.savedCommands || []
  el.innerHTML = cmds.length
    ? cmds.map(c => `<button class="saved-cmd-btn" onclick="runSavedCmd('${c.command.replace(/'/g, "\\'")}')">${c.label}</button>`).join('')
    : ''
}

function runSavedCmd(cmd) { sendCommand(cmd) }

// Chat
document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat() })
document.getElementById('chatSend').addEventListener('click', sendChat)

function sendChat() {
  const input = document.getElementById('chatInput')
  const text = input.value.trim()
  if (!text) return
  sendCommand(text)
  input.value = ''
}

function sendCommand(text) {
  const targets = [...selTargets]
  if (targets.length === 0) { toast('Select at least one bot target', 'info'); return }
  ws.send(JSON.stringify({ type: 'command', targets: targets.join(','), content: text }))
}

// Chart
function updateChart(botName) {
  selectedBot = botName
  document.getElementById('selectedBotGraph').textContent = `(${botName})`
  const data = state.playerHistory?.[botName] || []
  const labels = data.map(d => { const t = new Date(d.t); return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}` })
  const counts = data.map(d => d.count)

  if (!playerChart) {
    const ctx = document.getElementById('playerChart').getContext('2d')
    playerChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels, datasets: [{
          label: 'Players', data: counts,
          borderColor: '#4f8cff', borderWidth: 2,
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 140)
            g.addColorStop(0, 'rgba(79, 140, 255, 0.2)')
            g.addColorStop(1, 'rgba(79, 140, 255, 0)')
            return g
          },
          fill: true, tension: 0.35, pointRadius: 2, pointHoverRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8492a6', font: { size: 9, family: 'Inter' }, maxTicksLimit: 8 }, grid: { color: 'rgba(51,65,85,0.2)' } },
          y: { ticks: { color: '#8492a6', font: { size: 9, family: 'Inter' }, stepSize: 1 }, grid: { color: 'rgba(51,65,85,0.2)' }, beginAtZero: true }
        },
        interaction: { intersect: false, mode: 'index' }
      }
    })
  } else {
    playerChart.data.labels = labels
    playerChart.data.datasets[0].data = counts
    playerChart.update('none')
  }
}

// Select bot for chart with Ctrl+click
document.addEventListener('click', (e) => {
  const be = e.target.closest('.bot-e')
  if (be && e.ctrlKey) {
    const name = be.querySelector('.bname')?.textContent
    if (name && state.playerHistory?.[name]) updateChart(name)
  }
})

// Auto-select first bot with data
setInterval(() => {
  if (!selectedBot && state.playerHistory) {
    const first = Object.keys(state.playerHistory)[0]
    if (first) updateChart(first)
  }
  if (selectedBot && playerChart) {
    const data = state.playerHistory?.[selectedBot] || []
    const labels = data.map(d => { const t = new Date(d.t); return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}` })
    const counts = data.map(d => d.count)
    playerChart.data.labels = labels
    playerChart.data.datasets[0].data = counts
    playerChart.update('none')
  }
}, 5000)

// Message log
function renderMessages() {
  const el = document.getElementById('messageLog')
  const lines = (state.logLines || []).slice(-100)
  el.innerHTML = lines.length
    ? lines.map(l => {
        const cls = l.text.includes('[SERVER]') ? 'ms' : l.text.startsWith('>') ? 'mc' : ''
        return `<div><span class="mt">${l.time}</span>${l.bot ? `<span class="mb">[${l.bot}]</span>` : ''}<span class="${cls}">${l.text}</span></div>`
      }).join('')
    : '<div class="empty">Waiting for log data...</div>'
  el.scrollTop = el.scrollHeight
}

// Helper
function fmtU(s) {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
