import { describe, expect, it } from 'vitest';
import { matchRobots, parseRobotsTxt } from '../src/core/robots/parse.js';

describe('robots.txt lint data', () => {
  it('reports rules before any user-agent, unknown fields, typos and other fields', () => {
    const r = parseRobotsTxt(
      'Disallow: /x\nUser-agent: *\nDisalow: /y\nCrawl-delay: 5\nFoo: bar\nContent-Signal: search=yes, ai-train=no\n',
    );
    expect(r.rulesOutsideGroup.map((l) => l.line)).toEqual([1]);
    expect(r.acceptedTypos.map((l) => l.field)).toEqual(['Disalow']);
    expect(r.otherFields.map((f) => f.field)).toEqual(['crawl-delay', 'content-signal']);
    expect(r.invalidLines.map((l) => l.reason)).toEqual(['unknown field "Foo"']);
    expect(r.groups[0]!.contentSignals[0]!.value).toBe('search=yes, ai-train=no');
  });

  it('says which rule decided', () => {
    const r = parseRobotsTxt('User-agent: *\nDisallow: /private/\nAllow: /private/ok\n');
    const m = matchRobots(r, 'Googlebot', 'https://e.com/private/x');
    expect(m).toMatchObject({ allowed: false, rule: { type: 'disallow', line: 2 } });
  });

  it('ignores content after 500 KiB', () => {
    const big = 'User-agent: *\n' + '#'.repeat(600 * 1024) + '\nDisallow: /\n';
    const r = parseRobotsTxt(big);
    expect(r.bytes).toBeGreaterThan(500 * 1024);
    expect(r.groups[0]!.rules).toHaveLength(0);
  });
});
