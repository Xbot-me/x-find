import type { CheckContext } from '../types.js';

export type UrlState = 'ok' | 'redirect' | 'error' | 'missing' | 'unknown';

/** What we know about an internal URL from the pages, failed fetches and files collected before checks ran. */
export function urlState(ctx: CheckContext, url: string): { state: UrlState; status?: number } {
  const { index, site } = ctx;
  let key = index.norm(url);
  // A static file is served whatever the query string, so in folder mode /work/?tab=x is /work/.
  if (site.mode === 'folder' && key.includes('?')) key = index.norm(key.split('?')[0]!);
  const failed = site.failedPages.get(key);
  if (failed) {
    // 0 = no answer (timeout, network error): unknown, not broken. http-status reports it separately.
    if (failed.status === 0) return { state: 'unknown', status: 0 };
    if (failed.status >= 300 && failed.status < 400) return { state: 'redirect', status: failed.status };
    return { state: 'error', status: failed.status };
  }
  const page = index.pageByUrl.get(key);
  if (page) return { state: 'ok', status: page.http?.status ?? 200 };
  const res = site.resources.get(key);
  if (res) {
    if (!res.exists)
      return { state: site.mode === 'folder' ? 'missing' : 'error', ...(res.status ? { status: res.status } : {}) };
    return { state: 'ok', ...(res.status ? { status: res.status } : {}) };
  }
  return { state: site.mode === 'folder' ? 'missing' : 'unknown' };
}

export function isInternal(ctx: CheckContext, url: string): boolean {
  try {
    return new URL(url).origin === ctx.site.origin;
  } catch {
    return false;
  }
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Groups pages by a key and returns the groups with more than one member. */
export function duplicates<T>(items: T[], key: (t: T) => string | null): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

/** FNV-1a 32-bit, hex. Stable across runs and platforms. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Word 5-gram shingles, hashed, for near-duplicate detection. */
export function shingles(text: string, size = 5): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(hash(words.slice(i, i + size).join(' ')));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
