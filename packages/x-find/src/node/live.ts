import { gunzipSync } from 'node:zlib';
import { declaredLogoUrls } from '../core/checks/geo.js';
import { makeNormalizer, canonicalHref } from '../core/analyze.js';
import { CRAWLERS } from '../core/crawlers.js';
import { parsePage } from '../core/html/parse.js';
import { isAllowed, parseRobotsTxt } from '../core/robots/parse.js';
import { parseSitemap } from '../core/sitemap/parse.js';
import type {
  CrawlerAccess,
  HttpInfo,
  LiveFacts,
  PageModel,
  ResourceInfo,
  SiteModel,
  TextFile,
} from '../core/types.js';
import { VERSION } from '../core/version.js';

export const X_FIND_UA = `Mozilla/5.0 (compatible; x-find/${VERSION}; +https://github.com/Xbot-me/x-find)`;
/** x-find's own robots.txt token: it obeys rules for "x-find", else the * group. */
const OWN_TOKEN = 'x-find';

export interface LiveOptions {
  maxPages?: number;
  concurrency?: number;
  timeoutMs?: number;
  trailingSlash: 'always' | 'never' | 'ignore';
  /** Skip the per-crawler user-agent requests. */
  skipCrawlerAccess?: boolean;
  /** Called after each fetched page. */
  onProgress?: (done: number, queued: number, url: string) => void;
  fetchImpl?: typeof fetch;
  /** First retry delay for transient failures (tests use a tiny value). */
  retryDelayMs?: number;
}

interface Fetched extends HttpInfo {
  body: Uint8Array | null;
  error?: string;
}

const ASSET_EXT =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|mp4|webm|mov|mp3|wav|woff2?|ttf|otf|css|js|json|xml|txt|glb|gltf|stl|obj|fbx)$/i;
const MAX_BODY = 15 * 1024 * 1024;

function headersOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    out[k.toLowerCase()] = out[k.toLowerCase()] ? `${out[k.toLowerCase()]}, ${v}` : v;
  });
  return out;
}

async function readBody(res: Response, limit = MAX_BODY): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(size, limit));
  let o = 0;
  for (const c of chunks) {
    out.set(c.subarray(0, out.length - o), o);
    o += c.length;
    if (o >= out.length) break;
  }
  return out;
}

export interface FetcherOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  /** Extra attempts after a network error, timeout, 429 or 503 (default 2). */
  retries?: number;
  /** First retry delay; doubles each time unless the server sends Retry-After (default 1000 ms). */
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeFetcher(opts: FetcherOptions) {
  const f = opts.fetchImpl ?? fetch;
  const once = async function (
    url: string,
    init: { ua?: string; follow?: boolean; method?: 'GET' | 'HEAD'; body?: boolean } = {},
  ): Promise<Fetched> {
    const redirects: { url: string; status: number }[] = [];
    let current = new URL(url).href; // normalised: https://site.com → https://site.com/
    for (let hop = 0; hop <= 10; hop++) {
      let res: Response;
      try {
        res = await f(current, {
          method: init.method ?? 'GET',
          redirect: 'manual',
          headers: {
            'user-agent': init.ua ?? X_FIND_UA,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (e) {
        const err = e as Error & { cause?: { code?: string } };
        return {
          status: 0,
          headers: {},
          redirects,
          finalUrl: current,
          body: null,
          error: err.cause?.code ?? err.message,
        };
      }
      const headers = headersOf(res);
      const location = headers['location'];
      if (res.status >= 300 && res.status < 400 && location && init.follow !== false) {
        redirects.push({ url: current, status: res.status });
        await res.body?.cancel();
        current = new URL(location, current).href;
        continue;
      }
      let body: Uint8Array | null;
      try {
        body = init.body === false || init.method === 'HEAD' ? (await res.body?.cancel(), null) : await readBody(res);
      } catch (e) {
        // A body that stalls past the timeout is a failed request for this URL, not a failed run.
        const err = e as Error;
        const why = err.name === 'TimeoutError' ? 'timed out' : err.message;
        return {
          status: 0,
          headers,
          redirects,
          finalUrl: current,
          body: null,
          error: `${why} while reading the response`,
        };
      }
      return { status: res.status, headers, redirects, finalUrl: current, body };
    }
    return { status: 0, headers: {}, redirects, finalUrl: current, body: null, error: 'too many redirects' };
  };
  /** Retries transient failures, so a network hiccup or a brief rate limit isn't reported as a broken site. */
  return async function get(url: string, init: Parameters<typeof once>[1] = {}): Promise<Fetched> {
    const retries = opts.retries ?? 2;
    const base = opts.retryDelayMs ?? 1000;
    let r = await once(url, init);
    for (let attempt = 1; attempt <= retries && (r.status === 0 || r.status === 429 || r.status === 503); attempt++) {
      const retryAfter = Number(r.headers['retry-after']);
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : base * 2 ** (attempt - 1),
      );
      r = await once(url, init);
    }
    return r;
  };
}

const decoder = new TextDecoder('utf-8');

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(gunzipSync(data));
}

function isChallenge(f: Fetched): boolean {
  if (f.headers['cf-mitigated'] === 'challenge') return true;
  if (!f.body) return false;
  const text = decoder.decode(f.body.slice(0, 20_000));
  return /<title>\s*Just a moment\.\.\.\s*<\/title>|cf-chl-|challenge-platform|_Incapsula_Resource|px-captcha|DataDome/i.test(
    text,
  );
}

export async function crawlLive(start: string, opts: LiveOptions): Promise<SiteModel> {
  const maxPages = opts.maxPages ?? 500;
  const concurrency = opts.concurrency ?? 4;
  const get = makeFetcher({
    timeoutMs: opts.timeoutMs ?? 15_000,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.retryDelayMs !== undefined ? { retryDelayMs: opts.retryDelayMs } : {}),
  });
  const norm = makeNormalizer(opts.trailingSlash);

  // The origin is wherever the start URL ends up (http → https, apex → www, etc.).
  const first = await get(start);
  if (first.status === 0) throw new Error(`Could not reach ${start}: ${first.error}`);
  const origin = new URL(first.finalUrl).origin;
  const home = `${origin}/`;

  const textFile = async (url: string): Promise<TextFile> => {
    const r = await get(url);
    let data = r.body ?? new Uint8Array();
    if (url.endsWith('.gz') && data.length && r.status < 400) data = await gunzip(data).catch(() => data);
    const ok = r.status >= 200 && r.status < 300;
    return { url, status: r.status, body: ok ? decoder.decode(data) : null, bytes: data.length };
  };

  const robotsTxt = await textFile(`${origin}/robots.txt`);
  const robots = robotsTxt.body != null ? parseRobotsTxt(robotsTxt.body) : null;
  const llmsTxt = await textFile(`${origin}/llms.txt`);

  const sitemapQueue: string[] = robots?.sitemaps.map((s) => s.url).filter((u) => /^https?:\/\//i.test(u)) ?? [];
  if (!sitemapQueue.length) {
    for (const name of ['/sitemap-index.xml', '/sitemap_index.xml', '/sitemap.xml']) {
      const probe = await get(origin + name, { method: 'HEAD' });
      if (probe.status >= 200 && probe.status < 300) {
        sitemapQueue.push(origin + name);
        break;
      }
    }
  }
  const sitemaps: TextFile[] = [];
  const sitemapPages: string[] = [];
  const seenSitemaps = new Set<string>();
  while (sitemapQueue.length && seenSitemaps.size < 200) {
    const url = sitemapQueue.shift()!;
    if (seenSitemaps.has(url)) continue;
    seenSitemaps.add(url);
    const file = await textFile(url);
    sitemaps.push(file);
    if (file.body == null) continue;
    const parsed = parseSitemap(file.body);
    if (parsed.kind === 'sitemapindex') sitemapQueue.push(...parsed.entries.map((e) => e.loc));
    else sitemapPages.push(...parsed.entries.map((e) => e.loc));
  }

  // Crawl: home first, then sitemap URLs, then links found on pages.
  const pages: PageModel[] = [];
  const failedPages = new Map<string, HttpInfo>();
  const resources = new Map<string, ResourceInfo>();
  const queued = new Set<string>();
  const queue: string[] = [];
  const enqueue = (url: string) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    u.hash = '';
    if (u.origin !== origin) return;
    const key = norm(u.href);
    if (queued.has(key)) return;
    if (ASSET_EXT.test(u.pathname)) return;
    if (!isAllowed(robots, OWN_TOKEN, u.href)) return;
    queued.add(key);
    queue.push(u.href);
  };
  enqueue(home);
  sitemapPages.forEach(enqueue);

  const assetLinks = new Set<string>();
  let done = 0;
  const handle = async (url: string) => {
    // The home page was already fetched to find the origin; reuse it (its redirects belong to the start URL).
    const r = url === home && norm(first.finalUrl) === norm(home) ? { ...first, redirects: [] } : await get(url);
    const http: HttpInfo = { status: r.status, headers: r.headers, redirects: r.redirects, finalUrl: r.finalUrl };
    if (r.redirects.length) failedPages.set(norm(url), { ...http, status: r.redirects[0]!.status });
    const type = r.headers['content-type'] ?? '';
    if (r.status >= 200 && r.status < 300 && /html/i.test(type) && r.body) {
      if (new URL(r.finalUrl).origin !== origin) return;
      const finalKey = norm(r.finalUrl);
      if (r.redirects.length && pages.some((p) => norm(p.url) === finalKey)) return;
      queued.add(finalKey);
      const page = parsePage({ url: r.finalUrl, source: url, html: decoder.decode(r.body), http });
      pages.push(page);
      for (const a of page.anchors) {
        if (!a.url) continue;
        if (ASSET_EXT.test(new URL(a.url).pathname)) {
          if (new URL(a.url).origin === origin) assetLinks.add(a.url);
        } else enqueue(a.url);
      }
      const canonical = canonicalHref(page);
      if (canonical) enqueue(canonical);
    } else if (r.status >= 300 || r.status === 0) {
      if (!r.redirects.length || r.status >= 400 || r.status === 0)
        failedPages.set(norm(r.redirects.length ? r.finalUrl : url), http);
    } else {
      resources.set(norm(url), { url, exists: true, status: r.status });
    }
    done++;
    opts.onProgress?.(done, queue.length, url);
  };

  let inFlight = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (pages.length + failedPages.size + inFlight < maxPages) {
      const url = queue.shift();
      if (!url) {
        if (inFlight === 0) break;
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      inFlight++;
      try {
        await handle(url);
      } finally {
        inFlight--;
      }
    }
  });
  await Promise.all(workers);

  // Internal file links (PDFs, images linked from pages): HEAD them so broken ones are reported.
  for (const url of [...assetLinks].slice(0, 200)) {
    const r = await get(url, { method: 'HEAD' });
    const ok = r.status >= 200 && r.status < 400;
    resources.set(norm(url), { url, exists: ok, status: r.status });
  }
  // Organization logos, for the size check.
  for (const logo of declaredLogoUrls(pages).slice(0, 5)) {
    const r = await get(logo);
    resources.set(norm(logo), {
      url: logo,
      exists: r.status >= 200 && r.status < 300,
      status: r.status,
      ...(r.body ? { data: r.body } : {}),
    });
  }

  const live: LiveFacts = { hostVariants: [], crawlerAccess: [] };
  const missing = `${origin}/x-find-404-check-${Math.random().toString(36).slice(2, 10)}`;
  const m = await get(missing, { body: false });
  live.soft404 = { url: missing, status: m.status };

  const host = new URL(origin).hostname;
  const twinHost = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  const variants = [`https://${twinHost}/`];
  if (origin.startsWith('https://')) variants.unshift(`http://${host}/`);
  for (const v of variants) {
    const r = await get(v, { follow: false, body: false });
    live.hostVariants.push({
      url: v,
      status: r.status === 0 ? null : r.status,
      location: r.headers['location'] ?? null,
    });
  }

  // Deterministic pick (shortest, then alphabetical), so the finding keeps the same fingerprint run to run.
  const sample = [...pages]
    .filter((p) => new URL(p.url).pathname.length > 1 && !p.http?.redirects.length)
    .sort((a, b) => a.url.length - b.url.length || a.url.localeCompare(b.url))[0];
  if (sample) {
    const u = new URL(sample.url);
    const twin = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : `${u.pathname}/`;
    const r = await get(origin + twin + u.search, { follow: false, body: false });
    live.trailingSlash = {
      url: sample.url,
      twin: origin + twin + u.search,
      status: sample.http?.status ?? 200,
      twinStatus: r.status,
    };
  }

  if (!opts.skipCrawlerAccess) {
    const results: CrawlerAccess[] = [];
    for (const c of CRAWLERS) {
      if (!c.userAgent) continue;
      for (const url of [home, `${origin}/robots.txt`]) {
        const r = await get(url, { ua: c.userAgent });
        results.push({
          crawlerId: c.id,
          userAgent: c.userAgent,
          url,
          status: r.status === 0 ? null : r.status,
          challenge: isChallenge(r),
          ...(r.error ? { error: r.error } : {}),
        });
      }
    }
    live.crawlerAccess = results;
  }

  return { mode: 'live', origin, pages, robotsTxt, llmsTxt, sitemaps, resources, failedPages, live };
}
