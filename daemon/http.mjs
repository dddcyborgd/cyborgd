/*! cyborgd — http · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// A router on node:http: path params (/space/:id), JSON bodies (256 KB limit), CORS * for GET (and
// the OPTIONS preflight the browser sends before a POST), JSON errors, no framework. Handlers get
// ctx = { req, res, method, path, params, query, body, ip, claim() } and return a body (200), or
// { status, body, headers }, or throw { status, code, message } (FaucetError shape).
import { createServer } from 'node:http';

export const BODY_LIMIT = 256 * 1024;
export const VERSION = '0.0.1-alpha';

export class HttpError extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra || {}; } }

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  return { re, keys };
}

export class Router {
  constructor({ log = null, cors = '*' } = {}) { this.routes = []; this.log = log; this.cors = cors; }
  add(method, pattern, fn) { this.routes.push({ method, pattern, fn, ...compile(pattern) }); return this; }
  get(p, fn) { return this.add('GET', p, fn); }
  post(p, fn) { return this.add('POST', p, fn); }
  match(method, path) {
    let pathHit = false;
    for (const r of this.routes) {
      const m = r.re.exec(path); if (!m) continue;
      pathHit = true;
      if (r.method !== method) continue;
      return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return pathHit ? { methodMismatch: true } : null;
  }
  readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(new HttpError(413, 'too-large', 'body exceeds 256 KB')); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  async handle(req, res) {
    const url = new URL(req.url || '/', 'http://x');
    const method = (req.method || 'GET').toUpperCase();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-cyborgd': VERSION };
    if (this.cors) { headers['access-control-allow-origin'] = this.cors; headers['access-control-allow-headers'] = 'content-type, authorization'; headers['access-control-allow-methods'] = 'GET, POST, OPTIONS'; }
    const send = (status, body, extra = {}) => {
      const h = { ...headers, ...extra };
      if (typeof body === 'string' && !h['content-type'].startsWith('text')) h['content-type'] = 'text/plain; charset=utf-8';
      const out = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, h); res.end(out);
    };
    try {
      if (method === 'OPTIONS') return send(204, '');
      const hit = this.match(method === 'HEAD' ? 'GET' : method, url.pathname);
      if (!hit) throw new HttpError(404, 'not-found', 'no route ' + url.pathname);
      if (hit.methodMismatch) throw new HttpError(405, 'method', method + ' not allowed on ' + url.pathname);
      let body = null;
      if (method === 'POST') {
        const raw = await this.readBody(req);
        if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch (e) { throw new HttpError(400, 'bad-json', 'body is not JSON'); } }
      }
      const auth = String(req.headers.authorization || '');
      const ctx = { req, res, method, path: url.pathname, params: hit.params, query: Object.fromEntries(url.searchParams), body, ip,
        claimToken: auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('claim') || (body && body.claim) || null) };
      const out = await hit.route.fn(ctx);
      if (out && typeof out === 'object' && 'status' in out && 'body' in out && Object.keys(out).every((k) => ['status', 'body', 'headers'].includes(k))) return send(out.status, out.body, out.headers);
      return send(200, out === undefined ? { ok: true } : out);
    } catch (e) {
      const status = e.status || 500, code = e.code || 'error';
      if (status >= 500) this.log?.('http error', e && e.stack ? e.stack : e);
      return send(status, { error: e.message || String(e), code, ...(e.extra || {}) });
    }
  }
  listen(port, host) { const server = createServer((req, res) => this.handle(req, res)); return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server)); }); }
}
