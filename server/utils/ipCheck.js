import ProxyAgent from 'proxy-agent';
import https from 'node:https';
import http from 'node:http';

export async function getPublicIpViaProxy(proxyUrl, timeoutMs = 10000) {
  const agent = new ProxyAgent(proxyUrl);
  const url = 'https://api.ipify.org?format=json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const data = await new Promise((resolve, reject) => {
      const request = https.get(url, { agent, signal: controller.signal }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Status ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      });
      request.on('error', reject);
    });
    const parsed = JSON.parse(data);
    return parsed?.ip || null;
  } finally {
    clearTimeout(timeout);
  }
}
