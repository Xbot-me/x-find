import { isAllowed, ROBOTS_MAX_BYTES } from '../robots/parse.js';
import { isW3cDatetime, parseSitemap, SITEMAP_MAX_BYTES, SITEMAP_MAX_URLS } from '../sitemap/parse.js';
import { SRC } from '../sources.js';
import type { CheckContext, Issue, SiteCheck } from '../types.js';
import { urlState } from './util.js';

const robotsUrl = (ctx: CheckContext) => ctx.site.robotsTxt?.url ?? `${ctx.site.origin}/robots.txt`;
const hasRobots = (ctx: CheckContext) => ctx.site.robotsTxt?.body != null && (ctx.site.robotsTxt.status ?? 200) < 400;

/** Sitemap entries from all urlset sitemaps, with the sitemap they came from. */
function sitemapEntries(ctx: CheckContext) {
  return [...ctx.index.sitemapUrls.entries()].map(([key, v]) => ({
    key,
    url: v.loc,
    sitemap: v.sitemap,
    lastmod: v.lastmod,
  }));
}

export const robotsSitemapChecks: SiteCheck[] = [
  {
    id: 'robotstxt-missing',
    scope: 'site',
    category: 'seo',
    severity: 'notice',
    title: 'No robots.txt',
    fix: 'Add /robots.txt. Without it crawling is unrestricted, which is fine, but it is also where crawlers look for your sitemap.',
    sources: [SRC.robotsTxt],
    run(ctx) {
      return { subjects: 1, issues: hasRobots(ctx) ? [] : [{ url: robotsUrl(ctx), message: 'No robots.txt found.' }] };
    },
  },
  {
    id: 'robotstxt-too-large',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'robots.txt over 500 KiB',
    fix: 'Shorten robots.txt: Google ignores everything after the first 500 KiB.',
    sources: [SRC.robotsTxt],
    run(ctx) {
      if (!hasRobots(ctx)) return { subjects: 0, issues: [] };
      const bytes = ctx.site.robotsTxt!.bytes;
      return {
        subjects: 1,
        issues:
          bytes > ROBOTS_MAX_BYTES
            ? [{ url: robotsUrl(ctx), message: `robots.txt is ${Math.round(bytes / 1024)} KiB.` }]
            : [],
      };
    },
  },
  {
    id: 'robotstxt-invalid-line',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'robots.txt line crawlers may misread',
    fix: 'Write each line as "Field: value" with a known field (User-agent, Allow, Disallow, Sitemap), and put rules after a User-agent line.',
    sources: [SRC.rfc9309, SRC.robotsTxt],
    run(ctx) {
      const r = ctx.index.robots;
      if (!r) return { subjects: 0, issues: [] };
      const issues: Issue[] = [
        ...r.invalidLines.map((l) => ({
          url: robotsUrl(ctx),
          message: `Line ${l.line}: ${l.reason}.`,
          evidence: l.text.trim(),
          key: `line:${l.text.trim()}`,
        })),
        ...r.rulesOutsideGroup.map((l) => ({
          url: robotsUrl(ctx),
          message: `Line ${l.line}: rule before any User-agent line is ignored.`,
          evidence: l.text.trim(),
          key: `outside:${l.text.trim()}`,
        })),
        ...r.acceptedTypos.map((l) => ({
          url: robotsUrl(ctx),
          message: `Line ${l.line}: "${l.field}" is a typo Google tolerates; other crawlers may not.`,
          evidence: l.text.trim(),
          key: `typo:${l.text.trim()}`,
          severity: 'notice' as const,
        })),
      ];
      return { subjects: 1, issues };
    },
  },
  {
    id: 'robotstxt-unsupported-field',
    scope: 'site',
    category: 'seo',
    severity: 'notice',
    title: 'robots.txt field Google ignores',
    fix: 'Nothing to fix if you meant it for other crawlers (e.g. Crawl-delay for Bing). Google ignores these lines.',
    sources: [SRC.robotsTxt],
    run(ctx) {
      const r = ctx.index.robots;
      if (!r) return { subjects: 0, issues: [] };
      const fields = r.otherFields.filter((f) => f.field !== 'content-signal');
      const issues = [...new Set(fields.map((f) => f.field))].map((field) => ({
        url: robotsUrl(ctx),
        message: `"${field}" is ignored by Google.`,
        key: field,
      }));
      return { subjects: 1, issues };
    },
  },
  {
    id: 'robotstxt-sitemap-relative',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Sitemap line is not an absolute URL',
    fix: 'Write the full URL, e.g. "Sitemap: https://example.com/sitemap.xml".',
    sources: [SRC.robotsTxt],
    run(ctx) {
      const r = ctx.index.robots;
      if (!r) return { subjects: 0, issues: [] };
      const issues = r.sitemaps
        .filter((s) => !/^https?:\/\//i.test(s.url))
        .map((s) => ({
          url: robotsUrl(ctx),
          message: `Line ${s.line}: sitemap URL is not absolute.`,
          evidence: s.url,
          key: s.url,
        }));
      return { subjects: r.sitemaps.length, issues };
    },
  },
  {
    id: 'robotstxt-status',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    live: true,
    title: 'robots.txt returns a server error',
    fix: 'Make /robots.txt return 200 (or 404 if you have none). On a 5xx Google stops crawling the whole site.',
    sources: [SRC.robotsTxt],
    run(ctx) {
      const status = ctx.site.robotsTxt?.status;
      if (status === undefined) return { subjects: 0, issues: [] };
      const bad = status >= 500 || status === 429;
      return {
        subjects: 1,
        issues: bad ? [{ url: robotsUrl(ctx), message: `robots.txt returned HTTP ${status}.` }] : [],
      };
    },
  },
  {
    id: 'sitemap-missing',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'No sitemap found',
    fix: 'Publish an XML sitemap of your canonical pages and add a "Sitemap:" line to robots.txt.',
    sources: [SRC.sitemap],
    run(ctx) {
      const found = ctx.site.sitemaps.some((s) => s.body != null && (s.status ?? 200) < 400);
      return {
        subjects: 1,
        issues: found
          ? []
          : [{ message: 'No sitemap in robots.txt or at /sitemap.xml, /sitemap-index.xml or /sitemap_index.xml.' }],
      };
    },
  },
  {
    id: 'sitemap-invalid',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Sitemap cannot be read',
    fix: 'Serve a UTF-8 XML sitemap with a <urlset> or <sitemapindex> root, escape & as &amp;, and make it return 200.',
    sources: [SRC.sitemap, SRC.sitemapsProtocol],
    run(ctx) {
      const issues: Issue[] = [];
      for (const s of ctx.site.sitemaps) {
        if (s.status !== undefined && s.status >= 400) {
          issues.push({ url: s.url, message: `Sitemap returns HTTP ${s.status}.` });
          continue;
        }
        if (s.body == null) {
          issues.push({ url: s.url, message: 'Sitemap listed but not found.' });
          continue;
        }
        const parsed = parseSitemap(s.body);
        for (const e of [...new Set(parsed.errors)].slice(0, 5)) issues.push({ url: s.url, message: e, key: e });
      }
      return { subjects: ctx.site.sitemaps.length, issues };
    },
  },
  {
    id: 'sitemap-too-large',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Sitemap over the size limit',
    fix: 'Split it: at most 50,000 URLs and 50 MB (uncompressed) per sitemap, joined by a sitemap index.',
    sources: [SRC.sitemap],
    run(ctx) {
      const issues: Issue[] = [];
      for (const s of ctx.site.sitemaps) {
        if (s.body == null) continue;
        const n = parseSitemap(s.body).entries.length;
        if (n > SITEMAP_MAX_URLS) issues.push({ url: s.url, message: `${n} URLs (limit 50,000).` });
        if (s.bytes > SITEMAP_MAX_BYTES)
          issues.push({ url: s.url, message: `${Math.round(s.bytes / 1048576)} MB (limit 50 MB).` });
      }
      return { subjects: ctx.site.sitemaps.length, issues };
    },
  },
  {
    id: 'sitemap-url-relative',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Sitemap URL is not absolute',
    fix: 'List full URLs including https:// and the host.',
    sources: [SRC.sitemap],
    run(ctx) {
      const issues: Issue[] = [];
      let subjects = 0;
      for (const s of ctx.site.sitemaps) {
        if (s.body == null) continue;
        for (const e of parseSitemap(s.body).entries) {
          subjects++;
          if (!/^https?:\/\//i.test(e.loc))
            issues.push({ url: s.url, message: 'Relative <loc>.', evidence: e.loc, key: e.loc });
        }
      }
      return { subjects, issues };
    },
  },
  {
    id: 'sitemap-url-other-host',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'Sitemap lists URLs on another host',
    fix: 'List only URLs of this site (same protocol and host), e.g. no www/non-www or http/https mix.',
    sources: [SRC.sitemap],
    run(ctx) {
      const entries = sitemapEntries(ctx).filter((e) => /^https?:\/\//i.test(e.url));
      const issues = entries
        .filter((e) => new URL(e.url).origin !== ctx.site.origin)
        .map((e) => ({ url: e.sitemap, message: `URL on ${new URL(e.url).origin}.`, evidence: e.url, key: e.url }));
      return { subjects: entries.length, issues };
    },
  },
  {
    id: 'sitemap-noindex',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Sitemap lists a noindex page',
    fix: 'Remove noindex pages from the sitemap, or remove the noindex if the page should be found.',
    sources: [SRC.sitemap, SRC.robotsMeta],
    run(ctx) {
      if (ctx.config.staging) return { subjects: 0, issues: [] };
      const entries = sitemapEntries(ctx);
      const issues = entries
        .filter((e) => ctx.index.pageByUrl.get(e.key)?.robots.noindex)
        .map((e) => ({ url: e.url, message: 'Listed in the sitemap but noindex.', evidence: e.sitemap }));
      return { subjects: entries.length, issues };
    },
  },
  {
    id: 'sitemap-non-canonical',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'Sitemap lists a non-canonical URL',
    fix: 'List the canonical URL only (the one the page declares in rel=canonical).',
    sources: [SRC.canonical, SRC.sitemap],
    run(ctx) {
      const entries = sitemapEntries(ctx);
      const issues: Issue[] = [];
      for (const e of entries) {
        const page = ctx.index.pageByUrl.get(e.key);
        if (!page) continue;
        const c = ctx.index.canonicalOf(page);
        if (c && ctx.index.norm(c) !== e.key)
          issues.push({ url: e.url, message: 'Page canonicalises elsewhere.', evidence: c });
      }
      return { subjects: entries.length, issues };
    },
  },
  {
    id: 'sitemap-blocked',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Sitemap lists a URL blocked by robots.txt',
    fix: 'Remove the URL from the sitemap or allow it in robots.txt.',
    sources: [SRC.sitemap, SRC.robotsTxt],
    run(ctx) {
      if (ctx.config.staging) return { subjects: 0, issues: [] };
      const entries = sitemapEntries(ctx);
      const issues = entries
        .filter((e) => !isAllowed(ctx.index.robots, 'Googlebot', e.url))
        .map((e) => ({ url: e.url, message: 'Disallowed for Googlebot in robots.txt.' }));
      return { subjects: entries.length, issues };
    },
  },
  {
    id: 'sitemap-missing-page',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'Indexable page missing from the sitemap',
    fix: 'Add every page you want found to the sitemap (most site generators do this automatically; check its exclusions).',
    sources: [SRC.sitemap],
    run(ctx) {
      const anySitemap = ctx.index.sitemapUrls.size > 0;
      if (!anySitemap) return { subjects: 0, issues: [] };
      const issues = ctx.index.indexable
        .filter((p) => !ctx.index.sitemapUrls.has(ctx.index.norm(p.url)))
        .map((p) => ({ url: p.url, message: 'Not in any sitemap.' }));
      return { subjects: ctx.index.indexable.length, issues };
    },
  },
  {
    id: 'sitemap-url-not-found',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Sitemap lists a URL that does not load',
    fix: 'Remove URLs that 404, error or redirect, and list the final URL instead.',
    sources: [SRC.sitemap],
    run(ctx) {
      const entries = sitemapEntries(ctx).filter((e) => {
        try {
          return new URL(e.url).origin === ctx.site.origin;
        } catch {
          return false;
        }
      });
      const issues: Issue[] = [];
      for (const e of entries) {
        const s = urlState(ctx, e.url);
        if (s.state === 'missing')
          issues.push({ url: e.url, message: 'No page or file for this URL.', evidence: e.sitemap });
        else if (s.state === 'error')
          issues.push({ url: e.url, message: `Returns HTTP ${s.status}.`, evidence: e.sitemap });
        else if (s.state === 'redirect')
          issues.push({
            url: e.url,
            message: `Redirects (HTTP ${s.status}).`,
            evidence: e.sitemap,
            severity: 'warning',
          });
      }
      return { subjects: entries.length, issues };
    },
  },
  {
    id: 'sitemap-lastmod-invalid',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'Invalid sitemap lastmod',
    fix: "Use W3C datetime (e.g. 2026-11-15 or 2026-11-15T10:00:00+00:00) and only real modification dates. Google ignores lastmod it can't trust.",
    sources: [SRC.sitemap],
    run(ctx) {
      const entries = sitemapEntries(ctx).filter((e) => e.lastmod !== null);
      const now = Date.now() + 24 * 3600 * 1000;
      const issues: Issue[] = [];
      for (const e of entries) {
        if (!isW3cDatetime(e.lastmod!))
          issues.push({ url: e.url, message: `lastmod "${e.lastmod}" is not a W3C datetime.` });
        else if (Date.parse(e.lastmod!) > now)
          issues.push({ url: e.url, message: `lastmod ${e.lastmod} is in the future.` });
      }
      // Every entry with the same lastmod usually means the build time, not real modification dates.
      const values = new Set(entries.map((e) => e.lastmod));
      if (entries.length >= 10 && values.size === 1)
        issues.push({
          url: entries[0]!.sitemap,
          message: `All ${entries.length} URLs share lastmod ${[...values][0]}: probably the build time, not real changes.`,
          severity: 'notice',
          key: 'same',
        });
      return { subjects: entries.length, issues };
    },
  },
];
