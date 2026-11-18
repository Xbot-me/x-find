import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import { pageFacts } from '../src/core/pagefacts.js';
import type { PageFact } from '../src/core/pagefacts.js';
import { loadFolder } from '../src/node/folder.js';
import { indexingView } from '../src/server/indexing.js';
import { inspectionUrls } from '../src/server/runner.js';
import type { IndexingInput, InspectionRow } from '../src/server/indexing.js';

const dir = (name: string) => path.join(import.meta.dirname, 'fixtures', name);

async function facts(name: string) {
  const cfg = resolveConfig({ site: 'https://example.com' });
  const site = await loadFolder(dir(name), {
    site: cfg.site,
    trailingSlash: cfg.trailingSlash,
    cleanUrls: cfg.cleanUrls,
  });
  return new Map(pageFacts(site, cfg).map((f) => [new URL(f.url).pathname, f]));
}

describe('page facts', () => {
  it('records links in, clicks from home, words and sitemap membership', async () => {
    const f = await facts('good');
    expect(f.get('/')).toMatchObject({ notIndexable: null, depth: 0, inSitemap: true });
    expect(f.get('/about/')).toMatchObject({ notIndexable: null, depth: 1, inSitemap: true });
    expect(f.get('/about/')!.inLinks).toBeGreaterThan(0);
    expect(f.get('/about/')!.words).toBeGreaterThan(0);
  });

  it('says why a page is kept out of search, and finds orphans', async () => {
    const f = await facts('bad');
    expect(f.get('/noindexed/')?.notIndexable).toBe('noindex');
    expect(f.get('/canon-to-missing/')).toMatchObject({ notIndexable: 'canonical' });
    expect(f.get('/canon-to-missing/')!.canonical).toMatch(/^https:\/\/example\.com\//);
    expect(f.get('/Orphan_Page')).toMatchObject({ inLinks: 0, depth: null });
  });
});

const fact = (url: string, patch: Partial<PageFact> = {}): PageFact => ({
  url,
  notIndexable: null,
  canonical: null,
  inLinks: 12,
  depth: 1,
  words: 800,
  inSitemap: true,
  title: null,
  ...patch,
});
const insp = (url: string, coverageState: string, patch: Partial<InspectionRow> = {}): InspectionRow => ({
  url,
  verdict: /indexed/i.test(coverageState) && !/not indexed/i.test(coverageState) ? 'PASS' : 'NEUTRAL',
  coverageState,
  pageFetchState: null,
  robotsState: null,
  googleCanonical: null,
  userCanonical: null,
  lastCrawl: null,
  checkedAt: '2026-11-15T08:00:00Z',
  ...patch,
});
const A = 'https://a.com';
const base = (patch: Partial<IndexingInput> = {}): IndexingInput => ({
  now: new Date('2026-11-15T08:00:00Z'),
  urls: [`${A}/`, `${A}/about/`, `${A}/work/`, `${A}/terms/`],
  pages: [fact(`${A}/`), fact(`${A}/about/`), fact(`${A}/work/`), fact(`${A}/terms/`)],
  inspections: [
    insp(`${A}/`, 'Submitted and indexed'),
    insp(`${A}/about/`, 'URL is unknown to Google'),
    insp(`${A}/work/`, 'Discovered - currently not indexed'),
    insp(`${A}/terms/`, 'Discovered - currently not indexed'),
  ],
  sitemaps: [
    {
      path: `${A}/sitemap.xml`,
      lastSubmitted: '2026-11-01T00:00:00Z',
      lastDownloaded: '2026-11-14T00:00:00Z',
      isPending: false,
      errors: 0,
      warnings: 0,
      submitted: 4,
    },
  ],
  firstImpression: '2026-11-05',
  thinContentWords: 200,
  inspectLink: (u) => `https://search.google.com/search-console/inspect?id=${encodeURIComponent(u)}`,
  ...patch,
});

describe('indexing view', () => {
  it('counts only pages meant to be in search, and leaves out canonicalised and noindex URLs', () => {
    const v = indexingView(
      base({
        // An older run listed every crawled URL, including a filter link that points its canonical elsewhere.
        urls: [`${A}/`, `${A}/about/`, `${A}/work/`, `${A}/terms/`, `${A}/work/?i=x`, `${A}/code/`],
        pages: [
          ...base().pages!,
          fact(`${A}/work/?i=x`, { notIndexable: 'canonical', canonical: `${A}/work/`, inSitemap: false }),
          fact(`${A}/code/`, { notIndexable: 'noindex', inSitemap: false }),
        ],
        inspections: [
          ...base().inspections,
          insp(`${A}/work/?i=x`, 'URL is unknown to Google'),
          insp(`${A}/code/`, "Excluded by 'noindex' tag"),
        ],
      }),
    );
    expect(v).toMatchObject({ meant: 4, inspected: 4, indexed: 1, missing: 3 });
    expect(v.notMeant).toEqual({ count: 2, canonical: 1, noindex: 1, robots: 0, status: 0 });
  });

  it('groups missing pages by Google state with what it means, what to do and a source', () => {
    const v = indexingView(base());
    expect(v.groups.map((g) => [g.state, g.pages.length])).toEqual([
      ['Discovered - currently not indexed', 2],
      ['URL is unknown to Google', 1],
    ]);
    for (const g of v.groups) {
      expect(g.meaning).not.toBe('');
      expect(g.todo).not.toBe('');
      expect(g.source).toMatch(/^https:\/\/(support\.google\.com|developers\.google\.com)\//);
    }
    expect(v.groups[0]!.pages[0]!.inspectUrl).toMatch(/^https:\/\/search\.google\.com\/search-console\/inspect\?/);
  });

  it('says plainly when nothing on the pages explains it, and that the site is new to Google', () => {
    const v = indexingView(base());
    expect(v.explained).toBe(0);
    expect(v.verdict).toMatch(/Nothing on the pages explains it/);
    expect(v.verdict).toMatch(/new to Google/);
    expect(v.site.map((r) => r.id)).toEqual(['site-young']);
    expect(v.site[0]!.text).toMatch(/2026-11-05 \(10 days ago\)/);
  });

  it('points to page-level causes it can measure, each with a source', () => {
    const v = indexingView(
      base({
        pages: [
          fact(`${A}/`),
          fact(`${A}/about/`, { inLinks: 0, depth: null, inSitemap: false }),
          fact(`${A}/work/`, { words: 40 }),
          fact(`${A}/terms/`),
        ],
        inspections: [
          insp(`${A}/`, 'Submitted and indexed'),
          insp(`${A}/about/`, 'URL is unknown to Google'),
          insp(`${A}/work/`, 'Crawled - currently not indexed', {
            googleCanonical: `${A}/`,
            userCanonical: `${A}/work/`,
            pageFetchState: 'SOFT_404',
          }),
          insp(`${A}/terms/`, 'Discovered - currently not indexed'),
        ],
      }),
    );
    const reasons = (url: string) =>
      v.groups
        .flatMap((g) => g.pages)
        .find((p) => p.url === url)!
        .reasons.map((r) => r.id);
    expect(reasons(`${A}/about/`)).toEqual(['not-linked', 'not-in-sitemap']);
    expect(reasons(`${A}/work/`)).toEqual(['thin', 'google-canonical', 'fetch-failed']);
    expect(reasons(`${A}/terms/`)).toEqual([]);
    expect(v.explained).toBe(2);
    expect(v.verdict).toMatch(/^2 of the 3 missing pages/);
    for (const r of v.groups.flatMap((g) => g.pages).flatMap((p) => p.reasons)) expect(r.source).toMatch(/^https:\/\//);
  });

  it('flags a sitemap that was never submitted, has errors or is still pending', () => {
    expect(indexingView(base({ sitemaps: [] })).site.map((r) => r.id)).toContain('sitemap-not-submitted');
    const v = indexingView(
      base({ sitemaps: [{ ...base().sitemaps![0]!, errors: 2, isPending: true }], firstImpression: '2025-01-01' }),
    );
    expect(v.site.map((r) => r.id)).toEqual(['sitemap-errors', 'sitemap-pending']);
    // Unknown (never read) is not the same as "none submitted".
    expect(indexingView(base({ sitemaps: null })).site.map((r) => r.id)).not.toContain('sitemap-not-submitted');
  });

  it('reports a fully indexed site and an older site without blaming its age', () => {
    const all = indexingView(
      base({
        inspections: base().inspections.map((i) => ({ ...i, verdict: 'PASS', coverageState: 'Submitted and indexed' })),
      }),
    );
    expect(all).toMatchObject({ indexed: 4, missing: 0 });
    expect(all.verdict).toBe('Every inspected page you want in search is in Google.');
    const old = indexingView(base({ firstImpression: '2025-01-01' }));
    expect(old.verdict).toMatch(/does not index every page/);
    expect(old.site).toEqual([]);
  });

  it('counts pages from the sitemap that the crawl never reached as unlinked', () => {
    const v = indexingView(base({ pages: [fact(`${A}/`)] }));
    expect(v.groups.flatMap((g) => g.pages).every((p) => p.reasons[0]?.id === 'not-linked')).toBe(true);
  });
});

describe('URLs sent to URL Inspection', () => {
  it('lists sitemap pages and indexable crawled pages, never child sitemaps or canonicalised URLs', () => {
    const file = (url: string, body: string) => ({ url, body, bytes: body.length, status: 200 });
    const urls = inspectionUrls(
      {
        origin: A,
        sitemaps: [
          file(
            `${A}/sitemap-index.xml`,
            `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${A}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
          ),
          file(
            `${A}/sitemap-0.xml`,
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${A}/about/</loc></url><url><loc>https://other.com/x</loc></url></urlset>`,
          ),
        ],
      },
      [fact(`${A}/`), fact(`${A}/about/`), fact(`${A}/work/?i=x`, { notIndexable: 'canonical' })],
    );
    expect(urls).toEqual([`${A}/about/`, `${A}/`]);
  });
});
