import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import { runChecks } from '../src/core/run.js';
import { crawlLive } from '../src/node/live.js';

const O = 'https://shop.test';
const html = (title: string, body: string, canonical: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><meta name="description" content="${title} page"><link rel="canonical" href="${canonical}"></head><body><h1>${title}</h1>${body}</body></html>`;

/** A fake site: each route returns [status, headers, body]. */
function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const ua = new Headers(init?.headers).get('user-agent') ?? '';
    const send = (status: number, body: string | null, headers: Record<string, string> = {}) =>
      new Response(status === 204 || status === 304 || (status >= 300 && status < 400) ? null : body, {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
      });
    if (url.hostname === 'www.shop.test')
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (url.protocol === 'http:') return send(301, null, { location: `${O}${url.pathname}` });
    if (/PerplexityBot/.test(ua)) return send(403, 'Forbidden');
    if (/GPTBot/.test(ua)) return send(503, '<html><head><title>Just a moment...</title></head></html>');
    switch (url.pathname) {
      case '/':
        return send(
          200,
          html(
            'Home',
            '<a href="/a/">A page</a> <a href="/old">Old link</a> <a href="/gone/">Gone</a> <a href="/files/spec.pdf">Spec</a>',
            `${O}/`,
          ),
        );
      case '/a/':
        return send(200, html('A', '<a href="/">Home</a>', `${O}/a/`), { link: `<${O}/b/>; rel="canonical"` });
      case '/a':
        return send(307, null, { location: '/a/' });
      case '/old':
        return send(302, null, { location: '/a/' });
      case '/gone/':
        return send(404, 'Not found');
      case '/files/spec.pdf':
        return send(404, '');
      case '/robots.txt':
        return send(200, `User-agent: *\nAllow: /\nSitemap: ${O}/sitemap.xml\n`, { 'content-type': 'text/plain' });
      case '/sitemap.xml':
        return send(
          200,
          `<urlset><url><loc>${O}/</loc></url><url><loc>${O}/a/</loc></url><url><loc>${O}/gone/</loc></url></urlset>`,
          { 'content-type': 'application/xml' },
        );
      default:
        // Soft 404: every unknown path answers 200.
        return send(200, html('Welcome', '<p>Nothing here</p>', `${O}/`));
    }
  }) as typeof fetch;
}

describe('live mode (mocked network)', async () => {
  const site = await crawlLive(`${O}/`, {
    trailingSlash: 'always',
    fetchImpl: fakeFetch(),
    concurrency: 2,
    retryDelayMs: 1,
  });
  const report = runChecks(site, resolveConfig({ site: O, trailingSlash: 'always' }));
  const ids = (sev?: string) => report.findings.filter((f) => !sev || f.severity === sev).map((f) => f.checkId);

  it('crawls only same-origin HTML pages', () => {
    expect(site.pages.map((p) => new URL(p.url).pathname).sort()).toEqual(['/', '/a/']);
  });
  it('reports pages that fail and sitemap URLs that do not load', () => {
    expect(report.findings.find((f) => f.checkId === 'http-status' && f.url?.endsWith('/gone/'))).toBeTruthy();
    expect(
      report.findings.find((f) => f.checkId === 'sitemap-url-not-found' && f.url?.endsWith('/gone/')),
    ).toBeTruthy();
    expect(
      report.findings.find((f) => f.checkId === 'link-broken-internal' && f.evidence?.startsWith('/files/spec.pdf')),
    ).toBeTruthy();
  });
  it('reports temporary redirects, soft 404s and the trailing-slash 307', () => {
    expect(ids()).toContain('redirect-chain');
    expect(ids('error')).toContain('soft-404');
    expect(report.findings.find((f) => f.checkId === 'trailing-slash-duplicate')?.message).toMatch(
      /temporary HTTP 307/,
    );
  });
  it('compares the Link header canonical with the HTML one', () => {
    expect(report.findings.find((f) => f.checkId === 'canonical-header-mismatch')?.url).toBe(`${O}/a/`);
  });
  it('treats a missing www host as nothing to fix and accepts a 301 from http', () => {
    expect(ids()).not.toContain('host-redirect');
  });
  it('reports crawler blocks by user agent: search bots as errors, training bots as notices', () => {
    const blocked = report.findings.filter((f) => f.checkId === 'crawler-ua-blocked');
    expect(blocked.find((f) => f.message.startsWith('PerplexityBot'))?.severity).toBe('error');
    expect(blocked.find((f) => f.message.startsWith('GPTBot'))?.severity).toBe('notice');
    expect(blocked.find((f) => f.message.startsWith('GPTBot'))?.message).toMatch(/challenge/);
  });
});

describe('live mode: slow responses', () => {
  it('treats a response body that stalls past the timeout as a failed URL, not a failed run', async () => {
    const { makeFetcher } = await import('../src/node/live.js');
    const stalled = (async (_input: unknown, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>'));
          init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const get = makeFetcher({ timeoutMs: 50, fetchImpl: stalled, retries: 0 });
    const r = await get('https://slow.test/');
    expect(r.status).toBe(0);
    expect(r.error).toMatch(/timed out while reading/);
  });
});

describe('live mode: transient failures', () => {
  it('retries a timeout or 503 and keeps the good answer', async () => {
    const { makeFetcher } = await import('../src/node/live.js');
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } });
      if (calls === 2) return new Response('busy', { status: 503, headers: { 'retry-after': '0' } });
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const r = await makeFetcher({ timeoutMs: 1000, fetchImpl: flaky, retryDelayMs: 1 })('https://flaky.test/');
    expect([r.status, calls]).toEqual([200, 3]);
  });

  it('reports a page that never answers as unreachable, not as a broken link', async () => {
    const dead = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/slow/')
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } });
      if (url.pathname === '/robots.txt' || url.pathname.endsWith('.xml')) return new Response('', { status: 404 });
      return new Response(html('Home', '<a href="/slow/">Slow page</a>', `${O}/`), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof fetch;
    const site = await crawlLive(`${O}/`, {
      trailingSlash: 'always',
      fetchImpl: dead,
      retryDelayMs: 1,
      skipCrawlerAccess: true,
    });
    const report = runChecks(site, resolveConfig({ site: O }));
    expect(report.findings.some((f) => f.checkId === 'link-broken-internal')).toBe(false);
    const unreachable = report.findings.find((f) => f.checkId === 'http-status');
    expect(unreachable).toMatchObject({ severity: 'warning', url: `${O}/slow/` });
  });
});
