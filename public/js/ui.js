// Small UI toolkit: escaping, icons, toasts, dialogs, files, shared state.
import * as db from './db.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  list: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h10M7 17h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  rupee: '<path d="M7 5h10M7 9h10M7 5c6 0 6 8 0 8h-1l7 7"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  text: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M17 14.5c2.4 0 4 1.6 4.8 4.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
  finger: '<path d="M12 11v3a6 6 0 0 1-1.5 4"/><path d="M8.5 6.8A5 5 0 0 1 17 10.5v2"/><path d="M7 10.5v1.5a8 8 0 0 1-1 3.8"/><path d="M15 14a9 9 0 0 1-1.5 5"/><path d="M5 7.5A8 8 0 0 1 19 8"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="${cls}" width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// ---------- shared state (a view of db.data) ----------
export const state = { people: [], fds: [], settings: {}, meta: {}, loaded: false };
export const person = (id) => state.people.find((p) => p.id === id);
export const personName = (id) => person(id)?.name || 'Unknown';
export async function reload() {
  Object.assign(state, { people: db.data.people, fds: db.data.fds, settings: db.data.settings, meta: db.data.meta, loaded: true });
}

// ---------- feedback ----------
let toastTimer;
export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

export function dialog({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false, input = null }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `
      <h2>${esc(title)}</h2>
      ${body ? `<p class="ink2" style="margin-top:.6rem">${body}</p>` : ''}
      ${input ? `<div class="field" style="margin-top:1rem"><label for="dlg-in">${esc(input.label)}</label><input id="dlg-in" class="input" type="${input.type || 'text'}" autocomplete="off" value="${esc(input.value || '')}" ${input.inputmode ? `inputmode="${input.inputmode}"` : ''}></div>` : ''}
      <div class="actions">
        <button class="btn ${danger ? 'danger' : 'primary'} block" data-ok>${esc(ok)}</button>
        ${cancel ? `<button class="btn quiet block" data-cancel>${esc(cancel)}</button>` : ''}
      </div>`;
    document.body.append(d);
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelector('[data-ok]').onclick = () => done(input ? d.querySelector('#dlg-in').value : true);
    d.querySelector('[data-cancel]')?.addEventListener('click', () => done(input ? null : false));
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(input ? null : false); });
    d.showModal();
    d.querySelector(input ? '#dlg-in' : '[data-ok]').focus();
  });
}
export const confirmBox = (title, body, ok = 'Yes', danger = false) => dialog({ title, body, ok, danger });
export const alertBox = (title, body) => dialog({ title, body, cancel: null });

// ---------- photos (stored on the phone; <img data-photo="name"> is filled in automatically) ----------
new MutationObserver(() => {
  document.querySelectorAll('img[data-photo]:not([src])').forEach(async (img) => {
    img.src = (await db.photoUrl(img.dataset.photo)) || 'data:,';
  });
}).observe(document.documentElement, { childList: true, subtree: true });

export async function viewImage(name) {
  const el = document.createElement('div');
  el.className = 'img-view';
  el.innerHTML = `<img src="${esc(await db.photoUrl(name))}" alt="Photo"><button class="btn small">${icon('x')} Close</button>`;
  el.onclick = () => el.remove();
  document.body.append(el);
}

// ---------- files ----------
export function pickFile(accept, { capture = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    if (capture) inp.capture = 'environment';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

// Shrink phone photos (often 5–12 MB) so they don't fill up storage.
export async function shrinkImage(file, maxSide = 1600, quality = 0.82) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not open this image. Please use a JPG or PNG photo.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
}
export const addPhoto = async (file) => db.savePhoto(await shrinkImage(file));

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// On phones, offer the share sheet (WhatsApp, Drive, Email…); otherwise download.
export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export const go = (hash) => { location.hash = hash; };
export const today = () => new Date().toISOString().slice(0, 10);
