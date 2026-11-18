import { resolveConfig } from '../core/config.js';
import { entityFacts } from '../core/entity.js';
import { pageFacts } from '../core/pagefacts.js';
import { runChecks } from '../core/run.js';
import { parseSitemap } from '../core/sitemap/parse.js';
import type { PageFact } from '../core/pagefacts.js';
import type { Report, SiteModel } from '../core/types.js';
import { crawlLive } from '../node/live.js';
import type { LiveSummary, RunRow, SiteRow, Store } from './store.js';

/**
 * URLs for URL Inspection: sitemap URLs first (what the owner wants indexed), then crawled pages that are meant to be
 * indexed. Pages that point their canonical elsewhere or are noindex are left out, and so are the child sitemaps of a
 * sitemap index: inspecting them spends the daily quota on URLs that aren't supposed to be in Google.
 */
export function inspectionUrls(model: Pick<SiteModel, 'origin' | 'sitemaps'>, pages: PageFact[]): string[] {
  const urls = new Set<string>();
  for (const f of model.sitemaps) {
    if (!f.body) continue;
    const parsed = parseSitemap(f.body);
    if (parsed.kind !== 'urlset' && parsed.kind !== 'text') continue;
    for (const e of parsed.entries) if (e.loc.startsWith(model.origin)) urls.add(e.loc);
  }
  for (const p of pages) if (!p.notIndexable) urls.add(p.url);
  return [...urls];
}

/** Produces a report for a site. The default crawls the live site; tests inject their own. */
export type SiteRunner = (site: SiteRow) => Promise<{ report: Report; live: LiveSummary | null }>;

export const liveRunner: SiteRunner = async (site) => {
  const config = resolveConfig({ ...site.config, site: site.origin });
  const model = await crawlLive(site.origin, { trailingSlash: config.trailingSlash });
  const pages = pageFacts(model, config);
  const urls = inspectionUrls(model, pages);
  return {
    report: runChecks(model, config),
    live: {
      crawlerAccess: model.live?.crawlerAccess ?? [],
      urls,
      pages,
      entity: entityFacts(model, config),
      server: model.pages.find((p) => p.url === `${model.origin}/`)?.http?.headers['server'] ?? null,
    },
  };
};

/** Runs checks one site at a time (a crawl is polite to the sites and light on the machine). */
export class RunQueue {
  private queue: { siteId: number; trigger: RunRow['trigger'] }[] = [];
  private busy = false;
  private idle: (() => void)[] = [];

  constructor(
    private store: Store,
    private runner: SiteRunner,
    private onFinish?: (siteId: number, runId: number, ok: boolean) => void,
  ) {}

  /** Queues a run; returns false when that site is already queued or running. */
  enqueue(siteId: number, trigger: RunRow['trigger']): boolean {
    if (this.queue.some((q) => q.siteId === siteId) || this.store.isRunning(siteId)) return false;
    this.queue.push({ siteId, trigger });
    void this.drain();
    return true;
  }

  pending(siteId: number): boolean {
    return this.queue.some((q) => q.siteId === siteId) || this.store.isRunning(siteId);
  }

  /** Resolves when nothing is queued or running. */
  whenIdle(): Promise<void> {
    if (!this.busy && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        const site = this.store.site(job.siteId);
        if (!site) continue;
        const runId = this.store.startRun(site.id, job.trigger);
        try {
          const { report, live } = await this.runner(site);
          this.store.finishRun(runId, report, live);
          this.onFinish?.(site.id, runId, true);
        } catch (e) {
          this.store.failRun(runId, (e as Error).message || String(e));
          this.onFinish?.(site.id, runId, false);
        }
      }
    } finally {
      this.busy = false;
      for (const r of this.idle.splice(0)) r();
    }
  }
}

/** YYYY-MM-DD in the machine's time zone. */
export function localDate(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

/**
 * Should the daily check run now? Due when it is past the site's hour and there is no successful run today, or when
 * the last successful run is more than 26 hours old (the machine was off at the usual time). A failed attempt waits an
 * hour before the next try.
 */
export function isDue(site: SiteRow, runs: RunRow[], now: Date): boolean {
  const lastAttempt = runs[0];
  if (lastAttempt?.status === 'running') return false;
  if (
    lastAttempt &&
    now.getTime() - Date.parse(lastAttempt.startedAt) < 60 * 60 * 1000 &&
    lastAttempt.status === 'failed'
  )
    return false;
  const lastOk = runs.find((r) => r.status === 'ok');
  if (!lastOk) return true;
  const okToday = localDate(new Date(lastOk.startedAt)) === localDate(now);
  if (okToday) return false;
  if (now.getHours() >= site.runHour) return true;
  return now.getTime() - Date.parse(lastOk.startedAt) > 26 * 60 * 60 * 1000;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private store: Store,
    private queue: RunQueue,
    private now: () => Date = () => new Date(),
  ) {}

  /** Checks every site now, then once a minute. */
  start(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    const now = this.now();
    for (const site of this.store.sites()) {
      if (isDue(site, this.store.runs(site.id, 5), now)) this.queue.enqueue(site.id, 'schedule');
    }
  }
}
