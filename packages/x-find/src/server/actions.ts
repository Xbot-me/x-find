/**
 * The weekly loop: turn what x-find knows (crawl findings, page facts, URL Inspection, Search Console) into a short,
 * ranked list of things to do, notice when they are done, and say where the site stands.
 *
 * Every action names its evidence and the official document behind it. Actions x-find can verify (the next crawl or
 * URL Inspection shows the fix) close themselves; the others close when the owner marks them done.
 */
import type { PageFact } from '../core/pagefacts.js';
import { SRC } from '../core/sources.js';
import type { Finding } from '../core/types.js';
import type { IndexingView } from './indexing.js';
import { INDEXING_SRC } from './indexing.js';

export const ACTION_SRC = {
  starterGuide: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
  trafficDrops: 'https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops',
} as const;

export type Who = 'you' | 'developer' | 'writer';

export interface ActionPage {
  url: string;
  /** Opens the page in Search Console's URL Inspection, where "Request indexing" is. */
  inspectUrl?: string | undefined;
  note?: string | undefined;
}

export interface Action {
  /** Stable across days, so the same problem keeps the same action. */
  key: string;
  /** Lower comes first: 0 blockers, 1 reachability, 2 indexing, 3 search opportunities, 4 improvements. */
  tier: number;
  /** Ordering within a tier (pages affected, impressions). */
  weight: number;
  title: string;
  why: string;
  steps: string[];
  who: Who;
  doneWhen: string;
  /**
   * True when the action going away means it's done (the crawl or URL Inspection no longer finds the problem).
   * False for advice from Search Console numbers: when the rule stops matching, the action expires instead.
   */
  closesItself: boolean;
  /** Where its evidence comes from; an action only closes when that data was refreshed successfully. */
  source: 'crawl' | 'search';
  sources: string[];
  pages: ActionPage[];
  query?: string | undefined;
}

export interface QueryTotals {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface Opportunities {
  top10Ctr: number;
  closeToPageOne: { query: string; page: string | null; impressions: number; clicks: number; position: number }[];
  lowCtr: { query: string; page: string | null; impressions: number; clicks: number; ctr: number; position: number }[];
  losing: { page: string; clicks: number; prevClicks: number }[];
}

/** Pages people rarely search for; not worth a limited "Request indexing". */
const LEGAL = /\/(privacy|terms|cookies?|legal|imprint|impressum|disclaimer|gdpr|accessibility)(-[a-z-]+)?\/?$/i;

export interface ActionInput {
  origin: string;
  /** Names the site goes by (site name, brand name from config); searches for them are "brand" searches. */
  brandNames: string[];
  /** Findings of the latest successful check; null when there's none yet. */
  findings: Finding[] | null;
  pages: PageFact[] | null;
  /** Null when Search Console isn't connected or hasn't synced. */
  indexing: IndexingView | null;
  search: {
    cur: QueryTotals[];
    prev: QueryTotals[];
    /** All impressions in the last 28 days, including searches Google doesn't report one by one. */
    totalImpressions: number;
    opportunities: Opportunities;
  } | null;
}

export interface Stage {
  level: 0 | 1 | 2 | 3 | 4;
  name: string;
  job: string;
  /** The numbers the stage was decided from. */
  facts: string[];
}

const STAGES: Record<Stage['level'], { name: string; job: string }> = {
  0: { name: 'Getting into Google', job: 'Remove what stops Google, and get the pages indexed.' },
  1: { name: 'New in Google', job: 'Pages for what buyers search for, and first links from other sites.' },
  2: { name: 'Showing up', job: 'Make pages match the searches they already appear for.' },
  3: { name: 'Close to page one', job: 'Targeted improvements, and titles that get clicked.' },
  4: { name: 'Growing', job: 'More pages around what works; protect pages that slip.' },
};

const pathOf = (url: string, origin: string) => (url.startsWith(origin) ? url.slice(origin.length) || '/' : url);
const n = (x: number) => x.toLocaleString('en-US');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** Brand words: each name squashed ("brightleafstudio"), plus a name's first word when it's distinctive ("brightleaf"). */
export function brandTokens(names: string[], origin: string): string[] {
  const out = new Set<string>();
  const host = new URL(origin).hostname.replace(/^www\./, '');
  for (const name of [...names, host.split('.')[0]!]) {
    const t = squash(name);
    if (t.length >= 4) out.add(t);
    const first = squash(name.split(/\s+/)[0] ?? '');
    if (first.length >= 5) out.add(first);
  }
  return [...out];
}

/** A search for the site itself: it contains a brand word, or is a near-miss spelling of one ("britleaf studio"). */
export function isBrandQuery(query: string, tokens: string[]): boolean {
  const q = squash(query);
  if (!q) return false;
  return tokens.some((t) => q.includes(t) || distance(q, t) <= Math.max(1, Math.floor(t.length / 5)));
}

export function siteStage(input: ActionInput, blockers: number): Stage | null {
  const ix = input.indexing;
  if (!input.search || !ix) return null;
  const tokens = brandTokens(input.brandNames, input.origin);
  const sum = (rows: QueryTotals[], brand: boolean, k: 'clicks' | 'impressions') =>
    rows.filter((r) => isBrandQuery(r.query, tokens) === brand).reduce((t, r) => t + r[k], 0);
  const nbImpr = sum(input.search.cur, false, 'impressions');
  const bImpr = sum(input.search.cur, true, 'impressions');
  const nbClicks = sum(input.search.cur, false, 'clicks');
  const nbClicksPrev = sum(input.search.prev, false, 'clicks');
  const near = input.search.opportunities.closeToPageOne.filter((o) => !isBrandQuery(o.query, tokens));
  const facts = [
    `${ix.indexed} of ${ix.inspected} inspected pages you want in search are indexed`,
    `${n(input.search.totalImpressions)} impressions in the last 28 days. Of the searches Google reports one by one, ${n(bImpr)} were for your name and ${n(nbImpr)} for anything else`,
  ];
  let level: Stage['level'];
  if (blockers > 0 || (ix.inspected > 0 && ix.indexed / ix.inspected < 0.5)) {
    level = 0;
    if (blockers) facts.unshift(`${blockers} problem${blockers > 1 ? 's' : ''} that can stop pages being found`);
  } else if (nbImpr < 100) level = 1;
  else if (nbClicks >= 10 && nbClicks >= nbClicksPrev * 1.2) {
    level = 4;
    facts.push(`${n(nbClicks)} clicks from other searches (28 days before: ${n(nbClicksPrev)})`);
  } else if (near.length) {
    level = 3;
    facts.push(`${near.length} search${near.length > 1 ? 'es' : ''} at positions 8–20 with 50+ impressions`);
  } else level = 2;
  return { level, ...STAGES[level], facts };
}

function list(urls: string[], origin: string, max = 8): string {
  const shown = urls.slice(0, max).map((u) => pathOf(u, origin));
  return urls.length > max ? `${shown.join(', ')} and ${urls.length - max} more` : shown.join(', ');
}

/** Pages with the detail the check recorded ("on / (found: /work/)" for a link without text pointing to /work/). */
function where(fs: Finding[], origin: string, max = 6): string {
  const parts = fs
    .filter((f) => f.url)
    .slice(0, max)
    .map(
      (f) => `on ${pathOf(f.url!, origin)}${f.evidence ? ` (found: ${f.evidence.split('\n')[0]!.slice(0, 120)})` : ''}`,
    );
  return fs.length > max ? `${parts.join(', ')} and ${fs.length - max} more` : parts.join(', ');
}

/** All actions that apply now, ranked. The caller stores them and picks the top three for the week. */
export function candidateActions(input: ActionInput): { actions: Action[]; stage: Stage | null } {
  const { origin } = input;
  const actions: Action[] = [];

  // Tier 0 and 4: crawl findings, one action per check. Errors block; warnings improve.
  const byCheck = new Map<string, Finding[]>();
  for (const f of input.findings ?? []) {
    if (f.severity === 'notice') continue;
    const k = `${f.checkId}:${f.severity}`;
    byCheck.set(k, [...(byCheck.get(k) ?? []), f]);
  }
  for (const [k, fs] of byCheck) {
    const f = fs[0]!;
    const urls = [...new Set(fs.map((x) => x.url).filter((u): u is string => !!u))];
    const blocking = f.severity === 'error';
    actions.push({
      key: `finding:${k}`,
      tier: blocking ? 0 : 4,
      weight: fs.length,
      title: `Fix: ${f.title.charAt(0).toLowerCase()}${f.title.slice(1)}${urls.length > 1 ? ` (${urls.length} pages)` : ''}`,
      why: blocking
        ? `x-find found this on ${fs.length === 1 ? 'one page' : `${fs.length} pages`}. It can stop search engines from finding or understanding them. ${f.message}`
        : `Not blocking, but worth fixing. ${fs.length === 1 ? 'One page' : `${fs.length} pages`}: ${f.message}`,
      steps: [f.fix, ...(urls.length ? [`Where: ${where(fs, origin)}.`] : []), 'Then click "Check now" to confirm.'],
      who: 'developer',
      doneWhen: 'The next check no longer finds it.',
      closesItself: true,
      source: 'crawl',
      sources: f.sources,
      pages: urls.slice(0, 20).map((url) => ({ url })),
    });
  }

  // Tier 1: pages meant to be in search that no chain of links from the home page reaches.
  const unreachable = (input.pages ?? []).filter((p) => !p.notIndexable && p.depth === null);
  if (unreachable.length) {
    const filterLinks = (input.pages ?? []).some((p) => p.notIndexable === 'canonical' && p.url.includes('?'));
    actions.push({
      key: 'reach',
      tier: 1,
      weight: unreachable.length,
      title: `Link ${unreachable.length === 1 ? 'a page' : `${unreachable.length} pages`} from your home page or menu`,
      why: `Google finds pages by following links. ${list(
        unreachable.map((p) => p.url),
        origin,
      )} can't be reached by following links from your home page, so Google can only learn about ${unreachable.length === 1 ? 'it' : 'them'} from the sitemap.`,
      steps: [
        `Add a link to ${unreachable.length === 1 ? 'this page' : 'each of these pages'} from the home page, the main menu or a page the home page links to.`,
        ...(filterLinks
          ? [
              'Link to the page itself, not to a filtered version with ?… in the address: those point Google to another page.',
            ]
          : []),
        'Use link text that says what the page is about.',
        'Then click "Check now" to confirm.',
      ],
      who: 'developer',
      doneWhen: 'The next check reaches every page from the home page.',
      closesItself: true,
      source: 'crawl',
      sources: [SRC.links],
      pages: unreachable.map((p) => ({ url: p.url })),
    });
  }

  // Tier 2: wanted pages Google hasn't crawled yet, with nothing on the page that explains it.
  if (input.indexing) {
    const facts = new Map((input.pages ?? []).map((p) => [p.url, p]));
    const all = input.indexing.groups
      .filter((g) => /unknown to google|discovered/i.test(g.state))
      .flatMap((g) => g.pages.map((p) => ({ ...p, state: g.state })))
      .filter((p) => !p.reasons.length);
    // Requests are limited, so spend them on pages people would search for: legal pages are left out, and the
    // pages with the most text come first (menu and footer links can't tell a service page from a privacy policy).
    const waiting = all
      .filter((p) => !LEGAL.test(new URL(p.url).pathname))
      .sort(
        (a, b) =>
          (facts.get(b.url)?.words ?? 0) - (facts.get(a.url)?.words ?? 0) ||
          (facts.get(a.url)?.depth ?? 99) - (facts.get(b.url)?.depth ?? 99) ||
          a.url.localeCompare(b.url),
      );
    if (waiting.length) {
      const top = waiting.slice(0, 5);
      actions.push({
        key: 'index-request',
        tier: 2,
        weight: waiting.length,
        title: `Ask Google to index your ${top.length === 1 ? 'most important page' : `${top.length} most important pages`}`,
        why: `Google hasn't crawled ${all.length === 1 ? 'one page' : `${all.length} pages`} you want in search yet, and nothing on ${all.length === 1 ? 'it' : 'them'} explains why. Asking Google directly can bring the first crawl forward. These are the pages with the most content; legal pages like privacy and terms are left out.`,
        steps: [
          'Open each page below in Search Console (the link goes straight to URL Inspection).',
          'Click "Request indexing" and wait for the check to finish.',
          'Google limits requests per day; if it refuses, do the rest tomorrow.',
          'Mark this done when you have requested them. x-find follows each page until Google indexes it.',
        ],
        who: 'you',
        doneWhen: 'Closes by itself when Google has indexed these pages. Mark it done once you have requested them.',
        closesItself: true,
        source: 'search',
        sources: [INDEXING_SRC.urlInspection],
        pages: top.map((p) => ({ url: p.url, inspectUrl: p.inspectUrl ?? undefined, note: p.state })),
      });
    }
  }

  // Tier 3: Search Console opportunity rules.
  const opp = input.search?.opportunities;
  for (const o of opp?.closeToPageOne ?? []) {
    if (!o.page) continue;
    actions.push({
      key: `near:${o.query}`,
      tier: 3,
      weight: o.impressions,
      query: o.query,
      title: `Improve ${pathOf(o.page, origin)} for "${o.query}"`,
      why: `It shows at position ${o.position.toFixed(1)} for "${o.query}" (${n(o.impressions)} impressions in 28 days, ${n(o.clicks)} clicks). Page one is positions 1–10.`,
      steps: [
        `Make the title say clearly what the page offers someone searching "${o.query}", and answer it near the top of the page.`,
        'Add what someone searching this would want next if it is missing: examples, prices, process, how to start.',
        'Link to the page from your other pages that mention this topic, with link text that says what it is.',
        'Mark this done when the change is live.',
      ],
      who: 'writer',
      doneWhen: 'You mark it done; x-find then follows this search for 4 weeks.',
      closesItself: false,
      source: 'search',
      sources: [ACTION_SRC.starterGuide, INDEXING_SRC.helpfulContent],
      pages: [{ url: o.page }],
    });
  }
  for (const o of opp?.lowCtr ?? []) {
    if (!o.page) continue;
    actions.push({
      key: `ctr:${o.query}`,
      tier: 3,
      weight: o.impressions,
      query: o.query,
      title: `Rewrite the title and description of ${pathOf(o.page, origin)}`,
      why: `For "${o.query}" it is in the top 10 (position ${o.position.toFixed(1)}) but only ${pct(o.ctr)} of ${n(o.impressions)} people click, under half of your top-10 average (${pct(opp!.top10Ctr)}).`,
      steps: [
        `Write a title that says what the page offers someone searching "${o.query}", in their words.`,
        'Write a meta description that says why to choose this page: what they get, for whom.',
        'Mark this done when the change is live.',
      ],
      who: 'writer',
      doneWhen: 'You mark it done; x-find then compares the click rate for 4 weeks.',
      closesItself: false,
      source: 'search',
      sources: [SRC.title, SRC.snippet],
      pages: [{ url: o.page }],
    });
  }
  for (const o of opp?.losing ?? []) {
    actions.push({
      key: `losing:${o.page}`,
      tier: 3,
      weight: o.prevClicks - o.clicks,
      title: `Find out why ${pathOf(o.page, origin)} lost clicks`,
      why: `Clicks fell from ${n(o.prevClicks)} to ${n(o.clicks)} compared with the 28 days before.`,
      steps: [
        'Check whether the page changed recently: title, text, address, or a redirect.',
        'Open it in URL Inspection to confirm it is still indexed.',
        'In Search Console → Performance, filter by this page and compare the two periods: fewer searches overall (season, news) or a lower position?',
        'Mark this done when you know the cause.',
      ],
      who: 'you',
      doneWhen: 'You mark it done.',
      closesItself: false,
      source: 'search',
      sources: [ACTION_SRC.trafficDrops],
      pages: [{ url: o.page }],
    });
  }

  actions.sort((a, b) => a.tier - b.tier || b.weight - a.weight || a.key.localeCompare(b.key));
  const blockers = actions.filter((a) => a.tier === 0).length;
  return { actions, stage: siteStage(input, blockers) };
}
