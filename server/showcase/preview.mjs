// The live preview: the sandbox's files at /preview/showcase/, never cached, so the TV iframe shows each change.
import fs from 'node:fs/promises';
import path from 'node:path';
import { inside } from './sandbox.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function servePreview(dir, req, res, subpath = '/') {
  const rel = subpath.replace(/^\/+/, '') || 'index.html';
  const file = inside(dir, rel);
  const fail = (code, msg) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg); };
  if (!file || rel.split(/[\\/]/).some(s => s.startsWith('.'))) return fail(404, 'Not found');
  return fs.readFile(file).then(body => {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }, () => fail(404, 'Not found'));
}
