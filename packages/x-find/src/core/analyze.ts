import { isAllowed, parseRobotsTxt } from './robots/parse.js';
import { parseSitemap } from './sitemap/parse.js';
import type { NotIndexableReason, PageModel, ResolvedConfig, SiteIndex, SiteModel } from './types.js';

export function makeNormalizer(trailingSlash: ResolvedConfig['trailingSlash']) {
  return (url: string): string => {
    try {
      const u = new URL(url);
      u.hash = '';
      u.hostname = u.hostname.toLowerCase();
      if (trailingSlash === 'ignore' && u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.replace(/\/+$/, '');
      }
      return u.href;
    } catch {
      return url;
    }
  };
}

/** The first canonical in <head>, resolved. Canonicals in <body> are ignored by Google, so they don't count here. */
export function canonicalHref(page: PageModel): string | null {
  const link = page.links.find((l) => l.inHead && l.rel.includes('canonical') && l.href);
  const header = page.http?.headers['link'];
  let href = link?.href ?? null;
  if (!href && header) {
    const m = /<([^>]+)>\s*;\s*rel="?canonical"?/i.exec(header);
    if (m) href = m[1]!;
  }
  if (!href) return null;
  try {
    const u = new URL(href.trim(), page.url);
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

export function buildIndex(site: SiteModel, config: ResolvedConfig): SiteIndex {
  const norm = makeNormalizer(config.trailingSlash);
  const pageByUrl = new Map<string, PageModel>();
  for (const p of site.pages) pageByUrl.set(norm(p.url), p);

  const robots =
    site.robotsTxt?.body != null && (site.robotsTxt.status === undefined || site.robotsTxt.status < 400)
      ? parseRobotsTxt(site.robotsTxt.body)
      : null;

  const canonicalOf = (page: PageModel) => canonicalHref(page);

  const notIndexableReason = (page: PageModel): NotIndexableReason | null => {
    if (page.http && (page.http.status < 200 || page.http.status >= 300)) return 'status';
    if (!config.staging) {
      if (page.robots.noindex) return 'noindex';
      if (!isAllowed(robots, 'Googlebot', page.url)) return 'robots';
    }
    const canonical = canonicalOf(page);
    return canonical === null || norm(canonical) === norm(page.url) ? null : 'canonical';
  };
  const isIndexable = (page: PageModel): boolean => notIndexableReason(page) === null;

  const inbound = new Map<string, Set<string>>();
  const origin = site.origin;
  for (const page of site.pages) {
    for (const a of page.anchors) {
      if (!a.url) continue;
      if (!a.url.startsWith(origin + '/') && a.url !== origin) continue;
      const target = norm(a.url);
      if (target === norm(page.url)) continue;
      let set = inbound.get(target);
      if (!set) inbound.set(target, (set = new Set()));
      set.add(page.url);
    }
  }

  const sitemapUrls = new Map<string, { loc: string; sitemap: string; lastmod: string | null }>();
  for (const file of site.sitemaps) {
    if (file.body == null) continue;
    const parsed = parseSitemap(file.body);
    if (parsed.kind !== 'urlset' && parsed.kind !== 'text') continue;
    for (const e of parsed.entries) sitemapUrls.set(norm(e.loc), { loc: e.loc, sitemap: file.url, lastmod: e.lastmod });
  }

  return {
    pageByUrl,
    indexable: site.pages.filter(isIndexable),
    isIndexable,
    notIndexableReason,
    canonicalOf,
    inbound,
    sitemapUrls,
    robots,
    norm,
  };
}
