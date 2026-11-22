// Password-protected backup files (.fdbackup). Works in the browser and in Node 20+.
// Format: "FDBK2" | salt(16) | iv(12) | AES-256-GCM( gzip( JSON ) )   key = PBKDF2-SHA256(password, salt, 250k)
const MAGIC = 'FDBK2';
const ITER = 250000;
const enc = new TextEncoder();

async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const streamBytes = async (bytes, transform) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());

export async function encryptBackup(obj, password) {
  if (!password || password.length < 6) throw new Error('Backup password must be at least 6 characters');
  const plain = await streamBytes(enc.encode(JSON.stringify(obj)), new CompressionStream('gzip'));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt), plain));
  const out = new Uint8Array(5 + 16 + 12 + ct.length);
  out.set(enc.encode(MAGIC), 0);
  out.set(salt, 5);
  out.set(iv, 21);
  out.set(ct, 33);
  return out;
}

export async function decryptBackup(bytes, password) {
  bytes = new Uint8Array(bytes);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== MAGIC) throw new Error('This is not an FD Tracker backup file');
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(21, 33) }, await keyFrom(password || '', bytes.subarray(5, 21)), bytes.subarray(33));
  } catch {
    throw new Error('Wrong backup password');
  }
  const json = new TextDecoder().decode(await streamBytes(new Uint8Array(plain), new DecompressionStream('gzip')));
  const data = JSON.parse(json);
  if (!Array.isArray(data?.db?.fds) || !Array.isArray(data?.db?.people)) throw new Error('Backup file is damaged');
  return data;
}

export const toBase64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
