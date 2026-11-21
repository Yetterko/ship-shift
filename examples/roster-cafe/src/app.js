import http from 'node:http';
import fs from 'node:fs/promises';
import { weekView } from './roster.js';
import { timesheetCsv } from './timesheet.js';

const PAGE = new URL('../public/index.html', import.meta.url);
const DATA = new URL('../data/roster.json', import.meta.url);

/** The cafe's HTTP server. The roster file is read on every request, so an edit shows on the next refresh. */
export function createApp(dataFile = DATA) {
  const load = async () => JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const send = (res, code, type, body) => {
    res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(body);
  };
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (req.method !== 'GET') return send(res, 405, 'text/plain', 'Method not allowed');
      if (pathname === '/') return send(res, 200, 'text/html', await fs.readFile(PAGE));
      if (pathname === '/api/roster') return send(res, 200, 'application/json', JSON.stringify(weekView(await load())));
      if (pathname === '/timesheet.csv') return send(res, 200, 'text/csv', timesheetCsv(await load()));
      send(res, 404, 'text/plain', 'Not found');
    } catch (e) {
      send(res, 500, 'text/plain', e.message);
    }
  });
}
