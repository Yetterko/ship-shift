// Renders the dining-room TV stand-ins (FR-34, NFR-11): public/tv/start.png and order-1.png ... order-5.png.
// Each is Rosterette (template-project/) as it would look after that Order ships, made by hand-written "after"
// changes applied in a headless page. Run: npm run tv. Never a visible window.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../test/helpers/headless.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'template-project'), out = path.join(root, 'public', 'tv');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown' };

// Each "after" runs in the page once Rosterette has rendered. Plain DOM and CSS: what the Chefs' Meals describe.
const AFTER = {
  start: () => {},
  // 1 · Priya: a Total column with each person's weekly hours
  1: () => {
    const hrs = s => { const [a, b] = [s.split('-')[0], s.split('-')[1]].map(t => { const [h, m] = t.split(':').map(Number); return h + m / 60; }); return b - a; };
    document.querySelector('#roster thead tr').insertAdjacentHTML('beforeend', '<th style="background:#dbe7f5">Total</th>');
    for (const tr of document.querySelectorAll('#roster tbody tr')) {
      const total = [...tr.querySelectorAll('td.shift')].reduce((n, td) => n + hrs(td.textContent), 0);
      tr.insertAdjacentHTML('beforeend', `<td style="font-weight:700;background:#f2f7fc">${total} h</td>`);
    }
    addCheck('Totals add up for every staff member');
  },
  // 2 · Dev: dark mode with a header toggle
  2: () => {
    const css = document.createElement('style');
    css.textContent = 'body{background:#15191f;color:#e4e7eb}.top h1{color:#8cb8f2}.week{color:#9aa5b1}.roster,.checks{background:#1e242c;border-color:#333c48}.roster th,.roster td{border-color:#333c48}.roster thead th{background:#262e38}.roster td.shift{background:#1f3a5c;color:#cfe3fb}'
      + '.tg{position:absolute;right:24px;top:22px;display:flex;align-items:center;gap:8px;font-size:13px}.tg i{width:38px;height:22px;border-radius:11px;background:#4c8fd6;position:relative}.tg i::after{content:"";position:absolute;right:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#fff}';
    document.head.append(css);
    document.querySelector('.top').insertAdjacentHTML('beforeend', '<span class="tg">Dark <i></i></span>');
    addCheck('The toggle switches the theme');
  },
  // 3 · Quinn: clashing shifts in red with a tooltip
  3: () => {
    const cell = document.querySelector('#roster tbody tr:nth-child(2) td:nth-child(2)');
    cell.textContent = '09:00-15:00 / 14:00-22:00';
    for (const td of [cell]) { td.style.background = '#fde2e2'; td.style.color = '#9b1c1c'; td.style.outline = '2px solid #e53e3e'; }
    cell.insertAdjacentHTML('beforeend', '<div style="position:absolute;margin-top:6px;background:#2d3748;color:#fff;font-size:12px;padding:4px 8px;border-radius:4px">Overlaps 14:00-15:00</div>');
    addCheck('Overlapping shifts are flagged');
  },
  // 4 · Morgan: a role on each person and a role filter
  4: () => {
    const roles = ['Barista', 'Chef', 'Barista', 'Manager', 'Chef'];
    const tbody = document.querySelector('#roster tbody');
    tbody.insertAdjacentHTML('beforeend', '<tr><th scope="row">Eli</th><td></td><td class="shift">10:00-16:00</td><td></td><td></td><td class="shift">10:00-16:00</td><td></td><td></td></tr>');
    [...tbody.querySelectorAll('th')].forEach((th, i) => th.insertAdjacentHTML('beforeend', `<small style="display:block;font-weight:400;color:#616e7c">${roles[i]}</small>`));
    document.querySelector('main').insertAdjacentHTML('afterbegin', '<label style="display:inline-flex;gap:8px;align-items:center;margin:0 0 10px;font-size:14px">Role <select style="font:inherit;padding:4px 8px"><option>All roles</option></select></label>');
    addCheck('The role filter shows only matching staff');
  },
  // 5 · Sam: "make it pop": a bold brand header, hover and a today highlight
  5: () => {
    const css = document.createElement('style');
    css.textContent = '.top{background:linear-gradient(90deg,#6b46c1,#d53f8c);color:#fff;padding:22px 24px 14px}.top h1{color:#fff;font-size:32px;letter-spacing:.02em}.week{color:#fde8f3}.roster thead th:nth-child(4){background:#fbd38d}.roster td:nth-child(4){background:#fff7e6}.roster td.shift{border-radius:0;font-weight:600}';
    document.head.append(css);
    addCheck('isToday() marks the right column');
  },
};
function addCheck(name) { document.getElementById('checks').insertAdjacentHTML('beforeend', `<li class="pass">${name}</li>`); }

const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(site, p === '/' ? 'index.html' : p);
  if (!file.startsWith(site)) { res.writeHead(403); return res.end(); }
  try { const body = await fs.readFile(file); res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
await fs.mkdir(out, { recursive: true });
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
  for (const [key, fn] of Object.entries(AFTER)) {
    await page.goto(url);
    await page.waitForSelector('body[data-ready="1"]');
    await page.evaluate(`(() => { ${addCheck.toString()}; (${fn.toString()})(); })()`);
    const name = key === 'start' ? 'start.png' : `order-${key}.png`;
    await page.screenshot({ path: path.join(out, name) });
    const { size } = await fs.stat(path.join(out, name));
    console.log(`${name}  ${(size / 1024).toFixed(1)} KB`);
    if (size > 60 * 1024) throw new Error(`${name} is over 60 KB`);
  }
} finally { await browser.close(); server.close(); }
