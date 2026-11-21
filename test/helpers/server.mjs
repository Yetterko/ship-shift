// Starts a real Ship Shift server in a child process for a test: startServer(env) -> { url, port, stop, logs }.
// The real API is never reachable from here: any ANTHROPIC_* variable in the parent environment is dropped, and a key
// without ANTHROPIC_BASE_URL (the mock) is refused.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {Record<string,string>} [env] extra environment for the server, e.g. { ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: mock.url }
 * @returns {Promise<{url:string, port:number, stop:()=>Promise<void>, logs:string[]}>}
 */
export function startServer(env = {}) {
  if (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_BASE_URL) throw new Error('Refusing to start: a test set ANTHROPIC_API_KEY without ANTHROPIC_BASE_URL pointing at the mock.');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ANTHROPIC_') && k !== 'SHOWCASE'));
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], {
    cwd: root, env: { ...clean, PORT: '0', SHIP_HOST: '127.0.0.1', SHIP_NO_QR: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const logs = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Server did not start:\n${logs.join('')}`)); }, 15_000);
    const onData = d => {
      const text = String(d); logs.push(text);
      const m = /listening on (http:\/\/localhost:(\d+))/.exec(logs.join(''));
      if (m && timer) {
        clearTimeout(timer);
        const port = Number(m[2]);
        resolve({
          url: `http://127.0.0.1:${port}`, port, logs,
          stop: () => new Promise(r => { if (child.exitCode !== null) return r(); child.once('exit', () => r()); child.kill(); }),
        });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', d => logs.push(String(d)));
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}):\n${logs.join('')}`)); });
  });
}

/** A small WebSocket client for tests: send(type, body), next(type, pred?), act(name, args) -> ack. */
export async function wsClient(url) {
  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(url.replace(/^http/, 'ws') + '/ws');
  const msgs = [];
  const waiters = [];
  ws.on('message', d => {
    const m = JSON.parse(d); msgs.push(m);
    for (const w of [...waiters]) if (w.type === m.type && w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let seq = 0;
  const c = {
    ws, msgs,
    send: (type, body = {}) => ws.send(JSON.stringify({ type, ...body })),
    next: (type, pred = () => true, timeout = 10_000) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`No ${type} message in ${timeout} ms`)), timeout);
      waiters.push({ type, pred, resolve: m => { clearTimeout(t); resolve(m); } });
    }),
    act: (name, args = {}) => { const s = ++seq; const p = c.next('ack', m => m.seq === s); c.send('action', { seq: s, name, args }); return p; },
    last: type => msgs.filter(m => m.type === type).pop(),
    close: () => ws.close(),
  };
  return c;
}
