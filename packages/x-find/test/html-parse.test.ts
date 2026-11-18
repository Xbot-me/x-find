import { describe, expect, it } from 'vitest';
import { countWords, parsePage, parseRobotsValue } from '../src/core/html/parse.js';

const parse = (html: string, headers?: Record<string, string>) =>
  parsePage({
    url: 'https://example.com/a/',
    source: 'a.html',
    html,
    ...(headers ? { http: { status: 200, headers, redirects: [], finalUrl: 'https://example.com/a/' } } : {}),
  });

describe('parsePage', () => {
  it('sees what a browser sees: an <img> in <head> pushes later tags into <body>', () => {
    const p = parse(
      '<html><head><title>T</title><img src="x.gif"><link rel="canonical" href="https://example.com/a/"></head><body></body></html>',
    );
    expect(p.titles).toEqual([{ text: 'T', inHead: true }]);
    expect(p.links[0]).toMatchObject({ rel: ['canonical'], inHead: false });
  });

  it('keeps <svg><title> out of the document titles', () => {
    const p = parse('<title>Doc</title><body><svg><title>Icon</title></svg></body>');
    expect(p.titles.map((t) => t.text)).toEqual(['Doc']);
  });

  it('extracts visible text without scripts, styles and templates', () => {
    const p = parse(
      '<body><p>Hello <b>world</b></p><script>var x = "no"</script><style>p{}</style><template><p>no</p></template><noscript>no</noscript></body>',
    );
    expect(p.text).toBe('Hello world');
    expect(p.wordCount).toBe(2);
  });

  it('resolves links against <base href>, drops fragments and non-http schemes', () => {
    const p = parse(
      '<head><base href="https://example.com/docs/"></head><body><a href="intro">I</a><a href="#top">T</a><a href="mailto:a@b.c">M</a><a href="/x#y">X</a></body>',
    );
    expect(p.anchors.map((a) => a.url)).toEqual([
      'https://example.com/docs/intro',
      null,
      null,
      'https://example.com/x',
    ]);
  });

  it('uses image alt and aria-label as link names', () => {
    const p = parse('<body><a href="/a"><img src="i.png" alt="Logo"></a><a href="/b" aria-label="Close"></a></body>');
    expect(p.anchors[0]).toMatchObject({ text: '', imageAlt: 'Logo' });
    expect(p.anchors[1]).toMatchObject({ text: '', label: 'Close' });
  });

  it('records alt="" (decorative) differently from a missing alt', () => {
    const p = parse('<body><img src="a.png" alt=""><img src="b.png"></body>');
    expect(p.images.map((i) => i.alt)).toEqual(['', null]);
  });

  it('parses JSON-LD and keeps the error for invalid blocks', () => {
    const p = parse(
      '<script type="application/ld+json">{"@type":"Thing"}</script><script type="application/ld+json">{bad}</script>',
    );
    expect(p.jsonld[0]!.value).toEqual({ '@type': 'Thing' });
    expect(p.jsonld[1]!.error).toBeTruthy();
  });

  it('combines robots meta and X-Robots-Tag, most restrictive snippet limit wins', () => {
    const p = parse(
      '<meta name="robots" content="max-snippet:50"><meta name="googlebot" content="max-snippet:20, nofollow">',
      {
        'x-robots-tag': 'otherbot: noindex, googlebot: nosnippet',
      },
    );
    expect(p.robots.noindex).toBe(false); // the noindex is for otherbot only
    expect(p.robots.nofollow).toBe(true);
    expect(p.robots.nosnippet).toBe(true);
    expect(p.robots.maxSnippet).toBe(20);
  });

  it('treats "none" as noindex, nofollow', () => {
    const p = parse('<meta name="robots" content="NONE">');
    expect(p.robots).toMatchObject({ noindex: true, nofollow: true });
  });

  it('detects a charset declared in the first 1024 bytes or in Content-Type', () => {
    expect(parse('<meta charset="utf-8"><title>x</title>').charsetEarly).toBe(true);
    expect(parse(' '.repeat(1100) + '<meta charset="utf-8">').charsetEarly).toBe(false);
    expect(parse('<title>x</title>', { 'content-type': 'text/html; charset=utf-8' }).charsetEarly).toBe(true);
  });
});

describe('parseRobotsValue', () => {
  it('splits user-agent prefixes in X-Robots-Tag values', () => {
    expect(parseRobotsValue('googlebot: noindex, nofollow, bingbot: noarchive', '*')).toEqual([
      { agent: 'googlebot', value: 'noindex' },
      { agent: 'googlebot', value: 'nofollow' },
      { agent: 'bingbot', value: 'noarchive' },
    ]);
  });
  it('does not mistake valued directives for user agents', () => {
    expect(parseRobotsValue('max-snippet: 30, unavailable_after: 2030-01-01', '*')).toEqual([
      { agent: '*', value: 'max-snippet:30' },
      { agent: '*', value: 'unavailable_after:2030-01-01' },
    ]);
  });
});

describe('countWords', () => {
  it('counts CJK characters as words', () => {
    expect(countWords('Hello 世界')).toBe(3);
    expect(countWords(' — , . ')).toBe(0);
  });
});
