/**
 * Real-network test against a site you own or may crawl, named in X_FIND_LIVE_SITE:
 * `X_FIND_LIVE_SITE=https://example.com pnpm test:live`. Skipped when it is not set. It asserts what must hold for any
 * healthy run, not the site's current findings, which change as the site changes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import { runChecks } from '../src/core/run.js';
import { crawlLive } from '../src/node/live.js';
import type { SiteModel } from '../src/core/types.js';

const SITE = process.env['X_FIND_LIVE_SITE'] ?? '';

describe.runIf(process.env['X_FIND_LIVE'] === '1' && SITE !== '')(`live: ${SITE}`, () => {
  // Crawl in beforeAll, not in the describe body: the body runs even when the suite is skipped.
  let site: SiteModel;
  let report: ReturnType<typeof runChecks>;
  beforeAll(async () => {
    site = await crawlLive(SITE, { trailingSlash: 'ignore', maxPages: 80, concurrency: 3 });
    report = runChecks(site, resolveConfig({ site: site.origin }));
  }, 180_000);

  it('crawls the site from its home page and sitemap', () => {
    expect(site.origin).toBe(new URL(SITE).origin);
    expect(site.pages.length).toBeGreaterThan(5);
    expect(site.robotsTxt?.status).toBe(200);
    expect(site.sitemaps.some((s) => s.body)).toBe(true);
  });

  it('runs every check without crashing and measures the live-only ones', () => {
    expect(report.checkErrors).toEqual([]);
    const live = report.checks.filter((c) =>
      ['http-status', 'soft-404', 'host-redirect', 'crawler-ua-blocked'].includes(c.id),
    );
    for (const c of live) expect(c.status, c.id).not.toBe('not-measured');
  });

  it('tests every crawler that has a user agent string', () => {
    const tested = new Set(site.live?.crawlerAccess.map((a) => a.crawlerId));
    expect(tested.size).toBeGreaterThanOrEqual(10);
  });

  it('produces three scores and stable fingerprints', () => {
    expect(report.scores.every((s) => s.score === null || (s.score >= 0 && s.score <= 100))).toBe(true);
    expect(new Set(report.findings.map((f) => f.fingerprint)).size).toBe(report.findings.length);
  });
});
