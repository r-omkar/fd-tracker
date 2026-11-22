// All data lives on this phone, in the browser's IndexedDB. Nothing is sent anywhere.
//   kv store:     'main' -> { people, fds, settings, auth, meta },  'notified' -> [...]
//   photos store: '<hex>.jpg' -> Blob
import {
  isISO, parseAmount, parseRate, INSTITUTION_TYPES, PAYOUTS, COMPOUNDING, MODES, STATUSES,
} from './calc.js';
import { encryptBackup, decryptBackup, toBase64, fromBase64 } from './backup.js';

const DB_NAME = 'fd-tracker';
let idbPromise;
function idb() {
  idbPromise ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('photos');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error('This browser could not open its storage. Is it in private / incognito mode?'));
  });
  return idbPromise;
}
async function req(store, mode, fn) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error || new Error('Storage error'));
    t.onabort = () => reject(t.error || new Error('Storage full or blocked'));
  });
}
const kvGet = (k) => req('kv', 'readonly', (s) => s.get(k));
const kvPut = (k, v) => req('kv', 'readwrite', (s) => s.put(v, k));

const fresh = () => ({
  version: 2,
  people: [],
  fds: [],
  settings: { lockMinutes: 15, alerts: false },
  auth: { pinHash: null, pinSalt: null, credId: null },
  meta: { createdAt: new Date().toISOString(), changedAt: null, lastBackupAt: null },
});

export let data = fresh();

export async function load() {
  const saved = await kvGet('main');
  if (saved) {
    const f = fresh();
    data = { ...f, ...saved, settings: { ...f.settings, ...saved.settings }, auth: { ...f.auth, ...saved.auth }, meta: { ...f.meta, ...saved.meta } };
  }
  return data;
}

async function commit() {
  data.meta.changedAt = new Date().toISOString();
  await kvPut('main', structuredClone(data));
  askPersistence();
}

// Ask the browser not to clear our storage when the phone runs low on space.
let askedPersist = false;
export async function askPersistence() {
  if (askedPersist || !navigator.storage?.persist) return;
  askedPersist = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}
export const isPersisted = async () => { try { return await navigator.storage?.persisted?.(); } catch { return false; } };

const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
const fail = (msg) => { throw new Error(msg); };

// ---------- PIN & fingerprint ----------
async function hashPin(pin, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const hasPin = () => !!data.auth.pinHash;
export async function setPin(pin) {
  if (!/^\d{4,8}$/.test(String(pin || ''))) fail('PIN must be 4 to 8 digits');
  data.auth.pinSalt = newId() + newId();
  data.auth.pinHash = await hashPin(pin, data.auth.pinSalt);
  await commit();
}
const LOCK_KEY = 'fd.pinfail';
export async function checkPin(pin) {
  let f = { n: 0, until: 0 };
  try { f = JSON.parse(localStorage.getItem(LOCK_KEY)) || f; } catch {}
  if (Date.now() < f.until) fail(`Too many wrong tries. Please wait ${Math.ceil((f.until - Date.now()) / 1000)} seconds.`);
  const ok = (await hashPin(pin, data.auth.pinSalt)) === data.auth.pinHash;
  if (!ok) {
    f.n++;
    if (f.n >= 5) f.until = Date.now() + 30000 * 2 ** Math.min(f.n - 5, 6);
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(f)); } catch {}
    fail('Wrong PIN');
  }
  try { localStorage.removeItem(LOCK_KEY); } catch {}
}

// Fingerprint / face unlock uses the phone's own screen lock (WebAuthn). Optional; PIN always works.
export const fingerprintAvailable = async () => {
  try { return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; }
};
export const fingerprintOn = () => !!data.auth.credId;
export async function enableFingerprint() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'FD Tracker' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'FD Tracker', displayName: 'FD Tracker' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  data.auth.credId = toBase64(new Uint8Array(cred.rawId));
  await commit();
}
export async function disableFingerprint() { data.auth.credId = null; await commit(); }
export async function fingerprintUnlock() {
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: fromBase64(data.auth.credId) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
}

// ---------- settings ----------
export async function updateSettings(patch) {
  if ([5, 15, 30, 60, 240].includes(Number(patch.lockMinutes))) data.settings.lockMinutes = Number(patch.lockMinutes);
  if (typeof patch.alerts === 'boolean') data.settings.alerts = patch.alerts;
  await commit();
  return data.settings;
}

// ---------- people ----------
const cleanName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) || fail('Name is required');
export async function addPerson(name) {
  const p = { id: newId(), name: cleanName(name), relation: '' };
  data.people.push(p);
  await commit();
  return p;
}
export async function renamePerson(id, name) {
  const p = data.people.find((x) => x.id === id) || fail('Not found');
  p.name = cleanName(name);
  await commit();
}
export async function deletePerson(id) {
  if (data.fds.some((f) => f.holderId === id || f.jointHolderIds.includes(id))) fail('This person has FDs. Move or delete those FDs first.');
  data.people = data.people.filter((p) => p.id !== id);
  await commit();
}

// ---------- FDs ----------
const str = (v, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const num = (v) => (v === '' || v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const isPhotoName = (n) => typeof n === 'string' && /^[a-f0-9]{24}\.(jpg|png|webp)$/.test(n);

function cleanFd(input) {
  const errors = [];
  const ids = new Set(data.people.map((p) => p.id));
  const fd = {
    holderId: str(input.holderId, 40),
    jointHolderIds: Array.isArray(input.jointHolderIds) ? input.jointHolderIds.filter((id) => ids.has(id) && id !== input.holderId) : [],
    mode: pick(input.mode, MODES, 'Single'),
    institutionName: str(input.institutionName, 120),
    institutionType: pick(input.institutionType, INSTITUTION_TYPES.map((t) => t.id), 'other'),
    branch: str(input.branch, 80),
    fdNumber: str(input.fdNumber, 60),
    amount: parseAmount(input.amount),
    rate: parseRate(input.rate),
    startDate: isISO(input.startDate) ? input.startDate : null,
    maturityDate: isISO(input.maturityDate) ? input.maturityDate : null,
    interestPayout: pick(input.interestPayout, PAYOUTS.map((p) => p.id), 'cumulative'),
    compounding: pick(input.compounding, COMPOUNDING.map((c) => c.id), 'quarterly'),
    maturityAmount: num(input.maturityAmount),
    autoRenew: !!input.autoRenew,
    hasNominee: !!input.hasNominee,
    nominees: Array.isArray(input.nominees)
      ? input.nominees.map((n) => ({ name: str(n.name, 80), relation: str(n.relation, 40), share: num(n.share) })).filter((n) => n.name).slice(0, 6)
      : [],
    status: pick(input.status, STATUSES.map((s) => s.id), 'active'),
    closedOn: isISO(input.closedOn) ? input.closedOn : null,
    notes: str(input.notes, 2000),
    photos: Array.isArray(input.photos) ? input.photos.filter(isPhotoName).slice(0, 10) : [],
  };
  if (!ids.has(fd.holderId)) errors.push('Choose whose name the FD is in');
  if (!fd.institutionName) errors.push('Bank / institution name is required');
  if (!fd.amount) errors.push('Amount is required');
  if (fd.rate === null) errors.push('Interest rate is required');
  if (!fd.startDate) errors.push('Start date is required');
  if (!fd.maturityDate) errors.push('Maturity date is required');
  if (fd.startDate && fd.maturityDate && fd.maturityDate <= fd.startDate) errors.push('Maturity date must be after start date');
  if (!fd.hasNominee) fd.nominees = [];
  if (!fd.jointHolderIds.length) fd.mode = 'Single';
  else if (fd.mode === 'Single') fd.mode = 'Either or Survivor';
  if (errors.length) fail(errors.join('. '));
  return fd;
}
const stamp = (fd, extra = {}) => ({ ...fd, ...extra, updatedAt: new Date().toISOString() });
const born = (source) => ({ id: newId(), createdAt: new Date().toISOString(), renewedFromId: null, renewedToId: null, source });

export async function createFd(input) {
  const fd = stamp(cleanFd(input), born(['excel', 'manual'].includes(input.source) ? input.source : 'manual'));
  data.fds.push(fd);
  await commit();
  return fd;
}

// Drafts may refer to people not yet created as "new:<name>".
export async function createMany(drafts, newPeople) {
  const people = [...data.people];
  const created = {};
  for (const name of newPeople) {
    const existing = people.find((p) => p.name.toLowerCase() === String(name).trim().toLowerCase());
    created[name] = existing || { id: newId(), name: cleanName(name), relation: '' };
    if (!existing) data.people.push(created[name]);
  }
  const resolve = (id) => (typeof id === 'string' && id.startsWith('new:') ? created[id.slice(4)]?.id : id);
  const out = [];
  const errors = [];
  drafts.forEach((d, i) => {
    try {
      out.push(stamp(cleanFd({ ...d, holderId: resolve(d.holderId), jointHolderIds: (d.jointHolderIds || []).map(resolve) }), born('excel')));
    } catch (e) {
      errors.push(`FD ${i + 1}: ${e.message}`);
    }
  });
  if (errors.length) {
    data.people = people;
    fail(errors.join('\n'));
  }
  data.fds.push(...out);
  await commit();
  return out.length;
}

export async function updateFd(id, input) {
  const i = data.fds.findIndex((f) => f.id === id);
  if (i < 0) fail('FD not found');
  const old = data.fds[i];
  const fd = stamp(cleanFd(input), { id, createdAt: old.createdAt, renewedFromId: old.renewedFromId, renewedToId: old.renewedToId, source: old.source });
  if (old.renewedToId && fd.status === 'active') fd.status = 'renewed';
  data.fds[i] = fd;
  await commit();
  return fd;
}

export async function renewFd(id, input) {
  const old = data.fds.find((f) => f.id === id) || fail('FD not found');
  if (old.renewedToId) fail('This FD was already renewed');
  const fd = stamp(cleanFd(input), { ...born('manual'), renewedFromId: old.id });
  old.status = 'renewed';
  old.renewedToId = fd.id;
  old.closedOn = fd.startDate;
  data.fds.push(fd);
  await commit();
  return fd;
}

export async function deleteFd(id) {
  data.fds.find((f) => f.id === id) || fail('FD not found');
  for (const f of data.fds) {
    if (f.renewedToId === id) { f.renewedToId = null; if (f.status === 'renewed') f.status = 'closed'; }
    if (f.renewedFromId === id) f.renewedFromId = null;
  }
  data.fds = data.fds.filter((f) => f.id !== id);
  await commit();
}

// ---------- photos ----------
const urls = new Map();
export async function savePhoto(blob) {
  const name = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('') + '.jpg';
  await req('photos', 'readwrite', (s) => s.put(blob, name));
  return name;
}
export async function photoUrl(name) {
  if (urls.has(name)) return urls.get(name);
  const blob = await req('photos', 'readonly', (s) => s.get(name));
  if (!blob) return '';
  const u = URL.createObjectURL(blob);
  urls.set(name, u);
  return u;
}

// ---------- backup / restore ----------
export async function makeBackup(password) {
  const photos = {};
  for (const n of new Set(data.fds.flatMap((f) => f.photos))) {
    const blob = await req('photos', 'readonly', (s) => s.get(n));
    if (blob) photos[n] = toBase64(new Uint8Array(await blob.arrayBuffer()));
  }
  const { auth, ...rest } = data;
  const bytes = await encryptBackup({ createdAt: new Date().toISOString(), db: rest, photos }, password);
  data.meta.lastBackupAt = new Date().toISOString();
  await kvPut('main', structuredClone(data));
  return bytes;
}

export async function restoreBackup(bytes, password) {
  const b = await decryptBackup(bytes, password);
  for (const [n, b64] of Object.entries(b.photos || {})) {
    if (isPhotoName(n)) await req('photos', 'readwrite', (s) => s.put(new Blob([fromBase64(b64)], { type: 'image/jpeg' }), n));
  }
  const f = fresh();
  data = { ...f, ...b.db, auth: data.auth, settings: { ...data.settings, ...b.db.settings, alerts: data.settings.alerts }, meta: { ...f.meta, ...b.db.meta, lastBackupAt: new Date().toISOString() } };
  data.fds = data.fds.map((x) => ({ photos: [], nominees: [], jointHolderIds: [], ...x }));
  await commit();
  return { fds: data.fds.length, people: data.people.length };
}

export async function wipeAll() {
  await req('photos', 'readwrite', (s) => s.clear());
  await req('kv', 'readwrite', (s) => s.clear());
  data = fresh();
}
