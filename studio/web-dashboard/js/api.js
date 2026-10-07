// Read-only API client for the dashboard backend.

export class ApiError extends Error {
  constructor(status, code, message) { super(message || code || `HTTP ${status}`); this.status = status; this.code = code; }
}

export async function api(path, params) {
  let url = `/api/${path}`;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    const qs = q.toString();
    if (qs) url += `?${qs}`;
  }
  let res;
  try { res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' }); } catch (e) { throw new ApiError(0, 'network', 'Dashboard server is not reachable'); }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, body?.error, body?.message || body?.error);
  return body;
}

export const fileUrl = (p) => `/api/file?path=${encodeURIComponent(p)}`;

// Small cache for project files (textures, model sources, decoded audio).
// Cleared whenever the studio reports a change, so new versions show up.
const cache = new Map();
export function clearFileCache() { cache.clear(); }

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

export function fetchFileJson(p) {
  return cached(`json:${p}`, async () => {
    const res = await fetch(fileUrl(p), { cache: 'no-store' });
    if (!res.ok) throw new ApiError(res.status, 'file', `Cannot load ${p} (${res.status})`);
    return res.json();
  });
}

export function fetchFileText(p) {
  return cached(`text:${p}`, async () => {
    const res = await fetch(fileUrl(p), { cache: 'no-store' });
    if (!res.ok) throw new ApiError(res.status, 'file', `Cannot load ${p} (${res.status})`);
    return res.text();
  });
}

export function fetchFileBuffer(p) {
  return cached(`buf:${p}`, async () => {
    const res = await fetch(fileUrl(p), { cache: 'no-store' });
    if (!res.ok) throw new ApiError(res.status, 'file', `Cannot load ${p} (${res.status})`);
    return res.arrayBuffer();
  });
}

/** Load a project PNG and return {img, width, height, data: Uint8ClampedArray}. */
export function loadImageData(p) {
  return cached(`img:${p}`, () => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      resolve({ img, width: c.width, height: c.height, data: d.data });
    };
    img.onerror = () => reject(new ApiError(404, 'image', `Cannot load image ${p}`));
    img.src = fileUrl(p);
  }));
}

let decodeCtx = null;
/** Decode audio with an OfflineAudioContext (no autoplay warnings before a user gesture). */
export function decodeAudio(p) {
  return cached(`audio:${p}`, async () => {
    const buf = await fetchFileBuffer(p);
    decodeCtx ||= new OfflineAudioContext(2, 1, 48000);
    return decodeCtx.decodeAudioData(buf.slice(0));
  });
}
