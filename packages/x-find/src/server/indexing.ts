/**
 * "Is the site in Google, and if not, why?" Sets Search Console's URL Inspection result for each page next to what
 * the crawl knows about that page, and next to the site's sitemaps and age in Search Console.
 *
 * Rules, not guesses: every reason is a fact x-find measured or Google reported, and each cites the Google document
 * that explains it. When nothing measurable explains a missing page, the view says so instead of inventing a cause.
 */
import type { PageFact } from '../core/pagefacts.js';
import { SRC } from '../core/sources.js';
import type { SitemapStatus } from '../connectors/google.js';

/** Google's documents for the states and reasons below. */
export const INDEXING_SRC = {
  pageIndexing: 'https://support.google.com/webmasters/answer/7440203',
  urlInspection: 'https://support.google.com/webmasters/answer/9012289',
  helpfulContent: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
  sitemapsReport: 'https://support.google.com/webmasters/answer/7451001',
} as const;

export interface InspectionRow {
  url: string;
  verdict: string | null;
  coverageState: string | null;
  pageFetchState: string | null;
  robotsState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawl: string | null;
  checkedAt: string;
}

export interface IndexingInput {
  now: Date;
  /** URLs meant to be in Google: sitemap URLs and crawled pages that are indexable (from the latest run). */
  urls: string[];
  /** Crawl facts from the latest run; null for runs made before x-find kept them. */
  pages: PageFact[] | null;
  inspections: InspectionRow[];
  /** Sitemaps submitted in Search Console; null when the list hasn't been read. */
  sitemaps: SitemapStatus[] | null;
  /** First day with impressions in Search Console's data, if any. */
  firstImpression: string | null;
  thinContentWords: number;
  /** Builds the Search Console URL Inspection link for a URL. */
  inspectLink?: (url: string) => string;
}

export interface Reason {
  id: string;
  text: string;
  source: string;
}

export interface MissingPage {
  url: string;
  lastCrawl: string | null;
  inspectUrl: string | null;
  reasons: Reason[];
}

export interface StateGroup {
  state: string;
  meaning: string;
  todo: string;
  source: string;
  pages: MissingPage[];
}

export interface IndexingView {
  /** Pages meant to be in Google. */
  meant: number;
  /** Of those, how many URL Inspection has looked at. */
  inspected: number;
  indexed: number;
  /** Inspected pages that aren't indexed. */
  missing: number;
  /** Missing pages with at least one page-level reason. */
  explained: number;
  /** Crawled pages kept out of search on purpose (canonical elsewhere, noindex, …): not counted as missing. */
  notMeant: { count: number; canonical: number; noindex: number; robots: number; status: number };
  states: { state: string; count: number }[];
  groups: StateGroup[];
  /** Site-wide facts that bear on indexing (sitemap submission, age in Google). */
  site: Reason[];
  verdict: string;
}

interface StateInfo {
  test: RegExp;
  meaning: string;
  todo: string;
  source: string;
}

/** Google's coverage states, explained from Google's own help pages. Unknown states fall back to a generic line. */
const STATES: StateInfo[] = [
  {
    test: /unknown to google/i,
    meaning: 'Google has not seen this URL yet.',
    todo: 'Check the sitemap is submitted in Search Console. For the pages that matter most, open URL Inspection and click "Request indexing" (Google limits requests per day).',
    source: INDEXING_SRC.urlInspection,
  },
  {
    test: /discovered.*not indexed/i,
    meaning: 'Google knows the URL but has not crawled it yet. Google schedules crawling itself.',
    todo: 'Nothing to resubmit. Keep the page linked and in the sitemap; for the most important pages, use "Request indexing" in URL Inspection.',
    source: INDEXING_SRC.pageIndexing,
  },
  {
    test: /crawled.*not indexed/i,
    meaning: 'Google crawled the page and chose not to index it for now. Google does not index every page it crawls.',
    todo: 'Make the page clearly useful on its own and different from your other pages, then wait for the next crawl. Resubmitting does not force indexing.',
    source: INDEXING_SRC.pageIndexing,
  },
  {
    test: /duplicate|alternate page/i,
    meaning: 'Google treats this page as a copy of another URL and indexes that one instead.',
    todo: 'If this page should be the one in search, make its content distinct and point its canonical and internal links to it.',
    source: SRC.canonical,
  },
  {
    test: /noindex/i,
    meaning: 'Google found a noindex directive on the page.',
    todo: 'If the page should be in search, remove the noindex (meta robots tag or X-Robots-Tag header).',
    source: SRC.robotsMeta,
  },
  {
    test: /robots\.txt/i,
    meaning: 'robots.txt blocks Googlebot from this page.',
    todo: 'If the page should be in search, allow it in robots.txt.',
    source: SRC.robotsTxt,
  },
  {
    test: /redirect|404|not found|soft 404|server error|5xx|4xx|unauthori[sz]ed|forbidden/i,
    meaning: 'Google could not get the page itself: it redirects or returns an error.',
    todo: 'Make the URL return the page with status 200, or remove it from the sitemap and links if it is gone.',
    source: SRC.http,
  },
];

const FALLBACK: Omit<StateInfo, 'test'> = {
  meaning: "Search Console's reason for this page.",
  todo: 'Open the page in URL Inspection for details.',
  source: INDEXING_SRC.pageIndexing,
};

const stateInfo = (state: string) => STATES.find((s) => s.test.test(state)) ?? FALLBACK;

const DAY = 86_400_000;

/** How long Google says it takes to look at a new site, used to tell "new" from "stuck". */
const YOUNG_DAYS = 90;

const dateOnly = (iso: string) => iso.slice(0, 10);

export function indexingView(input: IndexingInput): IndexingView {
  const facts = new Map((input.pages ?? []).map((p) => [p.url, p]));
  const notMeant = { count: 0, canonical: 0, noindex: 0, robots: 0, status: 0 };
  for (const p of input.pages ?? [])
    if (p.notIndexable) {
      notMeant.count++;
      notMeant[p.notIndexable]++;
    }

  // Older runs listed every crawled URL; drop the ones the crawl says aren't meant to be indexed.
  const meantUrls = [...new Set(input.urls)].filter((u) => !facts.get(u)?.notIndexable);
  const byUrl = new Map(input.inspections.map((i) => [i.url, i]));
  const inspected = meantUrls.map((u) => byUrl.get(u)).filter((i): i is InspectionRow => !!i);
  const indexed = inspected.filter((i) => i.verdict === 'PASS');
  const missingRows = inspected.filter((i) => i.verdict !== 'PASS');

  const stateCounts = new Map<string, number>();
  for (const i of inspected) {
    const st = i.coverageState ?? i.verdict ?? 'Unknown';
    stateCounts.set(st, (stateCounts.get(st) ?? 0) + 1);
  }

  const groups = new Map<string, StateGroup>();
  let explained = 0;
  for (const row of missingRows) {
    const state = row.coverageState ?? row.verdict ?? 'Unknown';
    const reasons = pageReasons(row, facts.get(row.url), input);
    if (reasons.length) explained++;
    let g = groups.get(state);
    if (!g) {
      const info = stateInfo(state);
      g = { state, meaning: info.meaning, todo: info.todo, source: info.source, pages: [] };
      groups.set(state, g);
    }
    g.pages.push({
      url: row.url,
      lastCrawl: row.lastCrawl,
      inspectUrl: input.inspectLink ? input.inspectLink(row.url) : null,
      reasons,
    });
  }
  for (const g of groups.values())
    g.pages.sort((a, b) => b.reasons.length - a.reasons.length || a.url.localeCompare(b.url));

  const site = siteReasons(input);
  const young = site.some((r) => r.id === 'site-young' || r.id === 'site-no-impressions');
  const missing = missingRows.length;
  let verdict: string;
  if (!inspected.length) verdict = 'No page has been inspected yet.';
  else if (!missing) verdict = 'Every inspected page you want in search is in Google.';
  else if (explained === missing) verdict = 'Each missing page has a reason x-find can point to.';
  else {
    const rest =
      explained === 0
        ? 'Nothing on the pages explains it: they are linked, listed in the sitemap and have enough text.'
        : `${explained} of the ${missing} missing pages have a reason x-find can point to; for the others, nothing on the page explains it.`;
    verdict = `${rest} ${
      young
        ? 'The site is new to Google, and Google decides what to crawl and when.'
        : 'Google decides which pages to index and does not index every page.'
    }`;
  }

  return {
    meant: meantUrls.length,
    inspected: inspected.length,
    indexed: indexed.length,
    missing,
    explained,
    notMeant,
    states: [...stateCounts.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
    groups: [...groups.values()].sort((a, b) => b.pages.length - a.pages.length),
    site,
    verdict,
  };
}

function pageReasons(row: InspectionRow, fact: PageFact | undefined, input: IndexingInput): Reason[] {
  const out: Reason[] = [];
  if (!fact) {
    out.push({
      id: 'not-linked',
      text: 'No crawled page links to it (x-find found it only in the sitemap)',
      source: SRC.links,
    });
  } else {
    if (fact.inLinks === 0) out.push({ id: 'not-linked', text: 'No other page links to it', source: SRC.links });
    else if (fact.depth === null)
      out.push({
        id: 'not-reachable',
        text: 'Not reachable by following links from the home page',
        source: SRC.links,
      });
    if (!fact.inSitemap) out.push({ id: 'not-in-sitemap', text: 'Not listed in the sitemap', source: SRC.sitemap });
    if (fact.words < input.thinContentWords)
      out.push({
        id: 'thin',
        text: `Only ${fact.words} words of text`,
        source: INDEXING_SRC.helpfulContent,
      });
  }
  if (row.googleCanonical && row.userCanonical && row.googleCanonical !== row.userCanonical)
    out.push({
      id: 'google-canonical',
      text: `Google chose ${row.googleCanonical} as the canonical`,
      source: SRC.canonical,
    });
  if (row.pageFetchState && !/^(SUCCESSFUL|PAGE_FETCH_STATE_UNSPECIFIED)$/.test(row.pageFetchState))
    out.push({
      id: 'fetch-failed',
      text: `Google's last fetch failed (${row.pageFetchState.toLowerCase().replace(/_/g, ' ')})`,
      source: SRC.http,
    });
  if (row.robotsState === 'DISALLOWED')
    out.push({ id: 'robots-blocked', text: 'robots.txt blocks Googlebot', source: SRC.robotsTxt });
  return out;
}

function siteReasons(input: IndexingInput): Reason[] {
  const out: Reason[] = [];
  if (input.sitemaps) {
    if (!input.sitemaps.length)
      out.push({
        id: 'sitemap-not-submitted',
        text: 'No sitemap is submitted in Search Console. Add it under Search Console → Sitemaps so Google learns every page.',
        source: SRC.sitemap,
      });
    for (const m of input.sitemaps) {
      if (m.errors)
        out.push({
          id: 'sitemap-errors',
          text: `Search Console reports ${m.errors} error${m.errors > 1 ? 's' : ''} in ${m.path}.`,
          source: INDEXING_SRC.sitemapsReport,
        });
      if (m.isPending)
        out.push({
          id: 'sitemap-pending',
          text: `Google has not processed ${m.path} yet${m.lastSubmitted ? ` (submitted ${dateOnly(m.lastSubmitted)})` : ''}.`,
          source: INDEXING_SRC.sitemapsReport,
        });
    }
  }
  if (input.firstImpression) {
    const days = Math.floor((input.now.getTime() - new Date(`${input.firstImpression}T00:00:00Z`).getTime()) / DAY);
    if (days < YOUNG_DAYS)
      out.push({
        id: 'site-young',
        text: `Google first showed this site in search on ${input.firstImpression} (${days} day${days === 1 ? '' : 's'} ago). Google says a new site can take a week or so before crawling starts, and up to a few weeks before some or all of it is crawled.`,
        source: INDEXING_SRC.pageIndexing,
      });
  } else {
    out.push({
      id: 'site-no-impressions',
      text: 'Search Console has no impressions for this site yet. Google says a new site can take a week or so before crawling starts.',
      source: INDEXING_SRC.pageIndexing,
    });
  }
  return out;
}
