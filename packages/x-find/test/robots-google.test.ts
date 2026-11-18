/**
 * Test cases ported from google/robotstxt, robots_test.cc (https://github.com/google/robotstxt).
 * Copyright 2019 Google LLC. Licensed under the Apache License, Version 2.0. See NOTICE.
 *
 * Differences, on purpose:
 * - URLs here go through the WHATWG URL parser, which percent-encodes non-ASCII characters the way a crawler sends
 *   them. Google's raw-string assertions about an unencoded "ツ" in the URL therefore don't apply and are left out.
 */
import { describe, expect, it } from 'vitest';
import { isAllowed, isValidUserAgentToObey, parseRobotsTxt } from '../src/core/robots/parse.js';

const A = (robotstxt: string, ua: string, url: string) => isAllowed(parseRobotsTxt(robotstxt), ua, url);

describe('google/robotstxt: matching', () => {
  it('SystemTest', () => {
    const r = 'user-agent: FooBot\ndisallow: /\n';
    expect(A('', 'FooBot', '')).toBe(true);
    expect(A(r, '', '')).toBe(true);
    expect(A(r, 'FooBot', '')).toBe(false);
    expect(A('', '', '')).toBe(true);
  });

  it('LineSyntax_Line', () => {
    const url = 'http://foo.bar/x/y';
    expect(A('user-agent: FooBot\ndisallow: /\n', 'FooBot', url)).toBe(false);
    expect(A('foo: FooBot\nbar: /\n', 'FooBot', url)).toBe(true);
    expect(A('user-agent FooBot\ndisallow /\n', 'FooBot', url)).toBe(false);
  });

  it('LineSyntax_Groups', () => {
    const r =
      'allow: /foo/bar/\n\nuser-agent: FooBot\ndisallow: /\nallow: /x/\nuser-agent: BarBot\ndisallow: /\nallow: /y/\n\n\nallow: /w/\nuser-agent: BazBot\n\nuser-agent: FooBot\nallow: /z/\ndisallow: /\n';
    expect(A(r, 'FooBot', 'http://foo.bar/x/b')).toBe(true);
    expect(A(r, 'FooBot', 'http://foo.bar/z/d')).toBe(true);
    expect(A(r, 'FooBot', 'http://foo.bar/y/c')).toBe(false);
    expect(A(r, 'BarBot', 'http://foo.bar/y/c')).toBe(true);
    expect(A(r, 'BarBot', 'http://foo.bar/w/a')).toBe(true);
    expect(A(r, 'BarBot', 'http://foo.bar/z/d')).toBe(false);
    expect(A(r, 'BazBot', 'http://foo.bar/z/d')).toBe(true);
    expect(A(r, 'FooBot', 'http://foo.bar/foo/bar/')).toBe(false);
    expect(A(r, 'BarBot', 'http://foo.bar/foo/bar/')).toBe(false);
    expect(A(r, 'BazBot', 'http://foo.bar/foo/bar/')).toBe(false);
  });

  it('LineSyntax_Groups_OtherRules', () => {
    const r1 = 'User-agent: BarBot\nSitemap: https://foo.bar/sitemap\nUser-agent: *\nDisallow: /\n';
    expect(A(r1, 'FooBot', 'http://foo.bar/')).toBe(false);
    expect(A(r1, 'BarBot', 'http://foo.bar/')).toBe(false);
    const r2 = 'User-agent: FooBot\nInvalid-Unknown-Line: unknown\nUser-agent: *\nDisallow: /\n';
    expect(A(r2, 'FooBot', 'http://foo.bar/')).toBe(false);
    expect(A(r2, 'BarBot', 'http://foo.bar/')).toBe(false);
  });

  it('REPLineNamesCaseInsensitive', () => {
    for (const r of [
      'USER-AGENT: FooBot\nALLOW: /x/\nDISALLOW: /\n',
      'user-agent: FooBot\nallow: /x/\ndisallow: /\n',
      'uSeR-aGeNt: FooBot\nAlLoW: /x/\ndIsAlLoW: /\n',
    ]) {
      expect(A(r, 'FooBot', 'http://foo.bar/x/y')).toBe(true);
      expect(A(r, 'FooBot', 'http://foo.bar/a/b')).toBe(false);
    }
  });

  it('VerifyValidUserAgentsToObey', () => {
    expect(isValidUserAgentToObey('Foobot')).toBe(true);
    expect(isValidUserAgentToObey('Foobot-Bar')).toBe(true);
    expect(isValidUserAgentToObey('Foo_Bar')).toBe(true);
    for (const bad of ['', 'ツ', 'Foobot*', ' Foobot ', 'Foobot/2.1', 'Foobot Bar']) {
      expect(isValidUserAgentToObey(bad)).toBe(false);
    }
  });

  it('UserAgentValueCaseInsensitive', () => {
    for (const r of [
      'User-Agent: FOO BAR\nAllow: /x/\nDisallow: /\n',
      'User-Agent: foo bar\nAllow: /x/\nDisallow: /\n',
      'User-Agent: FoO bAr\nAllow: /x/\nDisallow: /\n',
    ]) {
      for (const ua of ['Foo', 'foo']) {
        expect(A(r, ua, 'http://foo.bar/x/y')).toBe(true);
        expect(A(r, ua, 'http://foo.bar/a/b')).toBe(false);
      }
    }
  });

  it('AcceptUserAgentUpToFirstSpace', () => {
    const r = 'User-Agent: *\nDisallow: /\nUser-Agent: Foo Bar\nAllow: /x/\nDisallow: /\n';
    expect(A(r, 'Foo', 'http://foo.bar/x/y')).toBe(true);
    expect(A(r, 'Foo Bar', 'http://foo.bar/x/y')).toBe(false);
  });

  it('GlobalGroups_Secondary', () => {
    const url = 'http://foo.bar/x/y';
    expect(A('', 'FooBot', url)).toBe(true);
    const global = 'user-agent: *\nallow: /\nuser-agent: FooBot\ndisallow: /\n';
    expect(A(global, 'FooBot', url)).toBe(false);
    expect(A(global, 'BarBot', url)).toBe(true);
    const onlySpecific =
      'user-agent: FooBot\nallow: /\nuser-agent: BarBot\ndisallow: /\nuser-agent: BazBot\ndisallow: /\n';
    expect(A(onlySpecific, 'QuxBot', url)).toBe(true);
  });

  it('AllowDisallow_Value_CaseSensitive', () => {
    expect(A('user-agent: FooBot\ndisallow: /x/\n', 'FooBot', 'http://foo.bar/x/y')).toBe(false);
    expect(A('user-agent: FooBot\ndisallow: /X/\n', 'FooBot', 'http://foo.bar/x/y')).toBe(true);
  });

  it('LongestMatch', () => {
    const url = 'http://foo.bar/x/page.html';
    expect(A('user-agent: FooBot\ndisallow: /x/page.html\nallow: /x/\n', 'FooBot', url)).toBe(false);
    const r2 = 'user-agent: FooBot\nallow: /x/page.html\ndisallow: /x/\n';
    expect(A(r2, 'FooBot', url)).toBe(true);
    expect(A(r2, 'FooBot', 'http://foo.bar/x/')).toBe(false);
    expect(A('user-agent: FooBot\ndisallow: \nallow: \n', 'FooBot', url)).toBe(true);
    expect(A('user-agent: FooBot\ndisallow: /\nallow: /\n', 'FooBot', url)).toBe(true);
    const r5 = 'user-agent: FooBot\ndisallow: /x\nallow: /x/\n';
    expect(A(r5, 'FooBot', 'http://foo.bar/x')).toBe(false);
    expect(A(r5, 'FooBot', 'http://foo.bar/x/')).toBe(true);
    expect(A('user-agent: FooBot\ndisallow: /x/page.html\nallow: /x/page.html\n', 'FooBot', url)).toBe(true);
    const r7 = 'user-agent: FooBot\nallow: /page\ndisallow: /*.html\n';
    expect(A(r7, 'FooBot', 'http://foo.bar/page.html')).toBe(false);
    expect(A(r7, 'FooBot', 'http://foo.bar/page')).toBe(true);
    const r8 = 'user-agent: FooBot\nallow: /x/page.\ndisallow: /*.html\n';
    expect(A(r8, 'FooBot', url)).toBe(true);
    expect(A(r8, 'FooBot', 'http://foo.bar/x/y.html')).toBe(false);
    const r9 = 'User-agent: *\nDisallow: /x/\nUser-agent: FooBot\nDisallow: /y/\n';
    expect(A(r9, 'FooBot', 'http://foo.bar/x/page')).toBe(true);
    expect(A(r9, 'FooBot', 'http://foo.bar/y/page')).toBe(false);
  });

  it('Encoding', () => {
    expect(
      A(
        'User-agent: FooBot\nDisallow: /\nAllow: /foo/bar?qux=taz&baz=http://foo.bar?tar&par\n',
        'FooBot',
        'http://foo.bar/foo/bar?qux=taz&baz=http://foo.bar?tar&par',
      ),
    ).toBe(true);
    expect(
      A('User-agent: FooBot\nDisallow: /\nAllow: /foo/bar/ツ\n', 'FooBot', 'http://foo.bar/foo/bar/%E3%83%84'),
    ).toBe(true);
    expect(
      A('User-agent: FooBot\nDisallow: /\nAllow: /foo/bar/%E3%83%84\n', 'FooBot', 'http://foo.bar/foo/bar/%E3%83%84'),
    ).toBe(true);
    const r = 'User-agent: FooBot\nDisallow: /\nAllow: /foo/bar/%62%61%7A\n';
    expect(A(r, 'FooBot', 'http://foo.bar/foo/bar/baz')).toBe(false);
    expect(A(r, 'FooBot', 'http://foo.bar/foo/bar/%62%61%7A')).toBe(true);
  });

  it('SpecialCharacters', () => {
    const r1 = 'User-agent: FooBot\nDisallow: /foo/bar/quz\nAllow: /foo/*/qux\n';
    expect(A(r1, 'FooBot', 'http://foo.bar/foo/bar/quz')).toBe(false);
    expect(A(r1, 'FooBot', 'http://foo.bar/foo/quz')).toBe(true);
    expect(A(r1, 'FooBot', 'http://foo.bar/foo//quz')).toBe(true);
    expect(A(r1, 'FooBot', 'http://foo.bar/foo/bax/quz')).toBe(true);
    const r2 = 'User-agent: FooBot\nDisallow: /foo/bar$\nAllow: /foo/bar/qux\n';
    expect(A(r2, 'FooBot', 'http://foo.bar/foo/bar')).toBe(false);
    expect(A(r2, 'FooBot', 'http://foo.bar/foo/bar/qux')).toBe(true);
    expect(A(r2, 'FooBot', 'http://foo.bar/foo/bar/')).toBe(true);
    expect(A(r2, 'FooBot', 'http://foo.bar/foo/bar/baz')).toBe(true);
    const r3 = 'User-agent: FooBot\n# Disallow: /\nDisallow: /foo/quz#qux\nAllow: /\n';
    expect(A(r3, 'FooBot', 'http://foo.bar/foo/bar')).toBe(true);
    expect(A(r3, 'FooBot', 'http://foo.bar/foo/quz')).toBe(false);
  });

  it('IndexHTMLisDirectory', () => {
    const r = 'User-Agent: *\nAllow: /allowed-slash/index.html\nDisallow: /\n';
    expect(A(r, 'foobot', 'http://foo.com/allowed-slash/')).toBe(true);
    expect(A(r, 'foobot', 'http://foo.com/allowed-slash/index.htm')).toBe(false);
    expect(A(r, 'foobot', 'http://foo.com/allowed-slash/index.html')).toBe(true);
    expect(A(r, 'foobot', 'http://foo.com/anyother-url')).toBe(false);
  });

  it('LineTooLong', () => {
    const maxLine = 2083 * 8;
    let longline = '/x/';
    const max = maxLine - longline.length - 'disallow: '.length + 1;
    while (longline.length < max) longline += 'a';
    const r = `user-agent: FooBot\ndisallow: ${longline}/qux\n`;
    expect(A(r, 'FooBot', 'http://foo.bar/fux')).toBe(true);
    expect(A(r, 'FooBot', `http://foo.bar${longline}/fux`)).toBe(false);
  });

  it('DocumentationChecks', () => {
    const fish = 'user-agent: FooBot\ndisallow: /\nallow: /fish\n';
    expect(A(fish, 'FooBot', 'http://foo.bar/bar')).toBe(false);
    for (const p of [
      '/fish',
      '/fish.html',
      '/fish/salmon.html',
      '/fishheads',
      '/fishheads/yummy.html',
      '/fish.html?id=anything',
    ])
      expect(A(fish, 'FooBot', 'http://foo.bar' + p)).toBe(true);
    for (const p of ['/Fish.asp', '/catfish', '/?id=fish']) expect(A(fish, 'FooBot', 'http://foo.bar' + p)).toBe(false);

    const fishStar = 'user-agent: FooBot\ndisallow: /\nallow: /fish*\n';
    for (const p of [
      '/fish',
      '/fish.html',
      '/fish/salmon.html',
      '/fishheads',
      '/fishheads/yummy.html',
      '/fish.html?id=anything',
    ])
      expect(A(fishStar, 'FooBot', 'http://foo.bar' + p)).toBe(true);
    for (const p of ['/bar', '/Fish.bar', '/catfish', '/?id=fish'])
      expect(A(fishStar, 'FooBot', 'http://foo.bar' + p)).toBe(false);

    const fishDir = 'user-agent: FooBot\ndisallow: /\nallow: /fish/\n';
    for (const p of ['/fish/', '/fish/salmon', '/fish/?salmon', '/fish/salmon.html', '/fish/?id=anything'])
      expect(A(fishDir, 'FooBot', 'http://foo.bar' + p)).toBe(true);
    for (const p of ['/bar', '/fish', '/fish.html', '/Fish/Salmon.html'])
      expect(A(fishDir, 'FooBot', 'http://foo.bar' + p)).toBe(false);

    const php = 'user-agent: FooBot\ndisallow: /\nallow: /*.php\n';
    for (const p of [
      '/filename.php',
      '/folder/filename.php',
      '/folder/filename.php?parameters',
      '//folder/any.php.file.html',
      '/filename.php/',
      '/index?f=filename.php/',
    ])
      expect(A(php, 'FooBot', 'http://foo.bar' + p)).toBe(true);
    for (const p of ['/bar', '/php/', '/index?php', '/windows.PHP'])
      expect(A(php, 'FooBot', 'http://foo.bar' + p)).toBe(false);

    const phpEnd = 'user-agent: FooBot\ndisallow: /\nallow: /*.php$\n';
    for (const p of ['/filename.php', '/folder/filename.php'])
      expect(A(phpEnd, 'FooBot', 'http://foo.bar' + p)).toBe(true);
    for (const p of [
      '/bar',
      '/filename.php?parameters',
      '/filename.php/',
      '/filename.php5',
      '/php/',
      '/filename?php',
      '/aaaphpaaa',
      '//windows.PHP',
    ])
      expect(A(phpEnd, 'FooBot', 'http://foo.bar' + p)).toBe(false);

    const fishPhp = 'user-agent: FooBot\ndisallow: /\nallow: /fish*.php\n';
    expect(A(fishPhp, 'FooBot', 'http://foo.bar/bar')).toBe(false);
    expect(A(fishPhp, 'FooBot', 'http://foo.bar/fish.php')).toBe(true);
    expect(A(fishPhp, 'FooBot', 'http://foo.bar/fishheads/catfish.php?parameters')).toBe(true);
    expect(A(fishPhp, 'FooBot', 'http://foo.bar/Fish.PHP')).toBe(false);

    expect(A('user-agent: FooBot\nallow: /p\ndisallow: /\n', 'FooBot', 'http://example.com/page')).toBe(true);
    expect(
      A('user-agent: FooBot\nallow: /folder\ndisallow: /folder\n', 'FooBot', 'http://example.com/folder/page'),
    ).toBe(true);
    expect(A('user-agent: FooBot\nallow: /page\ndisallow: /*.htm\n', 'FooBot', 'http://example.com/page.htm')).toBe(
      false,
    );
    const root = 'user-agent: FooBot\nallow: /$\ndisallow: /\n';
    expect(A(root, 'FooBot', 'http://example.com/')).toBe(true);
    expect(A(root, 'FooBot', 'http://example.com/page.html')).toBe(false);
  });
});

describe('google/robotstxt: parsing', () => {
  const directives = (r: ReturnType<typeof parseRobotsTxt>) =>
    r.groups.reduce((n, g) => n + g.agents.length + g.rules.length, 0) + r.sitemaps.length;

  it('LinesNumbersAreCountedCorrectly', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const body = ['User-Agent: foo', 'Allow: /some/path', 'User-Agent: bar', '', '', 'Disallow: /'].join(eol) + eol;
      const r = parseRobotsTxt(body);
      expect(directives(r)).toBe(4);
      expect(r.groups.at(-1)?.rules.at(-1)?.line).toBe(6);
    }
    const mixed = parseRobotsTxt('User-Agent: foo\nAllow: /some/path\r\nUser-Agent: bar\n\r\n\nDisallow: /');
    expect(directives(mixed)).toBe(4);
    expect(mixed.groups.at(-1)?.rules.at(-1)?.line).toBe(6);
  });

  it('UTF8ByteOrderMarkIsSkipped', () => {
    const full = parseRobotsTxt('﻿User-Agent: foo\nAllow: /AnyValue\n');
    expect(directives(full)).toBe(2);
    expect(full.invalidLines).toHaveLength(0);
    const middle = parseRobotsTxt('User-Agent: foo\n﻿Allow: /AnyValue\n');
    expect(directives(middle)).toBe(1);
    expect(middle.invalidLines).toHaveLength(1);
  });

  it('NonStandardLineExample_Sitemap', () => {
    const loc = 'http://foo.bar/sitemap.xml';
    const after = parseRobotsTxt(`User-Agent: foo\nAllow: /some/path\nUser-Agent: bar\n\n\nSitemap: ${loc}\n`);
    expect(after.sitemaps.map((s) => s.url)).toEqual([loc]);
    const before = parseRobotsTxt(`Sitemap: ${loc}\nUser-Agent: foo\nAllow: /some/path\nUser-Agent: bar\n\n\n`);
    expect(before.sitemaps.map((s) => s.url)).toEqual([loc]);
  });
});
