// Maturity alerts as phone notifications. The service worker (sw.js) does the actual check, so it can
// also run in the background on Android when the app is installed (Periodic Background Sync).
import * as db from './db.js';

export const alertsSupported = () => 'Notification' in window && 'serviceWorker' in navigator && window.isSecureContext;

async function reg() {
  return navigator.serviceWorker.ready;
}
// Some browsers never settle these calls; don't let that block the screen.
const within = (promise, ms = 3000) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function permission() {
  try {
    const st = (await within(navigator.permissions.query({ name: 'notifications' }))).state;
    return st === 'prompt' ? 'default' : st;
  } catch {
    return Notification.permission;
  }
}

export async function alertStatus() {
  if (!alertsSupported()) return { supported: false };
  const r = await reg();
  let background = false;
  if ('periodicSync' in r) {
    try { background = (await within(r.periodicSync.getTags())).includes('fd-maturity'); } catch {}
  }
  const perm = await permission();
  return { supported: true, permission: perm, on: db.data.settings.alerts && perm === 'granted', background };
}

export async function enableAlerts() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in the phone Settings → Apps → Chrome → Notifications.');
  const r = await reg();
  if ('periodicSync' in r) {
    try {
      const st = await within(navigator.permissions.query({ name: 'periodic-background-sync' }));
      if (st.state === 'granted') await within(r.periodicSync.register('fd-maturity', { minInterval: 12 * 60 * 60 * 1000 }));
    } catch {}
  }
  await db.updateSettings({ alerts: true });
  await checkMaturityAlerts();
}

export async function disableAlerts() {
  const r = await reg();
  try { if (r.periodicSync) await within(r.periodicSync.unregister('fd-maturity')); } catch {}
  await db.updateSettings({ alerts: false });
}

export async function checkMaturityAlerts() {
  if (!db.data.settings.alerts || !alertsSupported() || (await permission()) !== 'granted') return;
  const r = await reg();
  r.active?.postMessage({ type: 'check-alerts' });
}

export async function testAlert() {
  const r = await reg();
  await r.showNotification('FD Tracker', { body: 'Alerts are working. You will be told 30 days and 7 days before an FD matures.', icon: 'icons/icon-192.png', tag: 'fd-test' });
}
