import { describe, expect, it } from 'vitest';
import type { PageFact } from '../src/core/pagefacts.js';
import type { Finding } from '../src/core/types.js';
import { linkMap } from '../src/server/linkmap.js';

const A = 'https://a.com';
const fact = (path: string, patch: Partial<PageFact> = {}): PageFact => ({
  url: A + path,
  notIndexable: null,
  canonical: null,
  inLinks: 3,
  depth: 1,
  words: 500,
  inSitemap: true,
  title: null,
  ...patch,
});

describe('link map', () => {
  const pages = [
    fact('/', { depth: 0, inLinks: 40, title: 'Home' }),
    fact('/about/'),
    fact('/work/'),
    fact('/work/a/', { depth: 2 }),
    fact('/work/b/', { depth: null, inLinks: 2 }),
    fact('/services/x/'),
    fact('/services/y/'),
    fact('/services/z/'),
    fact('/work/?i=a', { notIndexable: 'canonical', canonical: `${A}/work/`, inSitemap: false }),
    fact('/code/', { notIndexable: 'noindex', inSitemap: false }),
  ];
  const broken: Finding = {
    checkId: 'link-broken-internal',
    title: 'Broken internal link',
    category: 'seo',
    severity: 'error',
    url: `${A}/about/`,
    message: 'Links to a URL that returns HTTP 404.',
    evidence: '/old-page/ ("Our old page")',
    fix: '',
    sources: [],
    fingerprint: 'x',
  };
  const m = linkMap(A, pages, [broken])!;

  it('groups reachable pages by section, biggest first, top-level pages last', () => {
    expect(m.sections.map((s) => [s.name, s.pages.length])).toEqual([
      ['Services', 3],
      ['Work', 1],
      ['Pages', 2],
    ]);
    expect(m.sections.find((s) => s.name === 'Pages')!.pages.map((p) => p.path)).toEqual(['/about/', '/work/']);
  });

  it('separates pages links can’t reach and pages kept out on purpose', () => {
    expect(m.unreachable.map((p) => p.path)).toEqual(['/work/b/']);
    expect(m.keptOut.map((p) => [p.path, p.reason])).toEqual([
      ['/code/', 'noindex'],
      ['/work/?i=a', 'canonical'],
    ]);
  });

  it('reads broken links from the check: where they are, where they point, their text', () => {
    expect(m.broken).toEqual([{ from: '/about/', to: '/old-page/', text: 'Our old page' }]);
  });

  it('describes the home page and the sitemap', () => {
    // Includes the two pages kept out of search: the home page links to them too.
    expect(m.home).toMatchObject({ title: 'Home', linksTo: 7, linkedFrom: 40 });
    expect(m.sitemap).toBe(8);
  });

  it('is empty without page data', () => {
    expect(linkMap(A, null, null)).toBeNull();
  });
});
