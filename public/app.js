const toastContainer = document.getElementById('toasts')
function toast(msg, type = 'info') {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  toastContainer.appendChild(el)
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300) }, 3500)
}

let ws, state = { bots: {}, groups: {}, commandHistory: [], alertLog: [], savedCommands: [], savedScripts: {}, playerHistory: {}, logLines: [], serverCounts: {} }
let selectedBots = new Set()
let chart = null
graphBots = []

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}`
  ws = new WebSocket(url)
  ws.onopen = () => {
    document.getElementById('navStatus').className = 'nav-status connected'
    document.querySelector('.nav-status-text').textContent = 'Connected'
    document.querySelector('.nav-status-dot').style.background = '#22c55e'
  }
  ws.onclose = () => {
    document.getElementById('navStatus').className = 'nav-status'
    document.querySelector('.nav-status-text').textContent = 'Disconnected'
    document.querySelector('.nav-status-dot').style.background = '#ef4444'
    setTimeout(connect, 3000)
  }
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type === 'state') { state = data; render() }
    } catch {}
  }
}

function sendWS(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)) }

/* ═══ RENDER ═══ */
let prevState = ''
function render() {
  const s = JSON.stringify({ bots: Object.keys(state.bots).length, groups: Object.keys(state.groups).length, alertLog: state.alertLog.length, commandHistory: state.commandHistory.length, savedCommands: state.savedCommands.length })
  if (s === prevState && document.querySelector('#statusGrid').children.length > 0) { renderDynamic(); return }
  prevState = s
  renderStatus()
  renderCRP()
  renderDynamic()
}

/* ═══ NAV ═══ */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active')
  })
})

/* ═══ STATUS PAGE ═══ */
function renderStatus() {
  const grid = document.getElementById('statusGrid')
  const bots = state.bots || {}
  let total = 0, active = 0
  grid.innerHTML = ''
  for (const [name, bot] of Object.entries(bots)) {
    total++
    const online = bot.connected && bot.joined
    if (online) active++
    const uptime = bot.connected ? fmtUptime(bot.uptime || 0) : '-'
    const card = document.createElement('div')
    card.className = `bot-card${online ? '' : ' dead'}`
    card.innerHTML = `
      <div class="bc-h">
        <div class="bc-name">${esc(name)}</div>
        <div class="bc-badge ${online ? 'online' : 'offline'}">${online ? 'ONLINE' : 'OFFLINE'}</div>
      </div>
      <div class="bc-info">
        <span>${bot.host || '?'}:${bot.port || '?'}</span>
        <span>${uptime}</span>
      </div>
      <div class="bc-stats">
        <div class="bc-stat">
          <div class="bar-h"><span>HP</span><span>${bot.health !== undefined ? (bot.health / 2).toFixed(1) : '-'}❤</span></div>
          <div class="bar"><div class="bar-f hp" style="width:${bot.health !== undefined ? (bot.health / 40 * 100) : 0}%"></div></div>
        </div>
        <div class="bc-stat">
          <div class="bar-h"><span>Food</span><span>${bot.food !== undefined ? bot.food : '-'}</span></div>
          <div class="bar"><div class="bar-f food" style="width:${bot.food !== undefined ? (bot.food / 20 * 100) : 0}%"></div></div>
        </div>
        <div class="bc-stat"><span class="st-label">Ping</span><span class="st-val">${bot.ping !== undefined ? bot.ping + 'ms' : '-'}</span></div>
        <div class="bc-stat"><span class="st-label">Players</span><span class="st-val">${bot.playerCount !== undefined ? bot.playerCount : '-'}</span></div>
      </div>
      <div class="bc-detail">
        ${online ? `<div><span class="bc-dl">Position:</span> ${bot.position ? bot.position.map(v => v.toFixed(1)).join(', ') : '?'}</div>` : ''}
        ${online ? `<div><span class="bc-dl">World:</span> ${bot.gameMode || '?'} / ${bot.dimension || '?'}</div>` : ''}
        <div><span class="bc-dl">Version:</span> ${bot.version || '?'}</div>
      </div>
    `
    card.addEventListener('click', () => showBotModal(name, bot))
    grid.appendChild(card)
  }
  document.getElementById('hdrTotal').textContent = total
  document.getElementById('hdrActive').textContent = active
  document.getElementById('hdrDead').textContent = total - active
}

function showBotModal(name, bot) {
  const overlay = document.getElementById('botModal')
  const content = document.getElementById('botModalContent')
  const online = bot.connected && bot.joined
  const uptime = bot.connected ? fmtUptime(bot.uptime || 0) : '-'
  const inventory = bot.inventory ? bot.inventory.map(i => `${i.displayName || i.name} x${i.count}`).join(', ') : 'No inventory data'
  content.innerHTML = `
    <div class="modal-h">
      <div class="modal-title">${esc(name)}</div>
      <button class="modal-close" id="modalClose">&times;</button>
    </div>
    <div class="modal-b">
      <div class="modal-grid">
        <div><span class="bc-dl">Status:</span> <span class="bc-badge ${online ? 'online' : 'offline'}">${online ? 'ONLINE' : 'OFFLINE'}</span></div>
        <div><span class="bc-dl">Host:</span> ${bot.host || '?'}:${bot.port || '?'}</div>
        <div><span class="bc-dl">Uptime:</span> ${uptime}</div>
        <div><span class="bc-dl">Version:</span> ${bot.version || '?'}</div>
        <div><span class="bc-dl">Ping:</span> ${bot.ping !== undefined ? bot.ping + 'ms' : '-'}</div>
        <div><span class="bc-dl">Health:</span> ${bot.health !== undefined ? (bot.health / 2).toFixed(1) + '❤' : '-'}</div>
        <div><span class="bc-dl">Food:</span> ${bot.food !== undefined ? bot.food + ' 🍖' : '-'}</div>
        <div><span class="bc-dl">Players:</span> ${bot.playerCount !== undefined ? bot.playerCount : '-'}</div>
        <div><span class="bc-dl">Position:</span> ${bot.position ? bot.position.map(v => v.toFixed(1)).join(', ') : '?'}</div>
        <div><span class="bc-dl">World:</span> ${bot.gameMode || '?'} / ${bot.dimension || '?'}</div>
      </div>
      <div class="modal-inv"><span class="bc-dl">Inventory:</span><br>${inventory}</div>
    </div>
  `
  overlay.classList.add('active')
  document.getElementById('modalClose').addEventListener('click', () => overlay.classList.remove('active'))
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active') })
}

/* ═══ CRP SIDEBAR ═══ */
function renderCRP() {
  const bots = state.bots || {}
  // stats
  const vals = Object.values(bots)
  const active = vals.filter(b => b.connected && b.joined)
  document.getElementById('statTotal').textContent = vals.length
  document.getElementById('statActive').textContent = active.length
  const sc = state.serverCounts || {}
  const topServer = Object.entries(sc).sort((a, b) => b[1] - a[1])
  document.getElementById('statTopServer').textContent = topServer.length ? topServer[0][0] : '-'
  document.getElementById('statServerCount').textContent = Object.keys(sc).length

  // servers
  const sl = document.getElementById('serverList')
  sl.innerHTML = topServer.slice(0, 10).map(([srv, count]) => `<div class="srv-item"><span>${esc(srv)}</span><span class="srv-c">${count}</span></div>`).join('')

  // bot list
  renderBotList()
  // groups
  renderGroups()
  // presets
  renderPresets()
}

function renderBotList() {
  const list = document.getElementById('botList')
  const filter = document.querySelector('.filter-btn.active')?.dataset?.filter || 'all'
  const search = (document.getElementById('botSearch').value || '').toLowerCase()
  const bots = state.bots || {}
  let html = ''
  for (const [name, bot] of Object.entries(bots)) {
    const online = bot.connected && bot.joined
    if (filter === 'active' && !online) continue
    if (filter === 'dead' && online) continue
    if (search && !name.toLowerCase().includes(search)) continue
    const sel = selectedBots.has(name) ? ' selected' : ''
    html += `<div class="bl-item${sel}" data-name="${esc(name)}">
      <div class="bl-dot ${online ? 'on' : 'off'}"></div>
      <span>${esc(name)}</span>
      <span class="bl-srv">${bot.host || '?'}</span>
    </div>`
  }
  list.innerHTML = html
  list.querySelectorAll('.bl-item').forEach(el => {
    el.addEventListener('click', (e) => {
      const name = el.dataset.name
      if (e.ctrlKey || e.metaKey) {
        if (selectedBots.has(name)) selectedBots.delete(name); else selectedBots.add(name)
      } else { selectedBots.clear(); selectedBots.add(name) }
      renderBotList()
      updateTargetSelect()
    })
  })
}

function updateTargetSelect() {
  const sel = document.getElementById('targetSelect')
  const bots = state.bots || {}
  const allNames = Object.keys(bots)
  sel.innerHTML = allNames.map(n => {
    const s = selectedBots.has(n) ? 'selected' : ''
    const online = bots[n].connected && bots[n].joined
    return `<option value="${esc(n)}" ${s} class="${online ? 'opt-on' : 'opt-off'}">${esc(n)}${online ? '' : ' (off)'}</option>`
  }).join('')
  sel.querySelectorAll('option').forEach(opt => {
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const name = opt.value
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        if (selectedBots.has(name)) selectedBots.delete(name); else selectedBots.add(name)
      } else { selectedBots.clear(); selectedBots.add(name) }
      updateTargetSelect()
      renderBotList()
    })
  })
}

document.getElementById('botSearch').addEventListener('input', () => renderBotList())
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    renderBotList()
  })
})

function renderGroups() {
  const panel = document.getElementById('groupsPanel')
  const groups = state.groups || {}
  const bots = state.bots || {}
  panel.innerHTML = ''
  let has = false
  for (const [name, members] of Object.entries(groups)) {
    has = true
    const div = document.createElement('div')
    div.className = 'group-item'
    let mHtml = ''
    for (const m of members) {
      const b = bots[m]
      const on = b && b.connected && b.joined
      mHtml += `<span class="group-member ${on ? 'on' : 'off'}" data-bot="${esc(m)}">${esc(m)}</span>`
    }
    div.innerHTML = `<div class="group-h"><span class="group-name"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> ${esc(name)}</span>
      <div class="group-acts">
        <button class="btn-p sm" data-gact="cmd" data-gname="${esc(name)}">Cmd</button>
        <button class="btn-p sm" data-gact="run" data-gname="${esc(name)}">Run</button>
        <button class="btn-p sm" data-gact="rename" data-gname="${esc(name)}">Rename</button>
        <button class="btn-p sm" data-gact="delete" data-gname="${esc(name)}">Del</button>
      </div></div>
      <div class="group-members">${mHtml}</div>
      <div class="group-add"><select class="gadd-select" data-gname="${esc(name)}"><option value="">+ Add bot...</option>${Object.keys(bots).filter(b => !members.includes(b)).map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select></div>`
    panel.appendChild(div)
  }
  if (!has) panel.innerHTML = '<div class="empty-state">No groups created yet</div>'
  panel.querySelectorAll('.btn-p[data-gact]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const gname = btn.dataset.gname
      const act = btn.dataset.gact
      if (act === 'delete') { if (confirm(`Delete group "${gname}"?`)) sendWS({ type: 'group', action: 'delete', name: gname }) }
      if (act === 'rename') {
        const n = prompt('New name:', gname)
        if (n && n !== gname) sendWS({ type: 'group', action: 'rename', name: gname, newName: n })
      }
      if (act === 'cmd') {
        const c = prompt('Command to send to all members:')
        if (c) {
          const grp = state.groups[gname]
          if (grp) sendWS({ type: 'command', targets: grp.join(','), content: c })
        }
      }
      if (act === 'run') {
        const sname = prompt('Script name to run on group:')
        if (sname) sendWS({ type: 'script', action: 'run', name: sname })
      }
    })
  })
  panel.querySelectorAll('.gadd-select').forEach(sel => {
    sel.addEventListener('change', () => {
      if (sel.value) { sendWS({ type: 'group', action: 'add', name: sel.dataset.gname, bot: sel.value }); sel.value = '' }
    })
  })
  panel.querySelectorAll('.group-member').forEach(el => {
    el.addEventListener('click', () => {
      selectedBots.clear(); selectedBots.add(el.dataset.bot)
      updateTargetSelect(); renderBotList()
    })
  })
}

document.getElementById('gfBtn').addEventListener('click', () => {
  const name = document.getElementById('gfName').value.trim()
  if (name) { sendWS({ type: 'group', action: 'create', name }); document.getElementById('gfName').value = '' }
})
document.getElementById('gfName').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('gfBtn').click() })

function renderPresets() {
  const panel = document.getElementById('presetsPanel')
  const bots = state.bots || {}
  const hasBots = Object.keys(bots).length > 0
  panel.innerHTML = hasBots ? [
    { label: 'AFK', action: 'afk', icon: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>` },
    { label: 'Jump', action: 'jump', icon: `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>` },
    { label: 'Eat', action: 'eat', icon: `<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>` },
    { label: 'Shift', action: 'shift', icon: `<polyline points="6 9 12 15 18 9"/>` },
    { label: 'Respawn', action: 'respawn', icon: `<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>` },
  ].map(p => `<button class="preset-btn" data-action="${p.action}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg>${p.label}</button>`).join('') : '<div class="empty-state">Connect a bot first</div>'
  panel.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (selectedBots.size === 0) { toast('Select at least one bot first', 'warn'); return }
      sendWS({ type: 'preset', targets: [...selectedBots].join(','), action: btn.dataset.action })
    })
  })
}

/* ═══ CHAT BAR ═══ */
let chatHistory = []
let chatHistoryIdx = -1
document.getElementById('chatSend').addEventListener('click', sendChat)
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { sendChat(); return }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (chatHistory.length === 0) return
    chatHistoryIdx = Math.max(0, (chatHistoryIdx === -1 ? chatHistory.length - 1 : chatHistoryIdx - 1))
    document.getElementById('chatInput').value = chatHistory[chatHistoryIdx]
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (chatHistoryIdx === -1) return
    chatHistoryIdx++
    if (chatHistoryIdx >= chatHistory.length) { chatHistoryIdx = -1; document.getElementById('chatInput').value = ''; return }
    document.getElementById('chatInput').value = chatHistory[chatHistoryIdx]
  }
})

function sendChat() {
  const input = document.getElementById('chatInput')
  const text = input.value.trim()
  if (!text) return
  if (selectedBots.size === 0) { toast('Select at least one bot', 'warn'); return }
  sendWS({ type: 'command', targets: [...selectedBots].join(','), content: text })
  chatHistory.push(text)
  if (chatHistory.length > 50) chatHistory.shift()
  chatHistoryIdx = -1
  input.value = ''
}

/* ═══ CONNECT FORM ═══ */
const cfName = document.getElementById('cfName')
const cfHost = document.getElementById('cfHost')
const cfPort = document.getElementById('cfPort')
document.getElementById('cfBtn').addEventListener('click', () => {
  const name = cfName.value.trim(); const host = cfHost.value.trim(); const port = cfPort.value.trim() || '25565'
  if (!name || !host) { toast('Name and host required', 'warn'); return }
  if (state.bots[name]) { toast('Bot already exists', 'warn'); return }
  sendWS({ type: 'connect', name, host, port })
  cfName.value = ''; cfHost.value = ''; cfPort.value = '25565'
})

/* ═══ MESSAGE LOG ═══ */
document.getElementById('msgSearch').addEventListener('input', renderDynamic)

/* ═══ SAVED COMMANDS TAB ═══ */
document.getElementById('scAddBtn').addEventListener('click', () => {
  const label = document.getElementById('scLabel').value.trim()
  const cmd = document.getElementById('scCmd').value.trim()
  if (!label || !cmd) { toast('Label and command required', 'warn'); return }
  sendWS({ type: 'savecmd', action: 'add', label, command: label.startsWith('/') ? label : cmd })
  document.getElementById('scLabel').value = ''; document.getElementById('scCmd').value = ''
})

function renderSavedCmds() {
  const el = document.getElementById('savedCmdsList')
  const cmds = state.savedCommands || []
  el.innerHTML = cmds.map((c, i) => `<div class="sc-item">
    <span class="sc-label">${esc(c.label)}</span>
    <span class="sc-cmd">${esc(c.command)}</span>
    <div class="sc-acts">
      <button class="btn-p sm" data-sca="run" data-idx="${i}">Run</button>
      <button class="btn-p sm" data-sca="del" data-idx="${i}">Del</button>
    </div>
  </div>`).join('')
  el.querySelectorAll('[data-sca]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.dataset.idx)
      if (btn.dataset.sca === 'run') sendWS({ type: 'savecmd', action: 'run', idx })
      if (btn.dataset.sca === 'del') sendWS({ type: 'savecmd', action: 'remove', idx })
    })
  })
}

/* ═══ SCRIPTS TAB ═══ */
document.getElementById('scrAddBtn').addEventListener('click', () => {
  const name = document.getElementById('scrName').value.trim()
  if (!name) { toast('Script name required', 'warn'); return }
  if (state.savedScripts && state.savedScripts[name]) { toast('Script already exists', 'warn'); return }
  sendWS({ type: 'script', action: 'create', name })
  document.getElementById('scrName').value = ''
})

function renderScripts() {
  const el = document.getElementById('scriptsList')
  const scripts = state.savedScripts || {}
  const keys = Object.keys(scripts)
  if (!keys.length) { el.innerHTML = '<div class="empty-state">No scripts yet</div>'; return }
  el.innerHTML = keys.map(name => {
    const steps = scripts[name] || []
    return `<div class="sc-item" style="flex-wrap:wrap;align-items:flex-start">
      <div class="sc-label" style="width:100%;margin-bottom:4px">📜 ${esc(name)}</div>
      <div style="width:100%;font-size:11px;color:var(--dim);margin-bottom:4px">${steps.length} steps</div>
      <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px;width:100%">
        ${steps.map((s, i) => `<span class="group-member step" data-scr="${esc(name)}" data-idx="${i}">${i + 1}. ${esc(s.content.slice(0, 20))} (${s.delay}ms)</span>`).join('')}
      </div>
      <div style="display:flex;gap:4px">
        <input type="text" class="cf-input" placeholder="Step content" style="width:140px" data-scr-addc="${esc(name)}">
        <input type="text" class="cf-input" placeholder="delay ms" value="1000" style="width:70px" data-scr-addd="${esc(name)}">
        <button class="btn-p sm" data-scr-add="${esc(name)}">Add</button>
        <button class="btn-p sm" data-scr-del="${esc(name)}">Delete</button>
        <button class="btn-p sm" data-scr-run="${esc(name)}">Run</button>
      </div>
    </div>`
  }).join('')
  el.querySelectorAll('[data-scr-del]').forEach(btn => { btn.addEventListener('click', () => { if (confirm('Delete script?')) sendWS({ type: 'script', action: 'delete', name: btn.dataset.scrDel }) }) })
  el.querySelectorAll('[data-scr-run]').forEach(btn => { btn.addEventListener('click', () => sendWS({ type: 'script', action: 'run', name: btn.dataset.scrRun })) })
  el.querySelectorAll('[data-scr-add]').forEach(btn => { btn.addEventListener('click', () => {
    const name = btn.dataset.scrAdd
    const content = el.querySelector(`[data-scr-addc="${CSS.escape(name)}"]`)?.value?.trim()
    const delay = parseInt(el.querySelector(`[data-scr-addd="${CSS.escape(name)}"]`)?.value) || 1000
    if (!content) { toast('Step content required', 'warn'); return }
    sendWS({ type: 'script', action: 'addstep', name, step: { delay, content } })
  }) })
  el.querySelectorAll('.step').forEach(el2 => { el2.addEventListener('click', () => {
    if (confirm('Remove this step?')) sendWS({ type: 'script', action: 'removestep', name: el2.dataset.scr, step: parseInt(el2.dataset.idx) })
  }) })
}

/* ═══ CONFIG TAB ═══ */
document.getElementById('exportBtn').addEventListener('click', () => {
  sendWS({ type: 'exportConfig' })
})
document.getElementById('importBtn').addEventListener('click', () => {
  try {
    const data = JSON.parse(document.getElementById('importArea').value)
    sendWS({ type: 'importConfig', data })
    document.getElementById('importArea').value = ''
  } catch { toast('Invalid JSON', 'warn') }
})

/* ═══ SAVED COMMANDS INLINE ═══ */
function renderSavedCmdsInline() {
  const el = document.getElementById('savedCommands')
  const cmds = state.savedCommands || []
  el.innerHTML = cmds.map((c, i) => `<span class="sc-chip" data-idx="${i}">${esc(c.label)}</span>`).join('')
  el.querySelectorAll('.sc-chip').forEach(chip => {
    chip.addEventListener('click', () => sendWS({ type: 'savecmd', action: 'run', idx: parseInt(chip.dataset.idx) }))
  })
}

/* ═══ TAB SWITCHING ═══ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active')
  })
})

/* ═══ DYNAMIC RENDER (no full re-render) ═══ */
function renderDynamic() {
  // Message log
  renderMsgLog()
  // Command history
  const chEl = document.getElementById('commandHistory')
  const ch = state.commandHistory || []
  chEl.innerHTML = ch.slice().reverse().map(e => {
    const cls = e.type === 'cmd' ? 'ch-cmd' : 'ch-chat'
    return `<div class="ch-item ${cls}"><span class="ch-time">${fmtTime(e.t)}</span> <span class="ch-bots">[${esc(e.bots || '?')}]</span> ${esc(e.content)}</div>`
  }).join('')
  chEl.scrollTop = 0

  // Alert log
  const alEl = document.getElementById('alertLog')
  const al = state.alertLog || []
  alEl.innerHTML = al.slice().reverse().map(a => `<div class="al-item ${a.type || 'info'}">${fmtTime(a.t)} ${esc(a.text)}</div>`).join('')
  alEl.scrollTop = 0

  // Saved commands
  renderSavedCmds()
  renderSavedCmdsInline()
  renderScripts()
}

/* ═══ MESSAGE LOG ═══ */
function renderMsgLog() {
  const el = document.getElementById('messageLog')
  const search = (document.getElementById('msgSearch').value || '').toLowerCase()
  const lines = state.logLines || []
  let html = ''
  for (let i = Math.max(0, lines.length - 200); i < lines.length; i++) {
    const l = lines[i]
    if (!l) continue
    const text = l.text || ''
    if (search && !text.toLowerCase().includes(search)) continue
    let cls = 'log-info'
    if (l.type === 'err' || l.type === 'error') cls = 'log-err'
    else if (l.type === 'warn') cls = 'log-warn'
    else if (l.type === 'chat') cls = 'log-chat'
    else if (l.type === 'cmd') cls = 'log-cmd'
    html += `<div class="log-line ${cls}"><span class="log-time">${fmtTime(l.t)}</span> <span class="log-bot">${esc(l.name || '')}</span> ${esc(text)}</div>`
  }
  el.innerHTML = html
  el.scrollTop = el.scrollHeight
}

/* ═══ CHART ═══ */
function renderChart(botNames) {
  const allNames = botNames || graphBots
  graphBots = allNames
  const ctx = document.getElementById('playerChart').getContext('2d')
  const ph = state.playerHistory || {}
  if (chart) { chart.destroy(); chart = null }

  const datasets = []
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316', '#ec4899']
  let maxLen = 0
  allNames.slice(0, 8).forEach((name, i) => {
    const data = (ph[name] || []).slice(-60)
    maxLen = Math.max(maxLen, data.length)
    datasets.push({
      label: name, data: data, borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '22',
      fill: true, tension: 0.3, pointRadius: 1, borderWidth: 2,
    })
  })
  const labels = Array.from({ length: maxLen }, (_, i) => i)

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 10, family: 'Inter' }, boxWidth: 10, padding: 8 } }
      },
      scales: {
        x: { grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { size: 9 } } },
        y: { beginAtZero: true, grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { size: 9 }, stepSize: 1 } }
      }
    }
  })
}

document.getElementById('selectedBotGraph').textContent = 'Ctrl+click bots to graph'

/* ═══ EXPORT HANDLER ═══ */
document.addEventListener('DOMContentLoaded', () => {
  // patch ws message handler for export
  const orig = ws?.onmessage
  connect()
})

// Override ws to handle export
const origConnect = connect
connect = function() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}`
  ws = new WebSocket(url)
  ws.onopen = () => {
    document.getElementById('navStatus').className = 'nav-status connected'
    document.querySelector('.nav-status-text').textContent = 'Connected'
    document.querySelector('.nav-status-dot').style.background = '#22c55e'
  }
  ws.onclose = () => {
    document.getElementById('navStatus').className = 'nav-status'
    document.querySelector('.nav-status-text').textContent = 'Disconnected'
    document.querySelector('.nav-status-dot').style.background = '#ef4444'
    setTimeout(connect, 3000)
  }
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type === 'state') { state = data; render() }
      if (data.type === 'configExport') {
        const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' })
        const url2 = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url2; a.download = 'minecline-config.json'; a.click()
        URL.revokeObjectURL(url2)
        toast('Config exported', 'info')
      }
    } catch {}
  }
}
connect()

/* ═══ UTILITIES ═══ */
function esc(s) { if (typeof s !== 'string') return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML }
function fmtTime(t) { if (!t) return ''; const d = new Date(t); return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) }
function fmtUptime(sec) {
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = Math.floor(sec % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
