/**
 * The link map on the details page: how pages connect to the home page, which ones links can't reach (only the
 * sitemap leads there), which links are broken, and which pages are kept out of search on purpose. Built from the
 * stored check only (page facts and findings), so it costs nothing extra.
 */
import type { PageFact } from '../core/pagefacts.js';
import type { Finding, NotIndexableReason } from '../core/types.js';

export interface MapPage {
  url: string;
  path: string;
  title: string | null;
  /** Clicks from the home page. */
  depth: number | null;
}

export interface MapSection {
  /** "Work", "Services", or "Pages" for top-level pages. */
  name: string;
  path: string;
  pages: MapPage[];
}

export interface LinkMap {
  home: { url: string; title: string | null; linksTo: number; linkedFrom: number } | null;
  /** Pages listed in the sitemap. */
  sitemap: number;
  /** Reachable pages that are meant to be in search, grouped by their first path segment. */
  sections: MapSection[];
  /** Meant to be in search, but no chain of links from the home page leads there. */
  unreachable: MapPage[];
  broken: { from: string; to: string; text: string | null }[];
  keptOut: (MapPage & { reason: NotIndexableReason; canonical: string | null })[];
}

const pathOf = (url: string, origin: string) => (url.startsWith(origin) ? url.slice(origin.length) || '/' : url);

function sectionOf(path: string): { key: string; name: string } {
  const seg = path.split('?')[0]!.split('/').filter(Boolean);
  if (seg.length <= 1) return { key: '', name: 'Pages' };
  const s = seg[0]!.replace(/[-_]+/g, ' ');
  return { key: `/${seg[0]}/`, name: s.charAt(0).toUpperCase() + s.slice(1) };
}

export function linkMap(origin: string, pages: PageFact[] | null, findings: Finding[] | null): LinkMap | null {
  if (!pages?.length) return null;
  const homeUrl = `${origin}/`;
  const toPage = (p: PageFact): MapPage => ({
    url: p.url,
    path: pathOf(p.url, origin),
    title: p.title,
    depth: p.depth,
  });
  const home = pages.find((p) => p.url === homeUrl) ?? null;

  const sections = new Map<string, MapSection>();
  const unreachable: MapPage[] = [];
  const keptOut: LinkMap['keptOut'] = [];
  for (const p of pages) {
    if (p.url === homeUrl) continue;
    if (p.notIndexable) {
      keptOut.push({ ...toPage(p), reason: p.notIndexable, canonical: p.canonical });
      continue;
    }
    if (p.depth === null) {
      unreachable.push(toPage(p));
      continue;
    }
    const { key, name } = sectionOf(pathOf(p.url, origin));
    let s = sections.get(key);
    if (!s) sections.set(key, (s = { name, path: key || '/', pages: [] }));
    s.pages.push(toPage(p));
  }
  for (const s of sections.values())
    s.pages.sort((a, b) => (a.depth ?? 99) - (b.depth ?? 99) || a.path.localeCompare(b.path));

  const broken = (findings ?? [])
    .filter((f) => f.checkId === 'link-broken-internal' && f.url)
    .map((f) => {
      const m = /^(\S+)(?: \("(.*)"\))?$/.exec(f.evidence ?? '');
      return { from: pathOf(f.url!, origin), to: m?.[1] ?? '?', text: m?.[2] ?? null };
    });

  return {
    home: home
      ? {
          url: home.url,
          title: home.title,
          linksTo: pages.filter((p) => p.depth === 1).length,
          linkedFrom: home.inLinks,
        }
      : null,
    sitemap: pages.filter((p) => p.inSitemap).length,
    // Biggest sections first; top-level pages last.
    sections: [...sections.values()].sort(
      (a, b) => (a.path === '/' ? 1 : 0) - (b.path === '/' ? 1 : 0) || b.pages.length - a.pages.length,
    ),
    unreachable: unreachable.sort((a, b) => a.path.localeCompare(b.path)),
    broken,
    keptOut: keptOut.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
