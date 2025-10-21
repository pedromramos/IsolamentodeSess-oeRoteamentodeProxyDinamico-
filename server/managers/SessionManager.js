import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { getPublicIpViaProxy } from '../utils/ipCheck.js';

const SESSIONS_DIR = path.resolve(process.cwd(), 'data', 'sessions');
const SCREENSHOTS_DIR = path.resolve(process.cwd(), 'public', 'screenshots');

export class SessionManager {
  constructor({ proxyManager, broadcast }) {
    this.proxyManager = proxyManager;
    this.broadcast = broadcast; // function(event)
    this.sessions = new Map(); // id -> session
    this.screenshotIntervalMs = 4000;
  }

  async createSessions({ url, count }) {
    if (!url || typeof url !== 'string') {
      throw new Error('url is required');
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error('count must be positive integer');
    }

    const assigned = this.proxyManager.assignExclusive(count);

    const created = [];
    for (const proxy of assigned) {
      const id = uuidv4();
      const userDataDir = path.join(SESSIONS_DIR, id);
      fs.mkdirSync(userDataDir, { recursive: true });

      const session = {
        id,
        proxyId: proxy.id,
        proxyUrl: proxy.url,
        label: proxy.label,
        userDataDir,
        url,
        status: 'starting',
        ip: null,
        browserContext: null,
        page: null,
        screenshotPath: path.join(SCREENSHOTS_DIR, `${id}.png`),
        screenshotTimer: null,
        createdAt: Date.now(),
      };
      this.sessions.set(id, session);
      created.push(session);
    }

    await Promise.all(created.map((s) => this.#startSession(s)));

    this.#emitState();

    return created.map((s) => this.#publicSession(s));
  }

  async #startSession(session) {
    try {
      const context = await chromium.launchPersistentContext(session.userDataDir, {
        headless: true,
        proxy: this.#toPlaywrightProxyOptions(session.proxyUrl),
        viewport: { width: 1280, height: 720 },
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--autoplay-policy=no-user-gesture-required',
        ],
      });
      const page = await context.newPage();
      session.browserContext = context;
      session.page = page;

      // Navigate and then determine public IP via Node request through the same proxy
      await page.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      session.status = 'running';
      this.#emitState();

      // Resolve public IP via proxy (Node-side), fallback to in-page if needed
      try {
        session.ip = await getPublicIpViaProxy(session.proxyUrl, 12000);
      } catch (e) {
        session.ip = await this.#getIpViaPage(page);
      }
      this.#emitState();

      // Start periodic screenshots
      await this.#ensureDirExists(SCREENSHOTS_DIR);
      await this.#takeScreenshot(session);
      session.screenshotTimer = setInterval(() => {
        this.#takeScreenshot(session).catch(() => {});
      }, this.screenshotIntervalMs);

      page.on('close', () => {
        session.status = 'closed';
        this.#emitState();
      });
    } catch (error) {
      session.status = 'error';
      session.error = String(error?.message || error);
      this.#emitState();
    }
  }

  async #getIpViaPage(page) {
    try {
      const res = await page.evaluate(async () => {
        try {
          const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
          const j = await r.json();
          return j.ip || null;
        } catch (e) {
          try {
            const r2 = await fetch('https://ifconfig.me/ip', { cache: 'no-store' });
            const t = await r2.text();
            return t.trim();
          } catch (e2) {
            return null;
          }
        }
      });
      return res;
    } catch {
      return null;
    }
  }

  #toPlaywrightProxyOptions(proxyUrl) {
    // Playwright accepts: { server, username, password }
    // We will parse basic auth from URL if present
    try {
      const u = new URL(proxyUrl);
      const server = `${u.protocol}//${u.host}`;
      const username = u.username || undefined;
      const password = u.password || undefined;
      return { server, username, password };
    } catch {
      return { server: proxyUrl };
    }
  }

  async #takeScreenshot(session) {
    if (!session?.page) return;
    try {
      await session.page.screenshot({ path: session.screenshotPath, fullPage: false });
      this.#emitState();
    } catch {}
  }

  async removeSession(id) {
    const session = this.sessions.get(id);
    if (!session) return false;

    try {
      if (session.screenshotTimer) clearInterval(session.screenshotTimer);
      if (session.page && !session.page.isClosed()) await session.page.close({ runBeforeUnload: false });
      if (session.browserContext && session.browserContext.close) await session.browserContext.close();
    } catch {}

    this.sessions.delete(id);
    this.proxyManager.releaseByIds([session.proxyId]);
    this.#emitState();
    return true;
  }

  async removeAllSessions() {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.removeSession(id)));
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((s) => this.#publicSession(s));
  }

  getSession(id) {
    const s = this.sessions.get(id);
    return s ? this.#publicSession(s) : null;
  }

  async controlAll(action, payload = {}) {
    const actions = {
      reload: async (s) => s.page?.reload({ waitUntil: 'domcontentloaded' }),
      navigate: async (s) => {
        const url = payload?.url;
        if (!url) return;
        s.url = url;
        await s.page?.goto(url, { waitUntil: 'domcontentloaded' });
      },
      play: async (s) => this.#evalMedia(s, 'play'),
      pause: async (s) => this.#evalMedia(s, 'pause'),
      mute: async (s) => this.#evalMedia(s, 'mute'),
      unmute: async (s) => this.#evalMedia(s, 'unmute'),
    };
    const fn = actions[action];
    if (!fn) throw new Error(`Unknown action: ${action}`);
    const sessions = Array.from(this.sessions.values());
    await Promise.all(sessions.map((s) => fn(s).catch(() => {})));
    this.#emitState();
  }

  async #evalMedia(session, op) {
    if (!session.page) return;
    await session.page.evaluate((operation) => {
      const videos = Array.from(document.querySelectorAll('video'));
      for (const v of videos) {
        try {
          if (operation === 'play') v.play();
          if (operation === 'pause') v.pause();
          if (operation === 'mute') v.muted = true;
          if (operation === 'unmute') v.muted = false;
        } catch {}
      }
      // Basic YouTube IFrame API support if present
      try {
        // eslint-disable-next-line no-undef
        if (window.YT && YT.get && YT.get('player')) {
          const player = YT.get('player');
          if (operation === 'play') player.playVideo();
          if (operation === 'pause') player.pauseVideo();
          if (operation === 'mute') player.mute();
          if (operation === 'unmute') player.unMute();
        }
      } catch {}
    }, op);
  }

  #publicSession(s) {
    return {
      id: s.id,
      proxyId: s.proxyId,
      proxyUrl: s.proxyUrl,
      label: s.label,
      url: s.url,
      status: s.status,
      ip: s.ip,
      screenshotUrl: `/screenshots/${s.id}.png?ts=${Date.now()}`,
      createdAt: s.createdAt,
      error: s.error || null,
    };
  }

  #emitState() {
    const payload = { type: 'state', sessions: this.listSessions() };
    try { this.broadcast(payload); } catch {}
  }

  async #ensureDirExists(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}
