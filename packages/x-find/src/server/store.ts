/**
 * Local storage for the x-find service: one SQLite file (Node's built-in node:sqlite, no native dependency).
 * Cloudflare D1 is SQLite too, so the same schema moves to the cloud later.
 *
 * Migrations are additive only (CREATE … IF NOT EXISTS, ADD COLUMN). Nothing here drops or rewrites data.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { EntityFacts } from '../core/entity.js';
import type { PageFact } from '../core/pagefacts.js';
import type { CrawlerAccess, Report } from '../core/types.js';

export interface SiteRow {
  id: number;
  origin: string;
  name: string;
  /** Project config for this site (same shape as x-find.config), JSON. */
  config: Record<string, unknown>;
  /** Local hour (0–23) after which the daily check runs. */
  runHour: number;
  createdAt: string;
}

export interface RunRow {
  id: number;
  siteId: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'failed';
  trigger: 'schedule' | 'manual' | 'cli';
  error: string | null;
  pages: number | null;
  seo: number | null;
  aeo: number | null;
  geo: number | null;
  errors: number | null;
  warnings: number | null;
  notices: number | null;
}

export interface LiveSummary {
  crawlerAccess: CrawlerAccess[];
  /** URLs found in the sitemaps and the crawl, for URL Inspection. */
  urls?: string[];
  /** Per-page crawl facts, set next to URL Inspection results to explain why pages aren't indexed. */
  pages?: PageFact[];
  /** What the site says about who it is, for the GEO analysis. Absent in runs saved before it existed. */
  entity?: EntityFacts;
  /** The home page's Server header (e.g. "cloudflare"), to write host-specific fixes. */
  server?: string | null;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sites (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     origin TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     config_json TEXT NOT NULL DEFAULT '{}',
     run_hour INTEGER NOT NULL DEFAULT 6,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     site_id INTEGER NOT NULL REFERENCES sites(id),
     started_at TEXT NOT NULL,
     finished_at TEXT,
     status TEXT NOT NULL,
     trigger TEXT NOT NULL,
     error TEXT,
     pages INTEGER,
     seo INTEGER, aeo INTEGER, geo INTEGER,
     errors INTEGER, warnings INTEGER, notices INTEGER,
     report_json TEXT,
     live_json TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS runs_site_started ON runs(site_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS findings (
     run_id INTEGER NOT NULL REFERENCES runs(id),
     site_id INTEGER NOT NULL,
     fingerprint TEXT NOT NULL,
     check_id TEXT NOT NULL,
     severity TEXT NOT NULL,
     category TEXT NOT NULL,
     url TEXT,
     message TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS findings_site_fp ON findings(site_id, fingerprint)`,
  `CREATE INDEX IF NOT EXISTS findings_run ON findings(run_id)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Search Console (connectors/google.ts, server/gsc.ts)
  `CREATE TABLE IF NOT EXISTS site_connectors (
     site_id INTEGER NOT NULL REFERENCES sites(id),
     kind TEXT NOT NULL,
     settings_json TEXT NOT NULL DEFAULT '{}',
     PRIMARY KEY (site_id, kind)
   )`,
  `CREATE TABLE IF NOT EXISTS gsc_daily (
     site_id INTEGER NOT NULL, date TEXT NOT NULL,
     clicks INTEGER NOT NULL, impressions INTEGER NOT NULL, ctr REAL NOT NULL, position REAL NOT NULL,
     PRIMARY KEY (site_id, date)
   )`,
  `CREATE TABLE IF NOT EXISTS gsc_rows (
     site_id INTEGER NOT NULL, period TEXT NOT NULL, kind TEXT NOT NULL, k1 TEXT NOT NULL, k2 TEXT,
     clicks INTEGER NOT NULL, impressions INTEGER NOT NULL, ctr REAL NOT NULL, position REAL NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS gsc_rows_site ON gsc_rows(site_id, kind, period)`,
  `CREATE TABLE IF NOT EXISTS gsc_meta (
     site_id INTEGER PRIMARY KEY, property TEXT NOT NULL,
     cur_start TEXT, cur_end TEXT, prev_start TEXT, prev_end TEXT, synced_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS gsc_syncs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL, at TEXT NOT NULL,
     status TEXT NOT NULL, error TEXT, inspected INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS inspections (
     site_id INTEGER NOT NULL, url TEXT NOT NULL,
     verdict TEXT, coverage_state TEXT, indexing_state TEXT, page_fetch_state TEXT, robots_state TEXT,
     google_canonical TEXT, user_canonical TEXT, last_crawl TEXT, checked_at TEXT NOT NULL,
     PRIMARY KEY (site_id, url)
   )`,
  `CREATE TABLE IF NOT EXISTS actions (
     site_id INTEGER NOT NULL, key TEXT NOT NULL, status TEXT NOT NULL, done_by TEXT,
     tier INTEGER NOT NULL, weight REAL NOT NULL, payload_json TEXT NOT NULL,
     first_seen TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT,
     PRIMARY KEY (site_id, key)
   )`,
  `CREATE TABLE IF NOT EXISTS gsc_sitemaps (
     site_id INTEGER NOT NULL, path TEXT NOT NULL, last_submitted TEXT, last_downloaded TEXT,
     is_pending INTEGER, errors INTEGER, warnings INTEGER, submitted INTEGER, checked_at TEXT NOT NULL,
     PRIMARY KEY (site_id, path)
   )`,
];

type Row = Record<string, unknown>;

const toSite = (r: Row): SiteRow => ({
  id: Number(r['id']),
  origin: String(r['origin']),
  name: String(r['name']),
  config: JSON.parse(String(r['config_json'] ?? '{}')) as Record<string, unknown>,
  runHour: Number(r['run_hour']),
  createdAt: String(r['created_at']),
});

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toRun = (r: Row): RunRow => ({
  id: Number(r['id']),
  siteId: Number(r['site_id']),
  startedAt: String(r['started_at']),
  finishedAt: (r['finished_at'] as string | null) ?? null,
  status: r['status'] as RunRow['status'],
  trigger: r['trigger'] as RunRow['trigger'],
  error: (r['error'] as string | null) ?? null,
  pages: num(r['pages']),
  seo: num(r['seo']),
  aeo: num(r['aeo']),
  geo: num(r['geo']),
  errors: num(r['errors']),
  warnings: num(r['warnings']),
  notices: num(r['notices']),
});

const RUN_COLUMNS =
  'id, site_id, started_at, finished_at, status, trigger, error, pages, seo, aeo, geo, errors, warnings, notices';

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    for (const sql of MIGRATIONS) this.db.exec(sql);
    // A run left "running" by a crash or a closed laptop is marked failed, so the scheduler retries it.
    this.db
      .prepare(`UPDATE runs SET status = 'failed', error = 'interrupted', finished_at = ? WHERE status = 'running'`)
      .run(new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }

  addSite(origin: string, name: string, config: Record<string, unknown> = {}, runHour = 6): SiteRow {
    const o = new URL(origin).origin;
    this.db
      .prepare(`INSERT INTO sites (origin, name, config_json, run_hour, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(o, name, JSON.stringify(config), runHour, new Date().toISOString());
    return this.siteByOrigin(o)!;
  }

  updateSite(id: number, patch: { name?: string; config?: Record<string, unknown>; runHour?: number }): void {
    const s = this.site(id);
    if (!s) throw new Error(`No site ${id}`);
    this.db
      .prepare(`UPDATE sites SET name = ?, config_json = ?, run_hour = ? WHERE id = ?`)
      .run(patch.name ?? s.name, JSON.stringify(patch.config ?? s.config), patch.runHour ?? s.runHour, id);
  }

  sites(): SiteRow[] {
    return this.db.prepare(`SELECT * FROM sites ORDER BY name`).all().map(toSite);
  }

  site(id: number): SiteRow | null {
    const r = this.db.prepare(`SELECT * FROM sites WHERE id = ?`).get(id);
    return r ? toSite(r) : null;
  }

  siteByOrigin(origin: string): SiteRow | null {
    const r = this.db.prepare(`SELECT * FROM sites WHERE origin = ?`).get(new URL(origin).origin);
    return r ? toSite(r) : null;
  }

  startRun(siteId: number, trigger: RunRow['trigger']): number {
    const r = this.db
      .prepare(`INSERT INTO runs (site_id, started_at, status, trigger) VALUES (?, ?, 'running', ?)`)
      .run(siteId, new Date().toISOString(), trigger);
    return Number(r.lastInsertRowid);
  }

  finishRun(runId: number, report: Report, live: LiveSummary | null): void {
    const counts = { error: 0, warning: 0, notice: 0 };
    for (const f of report.findings) counts[f.severity]++;
    const score = (c: string) => report.scores.find((s) => s.category === c)?.score ?? null;
    const run = this.run(runId);
    if (!run) throw new Error(`No run ${runId}`);
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `UPDATE runs SET finished_at = ?, status = 'ok', pages = ?, seo = ?, aeo = ?, geo = ?, errors = ?, warnings = ?,
             notices = ?, report_json = ?, live_json = ? WHERE id = ?`,
        )
        .run(
          new Date().toISOString(),
          report.pagesChecked,
          score('seo'),
          score('aeo'),
          score('geo'),
          counts.error,
          counts.warning,
          counts.notice,
          JSON.stringify(report),
          live ? JSON.stringify(live) : null,
          runId,
        );
      const insert = this.db.prepare(
        `INSERT INTO findings (run_id, site_id, fingerprint, check_id, severity, category, url, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const f of report.findings)
        insert.run(runId, run.siteId, f.fingerprint, f.checkId, f.severity, f.category, f.url ?? null, f.message);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  failRun(runId: number, error: string): void {
    this.db
      .prepare(`UPDATE runs SET finished_at = ?, status = 'failed', error = ? WHERE id = ?`)
      .run(new Date().toISOString(), error.slice(0, 2000), runId);
  }

  run(id: number): RunRow | null {
    const r = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(id);
    return r ? toRun(r) : null;
  }

  runs(siteId: number, limit = 90): RunRow[] {
    return this.db
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE site_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`)
      .all(siteId, limit)
      .map(toRun);
  }

  /** The latest successful runs, newest first. */
  okRuns(siteId: number, limit = 2): RunRow[] {
    return this.db
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM runs WHERE site_id = ? AND status = 'ok' ORDER BY started_at DESC, id DESC LIMIT ?`,
      )
      .all(siteId, limit)
      .map(toRun);
  }

  report(runId: number): Report | null {
    const r = this.db.prepare(`SELECT report_json FROM runs WHERE id = ?`).get(runId);
    const json = r?.['report_json'];
    return typeof json === 'string' ? (JSON.parse(json) as Report) : null;
  }

  live(runId: number): LiveSummary | null {
    const r = this.db.prepare(`SELECT live_json FROM runs WHERE id = ?`).get(runId);
    const json = r?.['live_json'];
    return typeof json === 'string' ? (JSON.parse(json) as LiveSummary) : null;
  }

  /** When each fingerprint was first seen for a site (ISO time of the run). */
  firstSeen(siteId: number, fingerprints: string[]): Map<string, string> {
    const out = new Map<string, string>();
    if (!fingerprints.length) return out;
    const stmt = this.db.prepare(
      `SELECT MIN(r.started_at) AS t FROM findings f JOIN runs r ON r.id = f.run_id WHERE f.site_id = ? AND f.fingerprint = ?`,
    );
    for (const fp of fingerprints) {
      const t = stmt.get(siteId, fp)?.['t'];
      if (typeof t === 'string') out.set(fp, t);
    }
    return out;
  }

  isRunning(siteId: number): boolean {
    return !!this.db.prepare(`SELECT 1 FROM runs WHERE site_id = ? AND status = 'running' LIMIT 1`).get(siteId);
  }
}
