/**
 * Facts about each crawled page that bear on whether Google finds and indexes it. They are stored with each run so
 * the service can set them next to what Search Console's URL Inspection says, without keeping the whole crawl.
 */
import { buildIndex } from './analyze.js';
import type { NotIndexableReason, ResolvedConfig, SiteModel } from './types.js';

export interface PageFact {
  url: string;
  /** Null when the page is meant to be in search. */
  notIndexable: NotIndexableReason | null;
  /** Where the canonical points, when it points to another URL. */
  canonical: string | null;
  /** Other crawled pages with a crawlable link to this one. */
  inLinks: number;
  /** Fewest clicks from the home page following crawlable links; null when no chain of links reaches it. */
  depth: number | null;
  words: number;
  inSitemap: boolean;
  /** The page's <title>, for writing fixes in the site's own words. */
  title: string | null;
}

export function pageFacts(site: SiteModel, config: ResolvedConfig): PageFact[] {
  const index = buildIndex(site, config);
  const { norm } = index;

  // Breadth-first from the home page over crawlable internal links.
  const depth = new Map<string, number>();
  const home = norm(`${site.origin}/`);
  if (index.pageByUrl.has(home)) {
    depth.set(home, 0);
    const queue = [home];
    for (let u = queue.shift(); u !== undefined; u = queue.shift()) {
      const page = index.pageByUrl.get(u);
      if (!page) continue;
      for (const a of page.anchors) {
        if (!a.url || (!a.url.startsWith(`${site.origin}/`) && a.url !== site.origin)) continue;
        const t = norm(a.url);
        if (depth.has(t)) continue;
        depth.set(t, depth.get(u)! + 1);
        queue.push(t);
      }
    }
  }

  return site.pages.map((page) => {
    const n = norm(page.url);
    const reason = index.notIndexableReason(page);
    return {
      url: page.url,
      notIndexable: reason,
      canonical: reason === 'canonical' ? index.canonicalOf(page) : null,
      inLinks: index.inbound.get(n)?.size ?? 0,
      depth: depth.get(n) ?? null,
      words: page.wordCount,
      inSitemap: index.sitemapUrls.has(n),
      title: page.titles[0]?.text.trim() || null,
    };
  });
}
