const api = {
  async setProxies(proxies) {
    const res = await fetch('/proxies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxies }),
    });
    if (!res.ok) throw new Error('Falha ao enviar proxies');
    return res.json();
  },
  async createSessions(url, count) {
    const res = await fetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, count }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao criar sessões');
    return data;
  },
  async control(action, payload) {
    const res = await fetch(`/control/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    if (!res.ok) throw new Error('Falha no controle');
  },
  async listSessions() {
    const res = await fetch('/sessions');
    return res.json();
  },
};

const state = { sessions: [] };

function renderSessions() {
  const grid = document.getElementById('sessionsGrid');
  grid.innerHTML = '';
  for (const s of state.sessions) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded shadow p-3';
    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold">${s.label} — <span class="text-slate-500 text-sm">${s.id.slice(0,8)}</span></div>
        <div class="text-xs px-2 py-1 rounded ${statusColor(s.status)}">${s.status}</div>
      </div>
      <div class="text-sm space-y-1">
        <div><span class="font-medium">Proxy:</span> <span class="break-all">${s.proxyUrl}</span></div>
        <div><span class="font-medium">IP:</span> ${s.ip || '<em>resolvendo…</em>'}</div>
        <div><span class="font-medium">URL:</span> <span class="break-all">${s.url}</span></div>
      </div>
      <div class="mt-2">
        <img src="${s.screenshotUrl}" class="w-full aspect-video object-cover rounded border" onerror="this.src='';" />
      </div>
    `;
    grid.appendChild(card);
  }
}

function statusColor(st) {
  if (st === 'running') return 'bg-green-100 text-green-800';
  if (st === 'starting') return 'bg-yellow-100 text-yellow-800';
  if (st === 'error') return 'bg-red-100 text-red-800';
  if (st === 'closed') return 'bg-slate-100 text-slate-800';
  return 'bg-slate-100 text-slate-800';
}

function connectWS() {
  const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        state.sessions = msg.sessions || [];
        renderSessions();
      }
    } catch {}
  };
  ws.onclose = () => {
    setTimeout(connectWS, 3000);
  };
}

async function onStart() {
  const raw = document.getElementById('txtProxies').value;
  const url = document.getElementById('txtUrl').value.trim();
  const count = Number(document.getElementById('txtCount').value);
  const proxies = raw.split(/\n|\r/).map((l) => l.trim()).filter(Boolean);
  if (!proxies.length) {
    alert('Informe ao menos um proxy');
    return;
  }
  if (!url) {
    alert('Informe uma URL');
    return;
  }
  try {
    await api.setProxies(proxies);
    await api.createSessions(url, count);
  } catch (e) {
    alert(e.message || e);
  }
}

function bindControls() {
  document.getElementById('btnStart').addEventListener('click', onStart);
  document.getElementById('btnReloadAll').addEventListener('click', () => api.control('reload'));
  document.getElementById('btnPlayAll').addEventListener('click', () => api.control('play'));
  document.getElementById('btnPauseAll').addEventListener('click', () => api.control('pause'));
  document.getElementById('btnMuteAll').addEventListener('click', () => api.control('mute'));
  document.getElementById('btnUnmuteAll').addEventListener('click', () => api.control('unmute'));
}

bindControls();
connectWS();
renderSessions();
