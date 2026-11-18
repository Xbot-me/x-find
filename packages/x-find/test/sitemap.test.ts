import { describe, expect, it } from 'vitest';
import { isW3cDatetime, parseSitemap } from '../src/core/sitemap/parse.js';

describe('parseSitemap', () => {
  it('reads a urlset with lastmod and decodes entities', () => {
    const r = parseSitemap(
      '<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://e.com/?a=1&amp;b=2</loc><lastmod>2026-01-02</lastmod><image:image><image:loc>https://e.com/i.png</image:loc></image:image></url></urlset>',
    );
    expect(r.kind).toBe('urlset');
    expect(r.entries).toEqual([{ loc: 'https://e.com/?a=1&b=2', lastmod: '2026-01-02' }]);
    expect(r.errors).toEqual([]);
  });

  it('reads a sitemap index', () => {
    const r = parseSitemap('<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>');
    expect(r).toMatchObject({ kind: 'sitemapindex', entries: [{ loc: 'https://e.com/s1.xml' }] });
  });

  it('reports an unescaped ampersand and a wrong root', () => {
    expect(parseSitemap('<urlset><url><loc>https://e.com/?a=1&b=2</loc></url></urlset>').errors[0]).toMatch(
      /unescaped "&"/,
    );
    expect(parseSitemap('<html><body>Not found</body></html>')).toMatchObject({ kind: 'unknown' });
  });

  it('reads a text sitemap', () => {
    expect(parseSitemap('https://e.com/a\nhttps://e.com/b\n').entries.map((e) => e.loc)).toEqual([
      'https://e.com/a',
      'https://e.com/b',
    ]);
  });

  it('validates W3C datetimes', () => {
    for (const ok of ['2026', '2026-11', '2026-11-15', '2026-11-15T10:00+01:00', '2026-11-15T10:00:00.5Z'])
      expect(isW3cDatetime(ok)).toBe(true);
    for (const bad of ['yesterday', '2026-11-15T10:00', '15/11/2026']) expect(isW3cDatetime(bad)).toBe(false);
  });
});
