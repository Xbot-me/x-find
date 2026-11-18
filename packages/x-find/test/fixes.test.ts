import { describe, expect, it } from 'vitest';
import type { PageFact } from '../src/core/pagefacts.js';
import type { Finding } from '../src/core/types.js';
import { candidateActions } from '../src/server/actions.js';
import type { Action } from '../src/server/actions.js';
import { fixFor, labelFromTitle } from '../src/server/fixes.js';
import type { FixContext } from '../src/server/fixes.js';

const A = 'https://brightleafstudio.example';
const fact = (path: string, title: string | null, patch: Partial<PageFact> = {}): PageFact => ({
  url: A + path,
  notIndexable: null,
  canonical: null,
  inLinks: 10,
  depth: 1,
  words: 800,
  inSitemap: true,
  title,
  ...patch,
});
const finding = (checkId: string, url: string, message: string, evidence?: string): Finding => ({
  checkId,
  title: checkId,
  category: 'seo',
  severity: 'warning',
  url: A + url,
  message,
  ...(evidence ? { evidence } : {}),
  fix: 'Fix it.',
  sources: ['https://developers.google.com/search/docs/crawling-indexing/links-crawlable'],
  fingerprint: checkId + url,
});

const pages = [
  fact('/', 'BrightLeaf Studio | 3D studio for games'),
  fact('/work/', 'Work | BrightLeaf Studio'),
  fact('/work/products/', 'Product & hard-surface: Work | BrightLeaf Studio', { depth: null, inLinks: 3 }),
  fact('/work/character-art/', 'Character art: Work | BrightLeaf Studio', { depth: null, inLinks: 3 }),
  fact('/work/?i=products', 'Work | BrightLeaf Studio', { notIndexable: 'canonical', canonical: `${A}/work/` }),
];
const findings = [
  finding('link-empty-text', '/', 'Link has no text.', '/work/'),
  finding('org-logo', '/', 'Organization has no logo.'),
  finding('trailing-slash-duplicate', '/code', '/code redirects with a temporary HTTP 307.'),
];
const ctx: FixContext = { origin: A, siteName: 'BrightLeaf Studio', pages, findings, server: 'cloudflare' };
const actions = candidateActions({
  origin: A,
  brandNames: ['BrightLeaf Studio'],
  findings,
  pages,
  indexing: null,
  search: null,
}).actions;
const byKey = (k: string) => actions.find((a) => a.key === k)!;

describe('link labels from page titles', () => {
  it('drops the site name and section suffix', () => {
    expect(
      labelFromTitle('Product & hard-surface: Work | BrightLeaf Studio', `${A}/work/products/`, 'BrightLeaf Studio'),
    ).toBe('Product & hard-surface');
    expect(labelFromTitle('BrightLeaf Studio | 3D studio for games', `${A}/`, 'BrightLeaf Studio')).toBe(
      '3D studio for games',
    );
    expect(labelFromTitle(null, `${A}/services/character-rigging/`, 'BrightLeaf Studio')).toBe('Character rigging');
  });
});

describe('fixes written from the site’s own data', () => {
  it('unreachable pages: links with the real titles, mentioning the filter links', () => {
    const f = fixFor(byKey('reach'), ctx);
    expect(f.scene).toBe('reach');
    expect(f.headline).toBe('Google can’t reach 2 of your pages.');
    expect(f.reason).toMatch(/filtered versions/);
    expect(f.code!.text).toBe(
      '<a href="/work/products/">Product &amp; hard-surface</a>\n<a href="/work/character-art/">Character art</a>',
    );
    expect(f.check).toBe('crawl');
  });

  it('empty link: names the link target and suggests text from that page’s title', () => {
    const f = fixFor(byKey('finding:link-empty-text:warning'), ctx);
    expect(f.headline).toBe('A link on your home page has no words.');
    expect(f.code!.text).toContain('<a href="/work/">Work</a>');
    expect(f.code!.text).toContain('aria-label="Work"');
  });

  it('logo: the exact line to add, with the site’s own address', () => {
    const f = fixFor(byKey('finding:org-logo:warning'), ctx);
    expect(f.code!.text).toBe(`"logo": "${A}/logo.png"`);
    expect(f.steps[0]).toMatch(/112 × 112/);
  });

  it('redirect: a Cloudflare _redirects line when the site runs on Cloudflare, generic advice otherwise', () => {
    const cf = fixFor(byKey('finding:trailing-slash-duplicate:warning'), ctx);
    expect(cf.headline).toBe('Google may see /code and /code/ as two pages.');
    expect(cf.code).toEqual({ label: '_redirects', text: '/code  /code/  301' });
    const other = fixFor(byKey('finding:trailing-slash-duplicate:warning'), { ...ctx, server: 'nginx' });
    expect(other.steps[0]).toMatch(/host’s settings/);
  });

  it('asking Google: a search-side task with Search Console links', () => {
    const a: Action = {
      key: 'index-request',
      tier: 2,
      weight: 3,
      title: 'Ask Google to index your 2 most important pages',
      why: 'Google hasn’t crawled them.',
      steps: [],
      who: 'you',
      doneWhen: 'Google has indexed them.',
      closesItself: true,
      source: 'search',
      sources: ['https://support.google.com/webmasters/answer/9012289'],
      pages: [{ url: `${A}/a/`, inspectUrl: 'https://search.google.com/search-console/inspect?id=x' }],
    };
    const f = fixFor(a, ctx);
    expect(f.check).toBe('search');
    expect(f.scene).toBe('index');
    expect(f.pages[0]!.inspectUrl).toMatch(/search-console/);
  });

  it('every fix has a brief a developer or AI can act on', () => {
    for (const a of actions) {
      const f = fixFor(a, ctx);
      expect(f.headline.length).toBeGreaterThan(10);
      expect(f.brief).toContain(A);
      expect(f.brief).toMatch(/Steps:\n1\. /);
      expect(f.brief).toMatch(/Done when: /);
    }
  });
});
