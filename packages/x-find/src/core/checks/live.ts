import { SRC } from '../sources.js';
import type { Issue, SiteCheck } from '../types.js';
import { pathOf } from './util.js';

export const liveChecks: SiteCheck[] = [
  {
    id: 'http-status',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    live: true,
    title: 'Page returns an error',
    fix: 'Fix or redirect the URL, and update links that point to it. 4xx pages drop out of the index; repeated 5xx slow crawling of the whole site.',
    sources: [SRC.http],
    run({ site }) {
      const failed = [...site.failedPages.entries()].filter(([, h]) => h.status >= 400 || h.status === 0);
      const issues: Issue[] = failed.map(([url, h]) =>
        h.status === 0
          ? {
              url,
              message: 'Could not load it after three tries (timeout or network error). Check that it loads quickly.',
              severity: 'warning' as const,
            }
          : { url, message: `HTTP ${h.status}.` },
      );
      return { subjects: site.pages.length + site.failedPages.size, issues };
    },
  },
  {
    id: 'redirect-chain',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    live: true,
    title: 'Redirect chain or temporary redirect',
    fix: 'Redirect in one hop to the final URL, with 301 or 308 for permanent moves (302/307 are weaker signals). Then link to the final URL directly.',
    sources: [SRC.http, SRC.canonical],
    run({ site }) {
      // Every requested URL that redirected is recorded in failedPages with its hops and final URL.
      const issues: Issue[] = [];
      const redirected = [...site.failedPages.values()].filter((h) => h.redirects.length > 0);
      for (const h of redirected) {
        const hops = h.redirects;
        const temporary = hops.filter((x) => x.status === 302 || x.status === 307 || x.status === 303);
        const chain = hops.map((x) => `${pathOf(x.url)} (${x.status})`).join(' → ') + ` → ${pathOf(h.finalUrl)}`;
        if (hops.length > 1)
          issues.push({
            url: hops[0]!.url,
            message: `${hops.length} redirects before the page loads.`,
            evidence: chain,
            key: 'chain',
          });
        else if (temporary.length)
          issues.push({
            url: hops[0]!.url,
            message: `Temporary redirect (${temporary[0]!.status}).`,
            evidence: chain,
            key: 'temp',
          });
      }
      return { subjects: redirected.length, issues };
    },
  },
  {
    id: 'canonical-header-mismatch',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    live: true,
    title: 'Canonical header and HTML canonical disagree',
    fix: 'Declare the canonical in one place, or make the Link header and the <link rel="canonical"> name the same URL.',
    sources: [SRC.canonical],
    run({ site }) {
      const issues: Issue[] = [];
      let subjects = 0;
      for (const p of site.pages) {
        const header = p.http?.headers['link'];
        const m = header ? /<([^>]+)>\s*;\s*rel="?canonical"?/i.exec(header) : null;
        const html = p.links.find((l) => l.inHead && l.rel.includes('canonical'))?.href;
        if (!m || !html) continue;
        subjects++;
        const a = new URL(m[1]!, p.url).href;
        const b = new URL(html, p.url).href;
        if (a !== b)
          issues.push({
            url: p.url,
            message: 'Link header and HTML name different canonicals.',
            evidence: `${a} vs ${b}`,
          });
      }
      return { subjects, issues };
    },
  },
  {
    id: 'soft-404',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    live: true,
    title: 'Missing pages return 200',
    fix: 'Return a real 404 status for URLs that do not exist. Otherwise every typo URL looks like a duplicate page.',
    sources: [SRC.http],
    run({ site }) {
      const s = site.live?.soft404;
      if (!s) return { subjects: 0, issues: [] };
      return {
        subjects: 1,
        issues:
          s.status >= 200 && s.status < 300
            ? [{ url: s.url, message: `A made-up URL returned HTTP ${s.status}.` }]
            : [],
      };
    },
  },
  {
    id: 'host-redirect',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    live: true,
    title: 'Other host or protocol does not redirect permanently',
    fix: 'Redirect http:// and the www/non-www twin to the main URL with a 301 or 308.',
    sources: [SRC.canonical, SRC.http],
    run({ site }) {
      const variants = site.live?.hostVariants ?? [];
      const issues: Issue[] = [];
      let subjects = 0;
      for (const v of variants) {
        if (v.status === null) continue; // host doesn't answer (e.g. no DNS for www): nothing to fix
        subjects++;
        const target = v.location ? new URL(v.location, v.url).origin : null;
        if (v.status >= 200 && v.status < 300)
          issues.push({
            url: v.url,
            message: `Serves the site (HTTP ${v.status}) instead of redirecting.`,
            key: v.url,
          });
        else if (v.status >= 300 && v.status < 400) {
          if (target !== site.origin)
            issues.push({ url: v.url, message: `Redirects to ${v.location}, not ${site.origin}.`, key: v.url });
          else if (v.status !== 301 && v.status !== 308)
            issues.push({ url: v.url, message: `Redirect is temporary (HTTP ${v.status}).`, key: v.url });
        }
      }
      return { subjects, issues };
    },
  },
  {
    id: 'trailing-slash-duplicate',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    live: true,
    title: 'Trailing-slash variant is served or redirects temporarily',
    fix: 'Redirect one form to the other with a permanent 301/308, so only one URL serves each page and signals consolidate.',
    sources: [SRC.canonical, SRC.http],
    run({ site }) {
      const t = site.live?.trailingSlash;
      if (!t) return { subjects: 0, issues: [] };
      const ok = (n: number) => n >= 200 && n < 300;
      if (ok(t.status) && ok(t.twinStatus))
        return {
          subjects: 1,
          issues: [{ url: t.twin, message: `Both ${pathOf(t.url)} and ${pathOf(t.twin)} return 200.` }],
        };
      if ([302, 303, 307].includes(t.twinStatus))
        return {
          subjects: 1,
          issues: [{ url: t.twin, message: `${pathOf(t.twin)} redirects with a temporary HTTP ${t.twinStatus}.` }],
        };
      return { subjects: 1, issues: [] };
    },
  },
];
