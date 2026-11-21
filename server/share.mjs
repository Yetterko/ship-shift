// `npm run share`: public mode on this laptop, behind a free Cloudflare quick tunnel, with the link and a QR code printed.
// `npm run share -- --lan` skips the tunnel and shares on the local network only.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT) || 4610;
const LAN_ONLY = args.includes('--lan');
const local = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const children = [];

const INSTALL = `cloudflared is not installed, so there is no public link yet. Install it with one line, then run \`npm run share\` again:

  Windows   winget install --id Cloudflare.cloudflared
  macOS     brew install cloudflared
  Linux     sudo curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && sudo chmod +x /usr/local/bin/cloudflared

No install rights? Download the cloudflared binary into this folder, or point SHIP_CLOUDFLARED at it.
`;

/** cloudflared from SHIP_CLOUDFLARED, the PATH, or a binary dropped in the project folder. */
function findCloudflared() {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const candidates = [process.env.SHIP_CLOUDFLARED, 'cloudflared', path.join(root, exe), path.join(root, '.kitchen', exe)].filter(Boolean);
  return candidates.find(c => (c === 'cloudflared' || fs.existsSync(c)) && spawnSync(c, ['--version'], { windowsHide: true }).status === 0) || null;
}

function lanUrls() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
    .map(n => `http://${n.address}:${PORT}`);
}

function stop(code = 0) {
  for (const c of children) if (c.exitCode === null) c.kill();
  // Give the kitchen a moment to delete its visitors' repos.
  setTimeout(() => process.exit(code), 1500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function announce(url, how) {
  console.log(`\n  Ship Shift is shared ${how}:\n\n      ${url}\n`);
  qrcode.generate(url, { small: true }, code => console.log(code.split('\n').map(l => '      ' + l).join('\n')));
  console.log('\n  Everyone who opens the link gets a private kitchen with simulated chefs. Nothing here can run a real agent.');
  console.log('  Leave this running while people play. Ctrl+C stops sharing.\n');
}

async function startKitchen() {
  const kitchen = spawn(process.execPath, [path.join(root, 'server', 'index.mjs'), '--public'], {
    cwd: root, env: { ...process.env, PORT: String(PORT), SHIP_PUBLIC: '1' }, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
  });
  children.push(kitchen);
  let gone = false;
  kitchen.on('exit', code => { gone = true; if (code) console.error(`The kitchen stopped (exit ${code}). Is port ${PORT} already in use? Try \`npm run share -- --port 4620\`.`); stop(code || 0); });
  for (let i = 0; i < 100 && !gone; i++) {
    try { if ((await fetch(`${local}/healthz`)).ok) return; } catch { /* not up yet */ }
    await sleep(150);
  }
  if (!gone) { console.error(`The kitchen did not answer on ${local}.`); stop(1); }
  await new Promise(() => {});
}

/** Opens the quick tunnel and resolves with its https://….trycloudflare.com address once Cloudflare has connected it. */
function openTunnel(bin) {
  return new Promise((resolve, reject) => {
    const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', local], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.push(tunnel);
    let log = '', url = null, timer = null, done = false;
    const finish = () => { if (!done && url) { done = true; clearTimeout(timer); resolve(url); } };
    const read = chunk => {
      log += chunk;
      url ||= (log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) || [])[0] || null;
      // The address is printed a few seconds before it works, so wait for the connection, but not for ever.
      if (url && !timer) timer = setTimeout(finish, 15_000);
      if (url && /Registered tunnel connection/.test(log)) finish();
    };
    tunnel.stdout.on('data', read); tunnel.stderr.on('data', read);
    tunnel.on('error', reject);
    tunnel.on('exit', code => {
      if (!done) return reject(new Error(`cloudflared stopped before the tunnel opened (exit ${code}).\n${log.trim().split('\n').slice(-8).join('\n')}`));
      console.error('The tunnel closed, so the link no longer works.'); stop(1);
    });
  });
}

const bin = LAN_ONLY ? null : findCloudflared();
await startKitchen();
if (bin) {
  try {
    announce(await openTunnel(bin), 'on the internet, through a Cloudflare quick tunnel');
  } catch (e) {
    console.error(e.message);
    stop(1);
  }
} else {
  if (!LAN_ONLY) console.log('\n' + INSTALL);
  const urls = lanUrls();
  if (urls.length) {
    announce(urls[0], 'with anyone on the same Wi-Fi or network');
    if (urls.length > 1) console.log(`  Other addresses for this machine: ${urls.slice(1).join(', ')}\n`);
    console.log('  If nobody else can open it, allow Node through this machine\'s firewall for private networks.\n');
  } else {
    console.log(`  No network found. The kitchen is open on this machine only: ${local}\n`);
  }
}
