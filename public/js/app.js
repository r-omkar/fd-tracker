import { state, reload, icon, esc, toast } from './ui.js';
import * as db from './db.js';
import * as overview from './views/overview.js';
import * as list from './views/list.js';
import * as detail from './views/detail.js';
import * as form from './views/form.js';
import * as importer from './views/importer.js';
import * as more from './views/more.js';
import { checkMaturityAlerts } from './alerts.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');

const ROUTES = [
  [/^\/?$/, overview.render, 'overview'],
  [/^\/overview$/, overview.render, 'overview'],
  [/^\/fds$/, list.render, 'fds'],
  [/^\/fd\/(\w+)$/, detail.render, 'fds'],
  [/^\/add$/, importer.renderChoice, 'add'],
  [/^\/add\/manual$/, (c) => form.render({ ...c, mode: 'new' }), 'add'],
  [/^\/edit\/(\w+)$/, (c) => form.render({ ...c, mode: 'edit' }), 'fds'],
  [/^\/renew\/(\w+)$/, (c) => form.render({ ...c, mode: 'renew' }), 'fds'],
  [/^\/add\/excel$/, importer.renderExcel, 'add'],
  [/^\/more$/, more.render, 'more'],
  [/^\/people$/, more.renderPeople, 'more'],
];

function drawNav(active) {
  const items = [['overview', 'Overview', 'home'], ['fds', 'All FDs', 'list'], ['add', 'Add FD', 'plus'], ['more', 'More', 'more']];
  nav.innerHTML = `<div class="brand">${icon('wallet')} FD Tracker</div>` +
    items.map(([id, label, ic]) => `<a href="#/${id}" class="${active === id ? 'on' : ''}" ${active === id ? 'aria-current="page"' : ''}><span class="nav-ico">${icon(ic)}</span>${label}</a>`).join('');
  nav.classList.remove('hidden');
}

async function route() {
  if (!state.loaded || locked) return;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  for (const [re, fn, section] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    drawNav(section);
    view.innerHTML = '';
    window.scrollTo(0, 0);
    try {
      await fn({ root: view, params: m.slice(1), query: new URLSearchParams(qs || '') });
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="empty">${icon('alert')}<p>${esc(e.message)}</p><a class="btn" href="#/overview">Go to Overview</a></div>`;
    }
    return;
  }
  location.hash = '#/overview';
}
window.addEventListener('hashchange', route);
// A link to the page we're already on (e.g. "Back" inside a multi-step import) should still restart that page.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
});

// ---------- PIN lock ----------
let locked = true;
function pinScreen({ title, sub, onSubmit, fingerprint = false }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'lock';
    el.innerHTML = `
      <div class="lock-box">
        <div class="lock-logo">${icon('wallet')}</div>
        <div><h1 id="lk-title">${esc(title)}</h1><p class="muted" id="lk-sub" style="margin-top:.35rem">${esc(sub)}</p></div>
        <div class="pin-dots" aria-hidden="true"></div>
        <div class="lock-msg" role="alert"></div>
        <div class="keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
          <button class="txt" data-k="clear">Clear</button><button data-k="0">0</button><button class="txt" data-k="del" aria-label="Delete">⌫</button>
        </div>
        <button class="btn primary block" data-k="ok">Continue</button>
        ${fingerprint ? `<button class="btn block" data-k="finger">${icon('finger')} Use fingerprint</button>` : ''}
      </div>`;
    document.body.append(el);
    let pin = '';
    const dots = el.querySelector('.pin-dots');
    const msg = el.querySelector('.lock-msg');
    const draw = () => (dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'f' : ''}"></span>`).join(''));
    draw();
    const finish = () => { el.remove(); document.removeEventListener('keydown', onKey); resolve(); };
    const ctl = {
      setText: (t, s) => { el.querySelector('#lk-title').textContent = t; el.querySelector('#lk-sub').textContent = s; },
      reset: () => { pin = ''; draw(); },
      error: (m) => { msg.textContent = m; pin = ''; draw(); },
    };
    const submit = async () => {
      if (pin.length < 4) return ctl.error('Enter at least 4 digits');
      msg.textContent = '';
      if ((await onSubmit(pin, ctl)) === true) finish();
    };
    const useFinger = async () => {
      try { await db.fingerprintUnlock(); finish(); } catch { msg.textContent = 'Fingerprint not recognised. Please use your PIN.'; }
    };
    const press = (k) => {
      if (k === 'ok') return submit();
      if (k === 'finger') return useFinger();
      if (k === 'clear') pin = '';
      else if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < 8) pin += k;
      msg.textContent = '';
      draw();
    };
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
    };
    document.addEventListener('keydown', onKey);
    if (fingerprint) setTimeout(useFinger, 300);
  });
}

async function unlock() {
  locked = true;
  view.style.visibility = 'hidden';
  await pinScreen({
    title: 'Enter your PIN',
    sub: 'FD Tracker is locked',
    fingerprint: db.fingerprintOn(),
    onSubmit: async (pin, ctl) => {
      try { await db.checkPin(pin); return true; } catch (e) { ctl.error(e.message); }
    },
  });
  locked = false;
  view.style.visibility = '';
  lastActive = Date.now();
}

function setupPin() {
  let first = null;
  return pinScreen({
    title: 'Welcome to FD Tracker',
    sub: 'Create a PIN (4 to 8 digits). You will use it to open the app.',
    onSubmit: async (pin, ctl) => {
      if (!first) { first = pin; ctl.reset(); ctl.setText('Confirm PIN', 'Enter the same PIN again'); return; }
      if (pin !== first) { first = null; ctl.setText('Create a PIN', 'The two PINs did not match. Please start again.'); ctl.reset(); return; }
      try { await db.setPin(pin); return true; } catch (e) { ctl.error(e.message); }
    },
  });
}

// Lock again when the app comes back after being idle.
let lastActive = Date.now();
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => (lastActive = Date.now()), { passive: true }));
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') { lastActive = Math.min(lastActive, Date.now()); return; }
  if (locked || !state.loaded) return;
  if (Date.now() - lastActive > (state.settings.lockMinutes || 15) * 60000) {
    await unlock();
    route();
  }
});

async function boot() {
  try {
    await db.load();
  } catch (e) {
    view.innerHTML = `<div class="empty">${icon('alert')}<h2>Storage not available</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (!db.hasPin()) await setupPin();
  else await unlock();
  locked = false;
  await reload();
  route();
  checkMaturityAlerts().catch(() => {});
}

// Remember Chrome's "Install app" prompt so More can offer an Install button.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Something went wrong'));
