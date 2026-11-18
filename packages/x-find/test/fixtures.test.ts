import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import { runChecks } from '../src/core/run.js';
import { loadFolder } from '../src/node/folder.js';

const dir = (name: string) => path.join(import.meta.dirname, 'fixtures', name);

async function check(name: string, config: object = {}) {
  const cfg = resolveConfig({ site: 'https://example.com', ...config });
  const site = await loadFolder(dir(name), {
    site: cfg.site,
    trailingSlash: cfg.trailingSlash,
    cleanUrls: cfg.cleanUrls,
  });
  return runChecks(site, cfg);
}

describe('good fixture', () => {
  it('has no errors or warnings and full scores', async () => {
    const r = await check('good', { brand: { name: 'Example Studio' } });
    expect(r.findings.filter((f) => f.severity !== 'notice')).toEqual([]);
    expect(r.scores.map((s) => s.score)).toEqual([100, 100, 100]);
    expect(r.pagesChecked).toBe(3); // 404.html is not a page
    expect(r.checkErrors).toEqual([]);
  });

  it('marks live-only checks as not measured, never passed', async () => {
    const r = await check('good');
    const live = r.checks.filter((c) => ['http-status', 'soft-404', 'crawler-ua-blocked'].includes(c.id));
    expect(live.map((c) => c.status)).toEqual(['not-measured', 'not-measured', 'not-measured']);
  });
});

describe('bad fixture', () => {
  const expected: [string, 'error' | 'warning' | 'notice', string?][] = [
    ['canonical-not-in-head', 'error', '/'],
    ['canonical-fragment', 'error', '/canon-to-missing/'],
    ['canonical-target-bad', 'error', '/canon-to-missing/'],
    ['canonical-relative', 'warning', '/canon-to-missing/'],
    ['jsonld-invalid', 'error', '/'],
    ['link-broken-internal', 'error', '/'],
    ['link-localhost', 'error', '/'],
    ['robots-noindex-blocked', 'error', '/noindexed/'],
    ['robotstxt-sitemap-relative', 'error'],
    ['sitemap-invalid', 'error'],
    ['sitemap-noindex', 'error', '/noindexed/'],
    ['sitemap-url-not-found', 'error', '/not-here/'],
    ['ai-search-bot-blocked', 'error'],
    ['title-multiple', 'warning', '/'],
    ['title-duplicate', 'warning', '/dup-a/'],
    ['description-duplicate', 'warning', '/dup-b/'],
    ['description-missing', 'warning', '/'],
    ['meta-in-body', 'warning', '/'],
    ['viewport-missing', 'warning', '/'],
    ['charset-missing', 'warning', '/'],
    ['img-alt-missing', 'warning', '/'],
    ['link-empty-text', 'warning', '/'],
    ['link-not-crawlable', 'warning', '/'],
    ['link-internal-http', 'warning', '/'],
    ['page-orphan', 'warning', '/Orphan_Page'],
    ['content-duplicate', 'warning', '/dup-a/'],
    ['content-needs-js', 'warning', '/spa/'],
    ['sitemap-missing-page', 'warning', '/spa/'],
    ['sitemap-url-other-host', 'warning'],
    ['sitemap-lastmod-invalid', 'warning', '/'],
    ['robotstxt-invalid-line', 'warning'],
    ['robotstxt-content-signal', 'warning'],
    ['llmstxt-invalid', 'warning'],
    ['llmstxt-bad-link', 'warning'],
    ['org-logo', 'warning', '/'],
    ['jsonld-id-unresolved', 'warning', '/'],
    ['brand-spelling', 'warning', '/'],
    ['link-generic-text', 'notice', '/'],
    ['robots-meta-invalid', 'notice', '/noindexed/'],
    ['robotstxt-unsupported-field', 'notice'],
    ['url-structure', 'notice', '/Orphan_Page'],
    ['h1-missing', 'notice', '/'],
    ['ai-training-bot-policy', 'notice'],
    ['site-name', 'notice', '/'],
    ['favicon-missing', 'notice', '/'],
  ];

  it.each(expected)('reports %s as %s', async (id, severity, urlPath) => {
    const r = await check('bad', { brand: { name: 'Example Studio' } });
    const hits = r.findings.filter((f) => f.checkId === id && f.severity === severity);
    expect(hits.length, `${id} not reported as ${severity}`).toBeGreaterThan(0);
    if (urlPath) expect(hits.map((f) => new URL(f.url!).pathname)).toContain(urlPath);
  });

  it('flags each brand misspelling once per page', async () => {
    const r = await check('bad', { brand: { name: 'Example Studio' } });
    const spellings = r.findings.filter((f) => f.checkId === 'brand-spelling').map((f) => f.message.split('"')[1]);
    expect(spellings.sort()).toEqual(['Example Studios', 'ExampleStudio', 'example studio']);
  });

  it('lets config change severities and lists the override', async () => {
    const r = await check('bad', { checks: { 'link-localhost': 'off', 'title-multiple': 'error' } });
    expect(r.findings.some((f) => f.checkId === 'link-localhost')).toBe(false);
    expect(r.findings.find((f) => f.checkId === 'title-multiple')!.severity).toBe('error');
    expect(r.overrides).toEqual([
      { id: 'link-localhost', severity: 'off' },
      { id: 'title-multiple', severity: 'error' },
    ]);
  });

  it('runs custom rules from config like built-in checks', async () => {
    const r = await check('bad', {
      rules: [
        {
          id: 'no-template-copy',
          scope: 'page',
          category: 'seo',
          severity: 'error',
          title: 'Template copy',
          fix: 'Write real copy.',
          sources: ['https://example.com/policy'],
          run: (page: { text: string }) => (/template copy/.test(page.text) ? [{ message: 'Template copy.' }] : []),
        },
      ],
    });
    expect(
      r.findings
        .filter((f) => f.checkId === 'no-template-copy')
        .map((f) => new URL(f.url!).pathname)
        .sort(),
    ).toEqual(['/dup-a/', '/dup-b/']);
  });

  it('ignores paths from config', async () => {
    const r = await check('bad', { ignore: ['/dup-*/**', '/spa/'] });
    expect(r.findings.some((f) => f.url?.includes('/dup-') || f.url?.endsWith('/spa/'))).toBe(false);
  });

  it('staging mode waives noindex and robots findings', async () => {
    const r = await check('bad', { staging: true });
    for (const id of ['robots-noindex-blocked', 'sitemap-noindex', 'ai-search-bot-blocked', 'robots-meta-noindex'])
      expect(
        r.findings.some((f) => f.checkId === id),
        id,
      ).toBe(false);
  });

  it('gives stable fingerprints across runs', async () => {
    const a = await check('bad');
    const b = await check('bad');
    expect(a.findings.map((f) => f.fingerprint)).toEqual(b.findings.map((f) => f.fingerprint));
    expect(new Set(a.findings.map((f) => f.fingerprint)).size).toBe(a.findings.length);
  });
});
