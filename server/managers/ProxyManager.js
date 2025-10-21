import { v4 as uuidv4 } from 'uuid';

export class ProxyManager {
  constructor() {
    this.proxies = []; // { id, url, inUse, lastCheckedAt, lastCheckOk, label }
  }

  loadProxies(proxyUrls) {
    this.proxies = proxyUrls
      .map((raw, index) => raw?.trim())
      .filter(Boolean)
      .map((url, idx) => ({
        id: uuidv4(),
        url,
        inUse: false,
        lastCheckedAt: null,
        lastCheckOk: null,
        label: `proxy-${idx + 1}`,
      }));
    return this.listProxies();
  }

  listProxies() {
    return this.proxies.map(({ id, url, inUse, lastCheckedAt, lastCheckOk, label }) => ({
      id,
      url,
      inUse,
      lastCheckedAt,
      lastCheckOk,
      label,
    }));
  }

  assignExclusive(count) {
    const available = this.proxies.filter((p) => !p.inUse);
    if (available.length < count) {
      throw new Error(`Not enough proxies available: requested ${count}, available ${available.length}`);
    }
    const selected = available.slice(0, count);
    selected.forEach((p) => (p.inUse = true));
    return selected;
  }

  releaseByIds(proxyIds) {
    const idSet = new Set(proxyIds);
    this.proxies.forEach((p) => {
      if (idSet.has(p.id)) {
        p.inUse = false;
      }
    });
  }

  getById(id) {
    return this.proxies.find((p) => p.id === id) || null;
  }
}
