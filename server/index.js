import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { ProxyManager } from './managers/ProxyManager.js';
import { SessionManager } from './managers/SessionManager.js';

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.resolve(process.cwd(), 'public');
const dataDir = path.resolve(process.cwd(), 'data');

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(path.join(publicDir, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(express.static(publicDir));

// WebSocket broadcast
const clients = new Set();
function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

const proxyManager = new ProxyManager();
const sessionManager = new SessionManager({ proxyManager, broadcast });

// API routes
app.post('/proxies', (req, res) => {
  const { proxies } = req.body || {};
  if (!Array.isArray(proxies) || proxies.length === 0) {
    return res.status(400).json({ error: 'proxies must be a non-empty array of URLs' });
  }
  const list = proxyManager.loadProxies(proxies);
  return res.json({ proxies: list });
});

app.get('/proxies', (req, res) => {
  return res.json({ proxies: proxyManager.listProxies() });
});

app.post('/sessions', async (req, res) => {
  try {
    const { url, count } = req.body || {};
    const created = await sessionManager.createSessions({ url, count: Number(count) });
    res.json({ sessions: created });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/sessions', (req, res) => {
  res.json({ sessions: sessionManager.listSessions() });
});

app.get('/sessions/:id', (req, res) => {
  const s = sessionManager.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});

app.delete('/sessions/:id', async (req, res) => {
  const ok = await sessionManager.removeSession(req.params.id);
  res.json({ ok });
});

app.post('/control/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const payload = req.body || {};
    await sessionManager.controlAll(action, payload);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  // Send initial state
  ws.send(JSON.stringify({ type: 'state', sessions: sessionManager.listSessions() }));
});
