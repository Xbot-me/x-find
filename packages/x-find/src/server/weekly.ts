/**
 * Stores the actions from actions.ts per site, notices when they're done, and builds "This week": the stage, the top
 * three open actions, what's waiting, and what was done recently.
 */
import { resolveConfig } from '../core/config.js';
import { candidateActions } from './actions.js';
import type { Action, ActionInput, QueryTotals, Stage } from './actions.js';
import { fixFor } from './fixes.js';
import type { Fix } from './fixes.js';
import { searchView, siteIndexing } from './gsc.js';
import type { Store } from './store.js';

/** 'waiting': the owner did their part (e.g. asked Google) and x-find is waiting for the result. */
export type ActionStatus = 'open' | 'waiting' | 'done' | 'dismissed' | 'expired';

export interface StoredAction extends Action {
  status: ActionStatus;
  /** Who closed it: x-find saw it fixed, or the owner marked it. */
  doneBy: 'x-find' | 'you' | null;
  firstSeen: string;
  doneAt: string | null;
  /** Why it came back, when it did. */
  note?: string | undefined;
}

/** How long an owner-marked action stays closed before it can come back if it still applies. */
const OWNER_DONE_DAYS = 14;
const DAY = 86_400_000;

function queryTotals(store: Store, siteId: number, period: 'cur' | 'prev'): QueryTotals[] {
  return store.db
    .prepare(
      `SELECT k1 AS query, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
              SUM(position * impressions) / MAX(SUM(impressions), 1) AS position
       FROM gsc_rows WHERE site_id = ? AND kind = 'query_page' AND period = ? GROUP BY k1`,
    )
    .all(siteId, period)
    .map((r) => ({
      query: String(r['query']),
      clicks: Number(r['clicks']),
      impressions: Number(r['impressions']),
      position: Number(r['position']),
    }));
}

/** Everything the action rules read, from what's stored for the site. */
export function actionInput(store: Store, siteId: number, now: Date = new Date()): ActionInput {
  const site = store.site(siteId);
  if (!site) throw new Error(`No site ${siteId}`);
  const latest = store.okRuns(siteId, 1)[0];
  const report = latest ? store.report(latest.id) : null;
  const live = latest ? store.live(latest.id) : null;
  const sv = searchView(store, siteId, true, null, now);
  let brand: string[] = [];
  try {
    const b = resolveConfig({ ...site.config, site: site.origin }).brand;
    brand = [b.name, ...b.variants].filter((x): x is string => !!x);
  } catch {
    // An invalid saved config shouldn't stop the weekly list.
  }
  return {
    origin: site.origin,
    brandNames: [site.name, ...brand],
    findings: report?.findings ?? null,
    pages: live?.pages ?? null,
    indexing: sv.hasData ? siteIndexing(store, siteId, sv.property, now) : null,
    search: sv.hasData
      ? {
          cur: queryTotals(store, siteId, 'cur'),
          prev: queryTotals(store, siteId, 'prev'),
          totalImpressions: sv.totals.cur.impressions,
          opportunities: sv.opportunities,
        }
      : null,
  };
}

interface Row {
  key: string;
  status: ActionStatus;
  doneBy: StoredAction['doneBy'];
  doneAt: string | null;
  firstSeen: string;
  action: Action & { note?: string };
}

function rows(store: Store, siteId: number): Row[] {
  return store.db
    .prepare(`SELECT key, status, done_by, done_at, first_seen, payload_json FROM actions WHERE site_id = ?`)
    .all(siteId)
    .map((r) => ({
      key: String(r['key']),
      status: r['status'] as ActionStatus,
      doneBy: (r['done_by'] as StoredAction['doneBy']) ?? null,
      doneAt: (r['done_at'] as string | null) ?? null,
      firstSeen: String(r['first_seen']),
      action: JSON.parse(String(r['payload_json'])) as Action & { note?: string },
    }));
}

/** True when the data behind a source was refreshed successfully, so a missing action really means "gone". */
function sourceFresh(store: Store, siteId: number): Record<Action['source'], boolean> {
  const crawl = store.okRuns(siteId, 1).length > 0;
  const lastSync = store.db
    .prepare(`SELECT status FROM gsc_syncs WHERE site_id = ? ORDER BY id DESC LIMIT 1`)
    .get(siteId)?.['status'];
  return { crawl, search: lastSync === 'ok' };
}

/**
 * Brings the stored actions in line with what applies now. Call after each check and each Search Console sync.
 * - New problems become open actions; open ones get fresh evidence.
 * - An open action that no longer applies is done (when x-find can see the fix) or expired (advice from numbers
 *   that changed), but only when its data source was refreshed successfully.
 * - A fixed problem that comes back reopens. One the owner marked done reopens if the next check still finds it
 *   (crawl problems) or after two weeks if it still applies (everything else). Dismissed actions stay dismissed.
 */
export function reconcileActions(store: Store, siteId: number, now: Date = new Date()): void {
  const { actions } = candidateActions(actionInput(store, siteId, now));
  const at = now.toISOString();
  const existing = new Map(rows(store, siteId).map((r) => [r.key, r]));
  const fresh = sourceFresh(store, siteId);
  const latestRun = store.okRuns(siteId, 1)[0]?.startedAt ?? '';
  const db = store.db;
  const upsert = db.prepare(
    `INSERT INTO actions (site_id, key, status, done_by, tier, weight, payload_json, first_seen, updated_at, done_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(site_id, key) DO UPDATE SET status = excluded.status, done_by = excluded.done_by, tier = excluded.tier,
       weight = excluded.weight, payload_json = excluded.payload_json, updated_at = excluded.updated_at,
       done_at = excluded.done_at`,
  );
  const save = (a: Action & { note?: string }, status: ActionStatus, doneBy: Row['doneBy'], doneAt: string | null) =>
    upsert.run(
      siteId,
      a.key,
      status,
      doneBy,
      a.tier,
      a.weight,
      JSON.stringify(a),
      existing.get(a.key)?.firstSeen ?? at,
      at,
      doneAt,
    );

  db.exec('BEGIN');
  try {
    const seen = new Set<string>();
    for (const a of actions) {
      seen.add(a.key);
      const row = existing.get(a.key);
      // An open action keeps the reason it came back until it closes.
      if (!row || row.status === 'open') save({ ...a, note: row?.action.note }, 'open', null, null);
      else if (row.status === 'waiting') save({ ...a, note: row.action.note }, 'waiting', null, row.doneAt);
      else if (row.status === 'dismissed') save(a, 'dismissed', null, row.doneAt);
      else if (row.status === 'expired') save(a, 'open', null, null);
      else if (row.doneBy === 'x-find') save({ ...a, note: 'It came back after it was fixed.' }, 'open', null, null);
      else {
        // Marked done by the owner but still applies.
        const doneAt = row.doneAt ?? at;
        const checkedSince = a.source === 'crawl' && latestRun > doneAt;
        const waited = now.getTime() - new Date(doneAt).getTime() >= OWNER_DONE_DAYS * DAY;
        if (checkedSince)
          save({ ...a, note: 'The check after you marked it done still finds it.' }, 'open', null, null);
        else if (a.source === 'search' && waited)
          save({ ...a, note: `Still applies ${OWNER_DONE_DAYS} days after you marked it done.` }, 'open', null, null);
        else save(a, 'done', 'you', doneAt);
      }
    }
    for (const row of existing.values()) {
      if (seen.has(row.key) || (row.status !== 'open' && row.status !== 'waiting') || !fresh[row.action.source])
        continue;
      if (row.action.closesItself) save(row.action, 'done', 'x-find', at);
      else save(row.action, 'expired', null, at);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** The owner marks an action done, dismisses it ("not relevant"), or reopens it. */
export function setActionStatus(
  store: Store,
  siteId: number,
  key: string,
  status: 'done' | 'dismissed' | 'open' | 'waiting',
  now: Date = new Date(),
): boolean {
  const at = now.toISOString();
  const r = store.db
    .prepare(`UPDATE actions SET status = ?, done_by = ?, done_at = ?, updated_at = ? WHERE site_id = ? AND key = ?`)
    .run(status, status === 'done' ? 'you' : null, status === 'open' ? null : at, at, siteId, key);
  return Number(r.changes) > 0;
}

export interface WeekView {
  stage: Stage | null;
  thisWeek: StoredAction[];
  backlog: StoredAction[];
  done: StoredAction[];
  /** True when Search Console data is part of the picture. */
  withSearch: boolean;
}

const toStored = (r: Row): StoredAction => ({
  ...r.action,
  status: r.status,
  doneBy: r.doneBy,
  firstSeen: r.firstSeen,
  doneAt: r.doneAt,
});

/** "This week": at most three open actions, the rest waiting, and what was done in the last two weeks. */
export function weekView(store: Store, siteId: number, now: Date = new Date()): WeekView {
  const input = actionInput(store, siteId, now);
  const { stage } = candidateActions(input);
  const all = rows(store, siteId);
  const open = all
    .filter((r) => r.status === 'open')
    .sort((a, b) => a.action.tier - b.action.tier || b.action.weight - a.action.weight || a.key.localeCompare(b.key))
    .map(toStored);
  const since = new Date(now.getTime() - 14 * DAY).toISOString();
  const done = all
    .filter((r) => r.status === 'done' && (r.doneAt ?? '') >= since)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
    .map(toStored);
  return { stage, thisWeek: open.slice(0, 3), backlog: open.slice(3), done, withSearch: !!input.search };
}

export interface FocusTask extends Fix {
  status: 'open' | 'waiting' | 'done';
  /** Why it came back, when it did. */
  note?: string | undefined;
}

/**
 * The one-task screen: open and waiting tasks in order, then the ones done in the last two weeks (so the trail can
 * show them green), each with its generated fix.
 */
export function focusView(store: Store, siteId: number, now: Date = new Date()) {
  const site = store.site(siteId);
  if (!site) throw new Error(`No site ${siteId}`);
  const latest = store.okRuns(siteId, 1)[0];
  const live = latest ? store.live(latest.id) : null;
  const report = latest ? store.report(latest.id) : null;
  const ctx = {
    origin: site.origin,
    siteName: site.name,
    pages: live?.pages ?? null,
    findings: report?.findings ?? null,
    server: live?.server ?? null,
  };
  const order = (r: Row) => r.action.tier * 1e9 - r.action.weight;
  const since = new Date(now.getTime() - 14 * DAY).toISOString();
  const all = rows(store, siteId);
  const active = all.filter((r) => r.status === 'open' || r.status === 'waiting').sort((a, b) => order(a) - order(b));
  const done = all.filter((r) => r.status === 'done' && (r.doneAt ?? '') >= since).sort((a, b) => order(a) - order(b));
  const toTask = (r: Row): FocusTask => ({
    ...fixFor(r.action, ctx),
    status: r.status as FocusTask['status'],
    note: r.action.note,
  });
  return { tasks: [...done.map(toTask), ...active.map(toTask)], left: active.length };
}
