// FD Tracker service worker: makes the app work offline and shows maturity alerts.
const VERSION = 'fd-v4';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/calc.js', 'js/db.js', 'js/backup.js', 'js/excel.js', 'js/alerts.js',
  'js/views/overview.js', 'js/views/list.js', 'js/views/detail.js', 'js/views/form.js', 'js/views/importer.js', 'js/views/more.js',
  'vendor/exceljs.min.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Offline first: serve from cache, refresh the cache in the background when online.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok && req.mode !== 'navigate') cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Offline', { status: 503 });
  })());
});

// ---------- maturity alerts ----------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('fd-tracker', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('photos'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const kv = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction('kv', mode);
  const r = fn(t.objectStore('kv'));
  t.oncomplete = () => resolve(r.result);
  t.onerror = () => reject(t.error);
});
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };

async function checkAndNotify() {
  const db = await idb();
  const main = await kv(db, 'readonly', (s) => s.get('main'));
  if (!main?.settings?.alerts) return;
  const notified = new Set((await kv(db, 'readonly', (s) => s.get('notified'))) || []);
  const names = Object.fromEntries((main.people || []).map((p) => [p.id, p.name]));
  const today = todayISO();
  let changed = false;
  for (const fd of main.fds || []) {
    if (fd.status !== 'active' || !fd.maturityDate) continue;
    const left = days(today, fd.maturityDate);
    const stage = left < -30 ? null : left <= 0 ? 'due' : left <= 7 ? '7' : left <= 30 ? '30' : null;
    if (!stage) continue;
    const key = `${fd.id}:${fd.maturityDate}:${stage}`;
    if (notified.has(key)) continue;
    const title = stage === 'due' ? `FD matured: ${fd.institutionName}` : `FD matures in ${left} day${left === 1 ? '' : 's'}`;
    const body = `${fd.institutionName} – ${inr(fd.amount)} (${names[fd.holderId] || ''})\n${stage === 'due' ? 'Renew it or mark it closed.' : `Matures on ${fmt(fd.maturityDate)}.`}`;
    try {
      await self.registration.showNotification(title, { body, tag: key, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { id: fd.id } });
    } catch { return; } // notifications not allowed

    notified.add(key);
    changed = true;
  }
  if (changed) await kv(db, 'readwrite', (s) => s.put([...notified].slice(-500), 'notified'));
}

self.addEventListener('periodicsync', (e) => { if (e.tag === 'fd-maturity') e.waitUntil(checkAndNotify()); });
self.addEventListener('message', (e) => { if (e.data?.type === 'check-alerts') e.waitUntil(checkAndNotify()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data?.id;
  const url = new URL(id ? `./#/fd/${id}` : './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { await w.focus(); return w.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
