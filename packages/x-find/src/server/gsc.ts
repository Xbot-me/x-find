/**
 * Search Console sync and the numbers the dashboard shows. Data is stored per site in SQLite; nothing here is
 * estimated: every number is what Search Console returned, and the opportunity rules say which numbers they used.
 */
import { existsSync, readFileSync } from 'node:fs';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  explainGoogleError,
  GoogleAuth,
  inspectLink,
  matchProperty,
  parseServiceAccountKey,
  SearchConsole,
} from '../connectors/google.js';
import type { AnalyticsRow, InspectionResult, SitemapStatus } from '../connectors/google.js';
import { countryName } from '../connectors/countries.js';
import { resolveConfig } from '../core/config.js';
import { indexingView } from './indexing.js';
import type { InspectionRow } from './indexing.js';
import type { SiteRow, Store } from './store.js';

export const KEY_FILE = 'google-service-account.json';

export function keyPath(home: string): string {
  return path.join(home, KEY_FILE);
}

/** Copies a downloaded key into the x-find folder, readable only by this user. */
export async function installKey(home: string, source: string): Promise<{ email: string; path: string }> {
  const key = parseServiceAccountKey(JSON.parse(readFileSync(source, 'utf8')));
  await mkdir(home, { recursive: true });
  const dest = keyPath(home);
  await copyFile(source, dest);
  await chmod(dest, 0o600);
  return { email: key.client_email, path: dest };
}

export function loadClient(home: string, fetchImpl: typeof fetch = fetch): SearchConsole | null {
  const file = keyPath(home);
  if (!existsSync(file)) return null;
  const key = parseServiceAccountKey(JSON.parse(readFileSync(file, 'utf8')));
  return new SearchConsole(new GoogleAuth(key, undefined, fetchImpl), fetchImpl);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

export interface SyncResult {
  property: string;
  days: number;
  queries: number;
  inspected: number;
}

export interface SyncOptions {
  now?: Date;
  /** URL Inspection calls per sync (Google allows 2,000 per property per day). */
  inspectLimit?: number;
  /** Pause between inspection calls per worker (Google allows 600 per minute). */
  inspectDelayMs?: number;
  /** Parallel inspection calls (default 4). */
  inspectConcurrency?: number;
}

function settings(store: Store, siteId: number): { property?: string } {
  const r = store.db
    .prepare(`SELECT settings_json FROM site_connectors WHERE site_id = ? AND kind = 'gsc'`)
    .get(siteId);
  return r ? (JSON.parse(String(r['settings_json'])) as { property?: string }) : {};
}

export function setProperty(store: Store, siteId: number, property: string): void {
  store.db
    .prepare(
      `INSERT INTO site_connectors (site_id, kind, settings_json) VALUES (?, 'gsc', ?)
       ON CONFLICT(site_id, kind) DO UPDATE SET settings_json = excluded.settings_json`,
    )
    .run(siteId, JSON.stringify({ property }));
}

/** Finds (or confirms) the property for a site. Throws an explained error when the account can't see one. */
export async function resolveProperty(store: Store, site: SiteRow, client: SearchConsole): Promise<string> {
  const saved = settings(store, site.id).property;
  if (saved) return saved;
  const properties = (await client.listSites()).map((s) => s.siteUrl);
  const match = matchProperty(properties, site.origin);
  if (!match) {
    throw new Error(
      properties.length
        ? `${client.email} can see ${properties.join(', ')}, but none covers ${site.origin}. Add the email to the right property in Search Console → Settings → Users and permissions.`
        : `${client.email} can't see any Search Console property yet. Add it as a user (Restricted is enough) in Search Console → Settings → Users and permissions.`,
    );
  }
  setProperty(store, site.id, match);
  return match;
}

export async function syncSearchConsole(
  store: Store,
  site: SiteRow,
  client: SearchConsole,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  try {
    const property = await resolveProperty(store, site, client);
    const db = store.db;

    // 1. Daily totals: 16 months the first time, then the last 10 days again (Google revises recent days).
    const lastDay = db.prepare(`SELECT MAX(date) AS d FROM gsc_daily WHERE site_id = ?`).get(site.id)?.['d'] as
      string | null;
    const yesterday = addDays(iso(now), -1);
    const start = lastDay ? addDays(lastDay, -10) : addDays(iso(now), -486);
    const daily = await client.query(property, { startDate: start, endDate: yesterday, dimensions: ['date'] });
    const upsert = db.prepare(
      `INSERT INTO gsc_daily (site_id, date, clicks, impressions, ctr, position) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id, date) DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions, ctr = excluded.ctr, position = excluded.position`,
    );
    db.exec('BEGIN');
    try {
      for (const r of daily) upsert.run(site.id, r.keys[0]!, r.clicks, r.impressions, r.ctr, r.position);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    // 2. Two 28-day windows ending on the last day with final data.
    const end =
      (db.prepare(`SELECT MAX(date) AS d FROM gsc_daily WHERE site_id = ?`).get(site.id)?.['d'] as string | null) ??
      yesterday;
    const cur = { startDate: addDays(end, -27), endDate: end };
    const prev = { startDate: addDays(end, -55), endDate: addDays(end, -28) };
    const pulls: { period: 'cur' | 'prev'; kind: string; dims: ('query' | 'page' | 'country' | 'device')[] }[] = [
      { period: 'cur', kind: 'query_page', dims: ['query', 'page'] },
      { period: 'prev', kind: 'query_page', dims: ['query', 'page'] },
      { period: 'cur', kind: 'page', dims: ['page'] },
      { period: 'prev', kind: 'page', dims: ['page'] },
      { period: 'cur', kind: 'country', dims: ['country'] },
      { period: 'prev', kind: 'country', dims: ['country'] },
      { period: 'cur', kind: 'device', dims: ['device'] },
    ];
    const results: { period: string; kind: string; rows: AnalyticsRow[] }[] = [];
    for (const p of pulls) {
      results.push({
        ...p,
        rows: await client.query(property, { ...(p.period === 'cur' ? cur : prev), dimensions: p.dims }),
      });
    }
    db.exec('BEGIN');
    try {
      db.prepare(`DELETE FROM gsc_rows WHERE site_id = ?`).run(site.id);
      const ins = db.prepare(
        `INSERT INTO gsc_rows (site_id, period, kind, k1, k2, clicks, impressions, ctr, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of results)
        for (const row of r.rows)
          ins.run(
            site.id,
            r.period,
            r.kind,
            row.keys[0]!,
            row.keys[1] ?? null,
            row.clicks,
            row.impressions,
            row.ctr,
            row.position,
          );
      db.prepare(
        `INSERT INTO gsc_meta (site_id, property, cur_start, cur_end, prev_start, prev_end, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(site_id) DO UPDATE SET property = excluded.property, cur_start = excluded.cur_start, cur_end = excluded.cur_end,
           prev_start = excluded.prev_start, prev_end = excluded.prev_end, synced_at = excluded.synced_at`,
      ).run(site.id, property, cur.startDate, cur.endDate, prev.startDate, prev.endDate, at);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    // 3. Sitemaps submitted in Search Console. Optional: a failure here shouldn't lose the rest of the sync.
    try {
      const sitemaps = await client.listSitemaps(property);
      db.exec('BEGIN');
      try {
        db.prepare(`DELETE FROM gsc_sitemaps WHERE site_id = ?`).run(site.id);
        const ins = db.prepare(
          `INSERT INTO gsc_sitemaps (site_id, path, last_submitted, last_downloaded, is_pending, errors, warnings, submitted, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const m of sitemaps)
          ins.run(
            site.id,
            m.path,
            m.lastSubmitted,
            m.lastDownloaded,
            m.isPending ? 1 : 0,
            m.errors,
            m.warnings,
            m.submitted,
            at,
          );
        // Recorded even when the list is empty: "no sitemap submitted" is itself the answer.
        db.prepare(
          `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).run(`gsc_sitemaps_at:${site.id}`, at);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    } catch {
      // Left as it was; the indexing view says when the sitemap list is unknown.
    }

    // 4. URL Inspection: the URLs checked longest ago first, within the daily budget.
    const latest = store.okRuns(site.id, 1)[0];
    const urls = latest ? (store.live(latest.id)?.urls ?? []) : [];
    const checked = new Map(
      db
        .prepare(`SELECT url, checked_at FROM inspections WHERE site_id = ?`)
        .all(site.id)
        .map((r) => [String(r['url']), String(r['checked_at'])]),
    );
    const today = iso(now);
    const due = urls
      .filter((u) => !(checked.get(u) ?? '').startsWith(today))
      .sort((a, b) => (checked.get(a) ?? '').localeCompare(checked.get(b) ?? ''))
      .slice(0, opts.inspectLimit ?? 100);
    const saveInspection = db.prepare(
      `INSERT INTO inspections (site_id, url, verdict, coverage_state, indexing_state, page_fetch_state, robots_state, google_canonical, user_canonical, last_crawl, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id, url) DO UPDATE SET verdict = excluded.verdict, coverage_state = excluded.coverage_state,
         indexing_state = excluded.indexing_state, page_fetch_state = excluded.page_fetch_state, robots_state = excluded.robots_state,
         google_canonical = excluded.google_canonical, user_canonical = excluded.user_canonical, last_crawl = excluded.last_crawl,
         checked_at = excluded.checked_at`,
    );
    // A few at a time: each inspection takes seconds, and Google allows 600 a minute per property.
    let inspected = 0;
    let stop = false;
    const queue = [...due];
    const worker = async () => {
      for (let url = queue.shift(); url && !stop; url = queue.shift()) {
        let r: InspectionResult;
        try {
          r = await client.inspect(property, url);
        } catch (e) {
          // One URL failing (e.g. outside the property) shouldn't stop the rest; a quota error should.
          if ((e as { status?: number }).status === 429) stop = true;
          continue;
        }
        saveInspection.run(
          site.id,
          url,
          r.verdict,
          r.coverageState,
          r.indexingState,
          r.pageFetchState,
          r.robotsTxtState,
          r.googleCanonical,
          r.userCanonical,
          r.lastCrawlTime,
          at,
        );
        inspected++;
        if (opts.inspectDelayMs) await new Promise((res) => setTimeout(res, opts.inspectDelayMs));
      }
    };
    await Promise.all(Array.from({ length: opts.inspectConcurrency ?? 4 }, worker));

    db.prepare(`INSERT INTO gsc_syncs (site_id, at, status, inspected) VALUES (?, ?, 'ok', ?)`).run(
      site.id,
      at,
      inspected,
    );
    return {
      property,
      days: daily.length,
      queries: results.filter((r) => r.kind === 'query_page' && r.period === 'cur')[0]!.rows.length,
      inspected,
    };
  } catch (e) {
    const message = explainGoogleError(e, client.email);
    store.db
      .prepare(`INSERT INTO gsc_syncs (site_id, at, status, error) VALUES (?, ?, 'failed', ?)`)
      .run(site.id, at, message);
    throw new Error(message, { cause: e });
  }
}

export interface Agg {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const ctrPct = (a: Agg) => (a.impressions ? a.clicks / a.impressions : 0);

/** Everything the Search section of the dashboard shows, or what is missing. */
export function searchView(
  store: Store,
  siteId: number,
  connected: boolean,
  email: string | null,
  now: Date = new Date(),
) {
  const db = store.db;
  const meta = db.prepare(`SELECT * FROM gsc_meta WHERE site_id = ?`).get(siteId);
  const lastSync =
    db
      .prepare(`SELECT at, status, error, inspected FROM gsc_syncs WHERE site_id = ? ORDER BY id DESC LIMIT 1`)
      .get(siteId) ?? null;
  const property = settings(store, siteId).property ?? (meta ? String(meta['property']) : null);
  if (!meta) return { connected, email, property, lastSync, hasData: false as const };

  const curStart = String(meta['cur_start']);
  const curEnd = String(meta['cur_end']);
  const prevStart = String(meta['prev_start']);
  const prevEnd = String(meta['prev_end']);
  const totals = (from: string, to: string): Agg => {
    const r = db
      .prepare(
        `SELECT COALESCE(SUM(clicks),0) c, COALESCE(SUM(impressions),0) i, COALESCE(SUM(position * impressions),0) pw FROM gsc_daily WHERE site_id = ? AND date BETWEEN ? AND ?`,
      )
      .get(siteId, from, to)!;
    const c = Number(r['c']);
    const i = Number(r['i']);
    return { clicks: c, impressions: i, ctr: i ? c / i : 0, position: i ? Number(r['pw']) / i : 0 };
  };
  const rows = (kind: string, period: string) =>
    db
      .prepare(
        `SELECT k1, k2, clicks, impressions, ctr, position FROM gsc_rows WHERE site_id = ? AND kind = ? AND period = ?`,
      )
      .all(siteId, kind, period)
      .map((r) => ({
        k1: String(r['k1']),
        k2: r['k2'] === null ? null : String(r['k2']),
        clicks: Number(r['clicks']),
        impressions: Number(r['impressions']),
        ctr: Number(r['ctr']),
        position: Number(r['position']),
      }));

  const daily = db
    .prepare(`SELECT date, clicks, impressions, position FROM gsc_daily WHERE site_id = ? ORDER BY date DESC LIMIT 90`)
    .all(siteId)
    .reverse()
    .map((r) => ({
      date: String(r['date']),
      clicks: Number(r['clicks']),
      impressions: Number(r['impressions']),
      position: Number(r['position']),
    }));

  const curQ = rows('query_page', 'cur');
  const prevQ = new Map(rows('query_page', 'prev').map((r) => [`${r.k1}\u0000${r.k2}`, r]));
  const queries = [...curQ]
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 25)
    .map((r) => ({
      query: r.k1,
      page: r.k2,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      prevPosition: prevQ.get(`${r.k1}\u0000${r.k2}`)?.position ?? null,
    }));

  const countriesCur = rows('country', 'cur').sort((a, b) => b.impressions - a.impressions);
  const countriesPrev = new Map(rows('country', 'prev').map((r) => [r.k1, r]));
  const countries = countriesCur.slice(0, 8).map((r) => ({
    code: r.k1,
    name: countryName(r.k1),
    clicks: r.clicks,
    impressions: r.impressions,
    prevImpressions: countriesPrev.get(r.k1)?.impressions ?? 0,
  }));
  const otherCountries = countriesCur.slice(8);
  const devices = rows('device', 'cur').map((r) => ({
    device: r.k1.toLowerCase(),
    clicks: r.clicks,
    impressions: r.impressions,
  }));

  // Opportunities: fixed rules over the site's own numbers.
  const top10 = curQ.filter((r) => r.position <= 10);
  const top10Ctr = ctrPct(
    top10.reduce((a, r) => ({ ...a, clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }), {
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    }),
  );
  const closeToPageOne = curQ
    .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 50)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5);
  const lowCtr = top10Ctr
    ? curQ
        .filter((r) => r.impressions >= 100 && r.ctr < top10Ctr / 2)
        .filter((r) => r.position <= 10)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 5)
    : [];
  const pagesCur = rows('page', 'cur');
  const pagesCurSet = new Set(pagesCur.map((r) => r.k1));
  const pagesPrev = new Map(rows('page', 'prev').map((r) => [r.k1, r]));
  const losing = pagesCur
    .map((r) => ({ page: r.k1, clicks: r.clicks, prevClicks: pagesPrev.get(r.k1)?.clicks ?? 0 }))
    .concat(
      [...pagesPrev.values()]
        .filter((p) => !pagesCurSet.has(p.k1))
        .map((p) => ({ page: p.k1, clicks: 0, prevClicks: p.clicks })),
    )
    .filter((p) => p.prevClicks >= 10 && p.clicks <= p.prevClicks * 0.7)
    .sort((a, b) => b.prevClicks - b.clicks - (a.prevClicks - a.clicks))
    .slice(0, 5);

  const indexing = siteIndexing(store, siteId, property, now);

  return {
    connected,
    email,
    property,
    lastSync,
    hasData: true as const,
    range: { cur: [curStart, curEnd], prev: [prevStart, prevEnd] },
    totals: { cur: totals(curStart, curEnd), prev: totals(prevStart, prevEnd) },
    daily,
    queries,
    countries,
    otherCountries: {
      count: otherCountries.length,
      impressions: otherCountries.reduce((n, r) => n + r.impressions, 0),
      clicks: otherCountries.reduce((n, r) => n + r.clicks, 0),
    },
    devices,
    opportunities: {
      top10Ctr,
      closeToPageOne: closeToPageOne.map((r) => ({
        query: r.k1,
        page: r.k2,
        impressions: r.impressions,
        clicks: r.clicks,
        position: r.position,
      })),
      lowCtr: lowCtr.map((r) => ({
        query: r.k1,
        page: r.k2,
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        position: r.position,
      })),
      losing,
    },
    indexing,
  };
}

/** Pages meant to be in Google, how many are, and why the others aren't (see indexing.ts). */
export function siteIndexing(store: Store, siteId: number, property: string | null, now: Date = new Date()) {
  const db = store.db;
  const latest = store.okRuns(siteId, 1)[0];
  const live = latest ? store.live(latest.id) : null;
  const inspections: InspectionRow[] = db
    .prepare(
      `SELECT url, verdict, coverage_state, page_fetch_state, robots_state, google_canonical, user_canonical, last_crawl, checked_at FROM inspections WHERE site_id = ?`,
    )
    .all(siteId)
    .map((r) => ({
      url: String(r['url']),
      verdict: (r['verdict'] as string | null) ?? null,
      coverageState: (r['coverage_state'] as string | null) ?? null,
      pageFetchState: (r['page_fetch_state'] as string | null) ?? null,
      robotsState: (r['robots_state'] as string | null) ?? null,
      googleCanonical: (r['google_canonical'] as string | null) ?? null,
      userCanonical: (r['user_canonical'] as string | null) ?? null,
      lastCrawl: (r['last_crawl'] as string | null) ?? null,
      checkedAt: String(r['checked_at']),
    }));
  const sitemapsRead = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`gsc_sitemaps_at:${siteId}`);
  const sitemaps: SitemapStatus[] | null = sitemapsRead
    ? db
        .prepare(`SELECT * FROM gsc_sitemaps WHERE site_id = ? ORDER BY path`)
        .all(siteId)
        .map((r) => ({
          path: String(r['path']),
          lastSubmitted: (r['last_submitted'] as string | null) ?? null,
          lastDownloaded: (r['last_downloaded'] as string | null) ?? null,
          isPending: Number(r['is_pending']) === 1,
          errors: Number(r['errors'] ?? 0),
          warnings: Number(r['warnings'] ?? 0),
          submitted: r['submitted'] === null ? null : Number(r['submitted']),
        }))
    : null;
  const first = db.prepare(`SELECT MIN(date) AS d FROM gsc_daily WHERE site_id = ? AND impressions > 0`).get(siteId)?.[
    'd'
  ] as string | null;
  const site = store.site(siteId);
  let thin = 200;
  try {
    thin = resolveConfig({ ...(site?.config ?? {}), site: site?.origin }).thresholds.thinContentWords;
  } catch {
    // An invalid saved config shouldn't break the dashboard; the default applies.
  }
  return indexingView({
    now,
    urls: live?.urls ?? [],
    pages: live?.pages ?? null,
    inspections,
    sitemaps,
    firstImpression: first ?? null,
    thinContentWords: thin,
    ...(property ? { inspectLink: (url: string) => inspectLink(property, url) } : {}),
  });
}

/** Runs Search Console syncs one at a time and remembers which sites are syncing. */
export class SearchSyncer {
  private busy = new Set<number>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private store: Store,
    private load: () => SearchConsole | null,
    private opts: SyncOptions = {},
    private log: (line: string) => void = () => {},
  ) {}

  client(): SearchConsole | null {
    try {
      return this.load();
    } catch (e) {
      this.log(`Search Console key unreadable: ${(e as Error).message}`);
      return null;
    }
  }

  pending(siteId: number): boolean {
    return this.busy.has(siteId);
  }

  /** Queues a sync; resolves when it finishes. Never rejects: failures are stored and logged. */
  sync(siteId: number): Promise<SyncResult | null> {
    const client = this.client();
    const site = this.store.site(siteId);
    if (!client || !site || this.busy.has(siteId)) return Promise.resolve(null);
    this.busy.add(siteId);
    const job = this.chain.then(async () => {
      try {
        const r = await syncSearchConsole(this.store, site, client, this.opts);
        this.log(
          `${site.origin}  Search Console: ${r.days} days, ${r.queries} searches, ${r.inspected} pages inspected`,
        );
        return r;
      } catch (e) {
        this.log(`${site.origin}  Search Console sync failed: ${(e as Error).message}`);
        return null;
      } finally {
        this.busy.delete(siteId);
      }
    });
    this.chain = job;
    return job;
  }
}
