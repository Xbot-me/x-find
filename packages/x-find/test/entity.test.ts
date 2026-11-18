import { describe, expect, it } from 'vitest';
import { entityFacts } from '../src/core/entity.js';
import { parsePage } from '../src/core/html/parse.js';
import type { Finding, SiteModel } from '../src/core/types.js';
import { geoView, platformOf } from '../src/server/geo.js';

const A = 'https://a.com';
const ld = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`;
const page = (path: string, head: string, body = '') =>
  parsePage({ url: A + path, source: A + path, html: `<html><head>${head}</head><body>${body}</body></html>` });

function site(pages: ReturnType<typeof page>[]): SiteModel {
  return {
    mode: 'live',
    origin: A,
    pages,
    robotsTxt: null,
    llmsTxt: null,
    sitemaps: [],
    resources: new Map(),
    failedPages: new Map(),
  };
}

const home = page(
  '/',
  `<title>Acme Studio — 3D for games</title><meta property="og:site_name" content="Acme Studio">` +
    ld({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Acme Studio', alternateName: 'Acme', url: `${A}/` },
        {
          '@type': 'https://schema.org/ProfessionalService',
          '@id': `${A}/#org`,
          name: 'Acme Studio',
          url: `${A}/`,
          description: 'A studio.',
          sameAs: 'https://www.linkedin.com/company/acme',
          member: [{ '@id': `${A}/team/ann/#person` }, { '@id': `${A}/team/bob/#person` }],
        },
      ],
    }),
  '<h1>Built in 3D.</h1><a href="/about/">About</a><a href="/get-in-touch/">Contact us</a>',
);
const ann = page(
  '/team/ann/',
  '<title>Ann</title>' +
    ld({
      '@context': 'https://schema.org',
      '@type': 'Person',
      '@id': `${A}/team/ann/#person`,
      name: 'Ann Lee',
      jobTitle: 'Rigger',
      url: `${A}/team/ann/`,
    }),
);
const post = page(
  '/blog/rigging/',
  '<title>Rigging</title>' +
    ld({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: 'Rigging',
      author: { '@id': `${A}/team/ann/#person` },
      datePublished: '2026-11-01',
    }),
);
const about = page('/about/', '<title>About</title>');

describe('entity facts', () => {
  const e = entityFacts(site([home, ann, post, about]));

  it('reads the organization, including full-IRI types and a single sameAs string', () => {
    expect(e.org).toMatchObject({
      page: `${A}/`,
      types: ['ProfessionalService'],
      name: 'Acme Studio',
      sameAs: ['https://www.linkedin.com/company/acme'],
    });
    expect(e.org!.present).toEqual(expect.arrayContaining(['name', 'url', 'description', 'sameAs']));
    expect(e.org!.present).not.toContain('logo');
  });

  it('follows @id references to items defined on other pages', () => {
    // Bob is referenced but no crawled page describes him.
    expect(e.org!.members).toEqual({ referenced: 2, defined: 1 });
    expect(e.people).toEqual([
      { name: 'Ann Lee', page: `${A}/team/ann/`, hasJobTitle: true, hasProfiles: false, hasUrl: true },
    ]);
    expect(e.articles).toEqual({ total: 1, withAuthor: 1, withAuthorLink: 1, withDate: 1 });
  });

  it('lists every name the home page gives the site', () => {
    expect(e.names.map((n) => n.where)).toEqual([
      'WebSite name',
      'WebSite alternateName',
      'Organization name',
      'og:site_name',
      'Home page title',
      'Home page heading',
    ]);
  });

  it('finds about and contact pages by path or by link text', () => {
    expect(e.aboutPage).toBe(`${A}/about/`);
    expect(e.contactPage).toBe(`${A}/get-in-touch/`);
  });

  it('is empty-handed, not wrong, on a site that says nothing', () => {
    const bare = entityFacts(site([page('/', '<title>Hi</title>')]));
    expect(bare).toMatchObject({ org: null, website: null, people: [], services: 0, aboutPage: null });
  });
});

describe('GEO analysis', () => {
  const finding = (checkId: string, message: string): Finding => ({
    checkId,
    title: checkId,
    category: 'geo',
    severity: 'warning',
    url: `${A}/`,
    message,
    fix: '',
    sources: [],
    fingerprint: checkId,
  });

  it('asks to run a check when the run predates entity facts', () => {
    expect(geoView(A, undefined, [])).toEqual({ measured: false, items: [], steps: [] });
  });

  it('describes where the site stands and orders the steps', () => {
    const v = geoView(A, entityFacts(site([home, ann, post, about])), [
      finding('org-logo', 'Organization has no logo.'),
    ]);
    const by = Object.fromEntries(v.items.map((i) => [i.id, i]));
    expect(by['name']!.status).toBe('good');
    expect(by['org']!.status).toBe('partial');
    expect(by['org']!.step).toContain('a logo');
    expect(by['profiles']).toMatchObject({ status: 'good' });
    expect(by['profiles']!.summary).toContain('LinkedIn');
    expect(by['people']!.details.join(' ')).toContain('2 people as members; 1 of them');
    expect(by['elsewhere']!.status).toBe('not-measured');
    expect(v.steps.map((s) => s.id)).toEqual(['org']);
    // Every item cites at least one source.
    for (const i of v.items) expect(i.sources.length, i.id).toBeGreaterThan(0);
  });

  it('flags a name that disagrees, but not a slogan heading', () => {
    const odd = page(
      '/',
      '<title>Acme Studio</title><meta property="og:site_name" content="Acme Labs">' +
        ld({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Acme Studio', url: `${A}/` }),
      '<h1>We build worlds</h1>',
    );
    const item = geoView(A, entityFacts(site([odd])), []).items.find((i) => i.id === 'name')!;
    expect(item.status).toBe('partial');
    expect(item.summary).toContain('1 place');
  });

  it('marks a WebSite without a name as required, and puts it first', () => {
    const noName = page(
      '/',
      '<title>X</title>' + ld({ '@context': 'https://schema.org', '@type': 'WebSite', url: `${A}/` }),
    );
    const v = geoView(A, entityFacts(site([noName])), []);
    expect(v.steps[0]).toMatchObject({ id: 'name', basis: 'required' });
  });

  it('names common profile platforms', () => {
    expect(platformOf('https://www.fiverr.com/acme')).toBe('Fiverr');
    expect(platformOf('https://example.org/me')).toBe('example.org');
  });
});
