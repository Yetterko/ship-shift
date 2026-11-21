// The dining-room TV (FR-34). Audience floors: a pre-made "after" screenshot of the sample app for each Order shipped
// (a stand-in, labelled as one). The showcase floor: the real app, which full screen is a live iframe that reloads when
// files change. Tapping the TV opens it full screen.
import { THREE } from './scene.js';
import { esc } from './core.js';
import { F, setTvTexture } from './floor.js';

const T = { shots: '', version: -1, el: null, loader: new THREE.TextureLoader(), want: null };
const orderNumber = id => { const m = /(\d+)/.exec(String(id)); return m ? +m[1] : 1; };
export const shotUrl = orderId => (orderId ? `/tv/order-${orderNumber(orderId)}.png` : '/tv/start.png');

/** Swaps the TV's picture when a new Order ships (or, on the showcase floor, when the preview changes). */
export function syncTv(S) {
  if (!S) return;
  const shots = (S.tv?.shots || []).join(',');
  if (S.kind === 'showcase') {
    if (S.tv.version === T.version) return;
    T.version = S.tv.version;
    setTvTexture(liveCard(S.tv.version));
    const f = T.el?.querySelector('iframe'); if (f) f.src = `/preview/showcase/?v=${S.tv.version}`;
    return;
  }
  if (shots === T.shots) return;
  T.shots = shots;
  showShot(S.tv.shots.at(-1) || null);
}
/** Puts one Order's after-screenshot on the TV (null: the start picture). */
export function showShot(orderId) {
  const url = shotUrl(orderId); T.want = url;
  T.loader.load(url, tex => {
    if (T.want !== url || !F.root) { tex.dispose(); return; }
    tex.colorSpace = THREE.SRGBColorSpace; setTvTexture(tex);
  }, undefined, () => { if (T.want === url) setTvTexture(null); });
  const img = T.el?.querySelector('img'); if (img) img.src = url;
}
function liveCard(version) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#fdf6e6'; g.fillRect(0, 0, 320, 200);
  g.fillStyle = '#3a241c'; g.fillRect(0, 0, 320, 30);
  g.fillStyle = '#ffd75e'; g.font = '700 17px Rubik, sans-serif'; g.textBaseline = 'middle'; g.fillText('Rosterette · live', 10, 16);
  g.fillStyle = '#e5533d'; g.beginPath(); g.arc(300, 15, 6, 0, 7); g.fill();
  g.fillStyle = '#3a241c'; g.font = '600 15px Rubik, sans-serif'; g.textAlign = 'center';
  g.fillText('The real app, running', 160, 95); g.fillText(`change ${version}`, 160, 125); g.font = '500 12px Rubik, sans-serif'; g.fillText('Tap the TV to open it', 160, 160);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The TV full screen: the screenshot with its stand-in note, or the live preview. */
export function openTvFull() {
  closeTvFull();
  const S = F.snap; if (!S) return;
  const live = S.kind === 'showcase';
  const el = document.createElement('div');
  el.className = 'fl-tvfull sh-full'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'The TV');
  const last = S.tv.shots.at(-1);
  el.innerHTML = `<div class="fl-tvcard"><header><b>${live ? 'Rosterette · live preview' : 'Rosterette'}</b><button type="button" class="fl-close" aria-label="Close">×</button></header>
    ${live ? `<iframe src="/preview/showcase/?v=${S.tv.version}" title="The sample app, live"></iframe>` : `<img src="${esc(shotUrl(last))}" alt="The sample app ${last ? `after Order #${orderNumber(last)} shipped` : 'before any Order shipped'}">`}
    <p class="fl-note">${live ? 'This is the real Rosterette codebase the stage kitchen is editing. It reloads when a Chef changes a file.' : `Stand-in: a pre-made screenshot of the app ${last ? `after Order #${orderNumber(last)}` : 'before the first Order'}. On your phone, Chefs write their answer as text; our stage kitchen is wired to a real repo.`}</p>
    ${!live && S.tv.shots.length > 1 ? `<div class="fl-row">${S.tv.shots.map(o => `<button type="button" class="fl-btn ghost sm" data-shot="${esc(o)}">#${orderNumber(o)}</button>`).join('')}</div>` : ''}</div>`;
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.fl-close')) closeTvFull(); const s = e.target.closest('[data-shot]'); if (s) el.querySelector('img').src = shotUrl(s.dataset.shot); });
  (document.getElementById('floorUi') || document.body).append(el);
  T.el = el;
}
export function closeTvFull() { T.el?.remove(); T.el = null; }
export const tvOpen = () => !!T.el;
export function disposeTv() { closeTvFull(); T.shots = ''; T.version = -1; T.want = null; }
