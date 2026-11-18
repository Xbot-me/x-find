import { describe, expect, it } from 'vitest';
import type { PageFact } from '../src/core/pagefacts.js';
import type { Finding, Report } from '../src/core/types.js';
import { brandTokens, candidateActions, isBrandQuery } from '../src/server/actions.js';
import type { ActionInput } from '../src/server/actions.js';
import type { IndexingView } from '../src/server/indexing.js';
import { Store } from '../src/server/store.js';
import { reconcileActions, setActionStatus, weekView } from '../src/server/weekly.js';

const A = 'https://a.com';

const fact = (path: string, patch: Partial<PageFact> = {}): PageFact => ({
  url: A + path,
  notIndexable: null,
  canonical: null,
  inLinks: 10,
  depth: 1,
  words: 800,
  inSitemap: true,
  title: null,
  ...patch,
});

const finding = (checkId: string, severity: Finding['severity'], url: string): Finding => ({
  checkId,
  title: checkId === 'robots-meta-noindex' ? 'Page is noindex' : 'Link without text',
  category: 'seo',
  severity,
  url: A + url,
  message: 'Something is wrong.',
  fix: 'Fix it like this.',
  sources: ['https://developers.google.com/search/docs/crawling-indexing/links-crawlable'],
  fingerprint: `${checkId}:${url}`,
});

const indexing = (pages: { path: string; state: string; reasons?: number }[]): IndexingView => {
  const groups = new Map<string, IndexingView['groups'][number]>();
  for (const p of pages) {
    if (/^submitted and indexed/i.test(p.state)) continue;
    const g = groups.get(p.state) ?? { state: p.state, meaning: '', todo: '', source: '', pages: [] };
    g.pages.push({
      url: A + p.path,
      lastCrawl: null,
      inspectUrl: `https://search.google.com/search-console/inspect?id=${encodeURIComponent(A + p.path)}`,
      reasons: Array.from({ length: p.reasons ?? 0 }, () => ({ id: 'x', text: 'x', source: 'https://x' })),
    });
    groups.set(p.state, g);
  }
  const indexed = pages.filter((p) => /^submitted and indexed/i.test(p.state)).length;
  return {
    meant: pages.length,
    inspected: pages.length,
    indexed,
    missing: pages.length - indexed,
    explained: 0,
    notMeant: { count: 0, canonical: 0, noindex: 0, robots: 0, status: 0 },
    states: [],
    groups: [...groups.values()],
    site: [],
    verdict: '',
  };
};

const noOpps = { top10Ctr: 0, closeToPageOne: [], lowCtr: [], losing: [] };
const input = (patch: Partial<ActionInput> = {}): ActionInput => ({
  origin: A,
  brandNames: ['BrightLeaf Studio'],
  findings: [],
  pages: [fact('/')],
  indexing: null,
  search: null,
  ...patch,
});

describe('brand searches', () => {
  const tokens = brandTokens(['BrightLeaf Studio'], 'https://brightleafstudio.example');
  it('recognises the name, its first word and near-miss spellings', () => {
    expect(isBrandQuery('brightleaf studio', tokens)).toBe(true);
    expect(isBrandQuery('BrightLeaf', tokens)).toBe(true);
    expect(isBrandQuery('britleaf studio', tokens)).toBe(true);
    expect(isBrandQuery('brightleaf studio pricing', tokens)).toBe(true);
  });
  it('does not treat topic searches as brand', () => {
    expect(isBrandQuery('3d studio', tokens)).toBe(false);
    expect(isBrandQuery('character rigging service', tokens)).toBe(false);
    expect(isBrandQuery('aura', tokens)).toBe(false);
  });
});

describe('candidate actions', () => {
  it('puts blockers first, then unreachable pages, then indexing requests, then improvements', () => {
    const { actions } = candidateActions(
      input({
        findings: [finding('link-empty-text', 'warning', '/'), finding('robots-meta-noindex', 'error', '/x/')],
        pages: [fact('/'), fact('/hidden/', { depth: null, inLinks: 2 })],
        indexing: indexing([{ path: '/services/a/', state: 'URL is unknown to Google' }]),
        search: { cur: [], prev: [], totalImpressions: 0, opportunities: noOpps },
      }),
    );
    expect(actions.map((a) => [a.key, a.tier])).toEqual([
      ['finding:robots-meta-noindex:error', 0],
      ['reach', 1],
      ['index-request', 2],
      ['finding:link-empty-text:warning', 4],
    ]);
    for (const a of actions) {
      expect(a.steps.length).toBeGreaterThan(0);
      expect(a.sources.every((s) => /^https:\/\//.test(s))).toBe(true);
    }
  });

  it('mentions filter links only when the site has URLs that point their canonical elsewhere', () => {
    const plain = candidateActions(input({ pages: [fact('/'), fact('/p/', { depth: null })] })).actions[0]!;
    expect(plain.steps.join(' ')).not.toMatch(/filtered/);
    const withFilters = candidateActions(
      input({
        pages: [
          fact('/'),
          fact('/p/', { depth: null }),
          fact('/work/?i=p', { notIndexable: 'canonical', canonical: `${A}/work/` }),
        ],
      }),
    ).actions[0]!;
    expect(withFilters.steps.join(' ')).toMatch(/filtered version/);
  });

  it('spends indexing requests on substantial pages, never legal ones or pages with a known cause', () => {
    const { actions } = candidateActions(
      input({
        pages: [
          fact('/'),
          fact('/privacy/', { words: 5000, inLinks: 40 }),
          fact('/terms-of-service/', { words: 4000, inLinks: 40 }),
          fact('/contact/', { words: 300, inLinks: 40 }),
          fact('/services/rigging/', { words: 1800, inLinks: 3 }),
          fact('/services/modeling/', { words: 2000, inLinks: 3 }),
          fact('/thin/', { words: 3000 }),
        ],
        indexing: indexing([
          { path: '/privacy/', state: 'Discovered - currently not indexed' },
          { path: '/terms-of-service/', state: 'URL is unknown to Google' },
          { path: '/contact/', state: 'URL is unknown to Google' },
          { path: '/services/rigging/', state: 'URL is unknown to Google' },
          { path: '/services/modeling/', state: 'Discovered - currently not indexed' },
          { path: '/thin/', state: 'URL is unknown to Google', reasons: 1 },
          { path: '/', state: 'Submitted and indexed' },
        ]),
      }),
    );
    const req = actions.find((a) => a.key === 'index-request')!;
    expect(req.pages.map((p) => p.url.slice(A.length))).toEqual([
      '/services/modeling/',
      '/services/rigging/',
      '/contact/',
    ]);
    expect(req.pages[0]!.inspectUrl).toMatch(/^https:\/\/search\.google\.com\//);
    expect(req.who).toBe('you');
  });

  it('turns Search Console opportunities into page-specific actions', () => {
    const { actions } = candidateActions(
      input({
        search: {
          cur: [],
          prev: [],
          totalImpressions: 900,
          opportunities: {
            top10Ctr: 0.1,
            closeToPageOne: [
              { query: 'character rigging service', page: `${A}/rig/`, impressions: 400, clicks: 3, position: 11.2 },
            ],
            lowCtr: [{ query: 'likeness', page: `${A}/like/`, impressions: 500, clicks: 1, ctr: 0.002, position: 6 }],
            losing: [{ page: `${A}/old/`, clicks: 2, prevClicks: 25 }],
          },
        },
      }),
    );
    const near = actions.find((a) => a.key === 'near:character rigging service')!;
    expect(near.title).toBe('Improve /rig/ for "character rigging service"');
    expect(near.why).toMatch(/position 11\.2/);
    expect(near.closesItself).toBe(false);
    expect(actions.find((a) => a.key === 'ctr:likeness')!.why).toMatch(/0\.2% of 500/);
    expect(actions.find((a) => a.key === `losing:${A}/old/`)!.why).toMatch(/from 25 to 2/);
  });
});

describe('stage', () => {
  const search = (rows: [string, number, number][], prev: [string, number, number][] = []) => ({
    cur: rows.map(([query, impressions, clicks]) => ({ query, impressions, clicks, position: 15 })),
    prev: prev.map(([query, impressions, clicks]) => ({ query, impressions, clicks, position: 15 })),
    totalImpressions: rows.reduce((t, r) => t + r[1], 0),
    opportunities: noOpps,
  });
  const indexed = indexing([
    { path: '/', state: 'Submitted and indexed' },
    { path: '/b/', state: 'Submitted and indexed' },
  ]);
  it('needs Search Console', () => {
    expect(candidateActions(input()).stage).toBeNull();
  });
  it('is 0 while most wanted pages are not indexed', () => {
    const ix = indexing([
      { path: '/', state: 'Submitted and indexed' },
      { path: '/b/', state: 'URL is unknown to Google' },
      { path: '/c/', state: 'URL is unknown to Google' },
    ]);
    const s = candidateActions(input({ indexing: ix, search: search([]) })).stage!;
    expect(s.level).toBe(0);
    expect(s.facts[0]).toMatch(/1 of 3/);
  });
  it('is 1 when people only find the site by its name', () => {
    const s = candidateActions(input({ indexing: indexed, search: search([['brightleaf studio', 500, 40]]) })).stage!;
    expect(s.level).toBe(1);
    expect(s.facts.join(' ')).toMatch(/500 were for your name and 0 for anything else/);
  });
  it('is 2, 3 or 4 from searches for anything else', () => {
    expect(candidateActions(input({ indexing: indexed, search: search([['3d rigging', 300, 2]]) })).stage!.level).toBe(
      2,
    );
    const near = {
      ...search([['3d rigging', 300, 2]]),
      opportunities: {
        ...noOpps,
        closeToPageOne: [{ query: '3d rigging', page: `${A}/r/`, impressions: 300, clicks: 2, position: 12 }],
      },
    };
    expect(candidateActions(input({ indexing: indexed, search: near })).stage!.level).toBe(3);
    expect(
      candidateActions(
        input({ indexing: indexed, search: search([['3d rigging', 900, 30]], [['3d rigging', 600, 12]]) }),
      ).stage!.level,
    ).toBe(4);
  });
});

/** A store with one site and a check whose findings and page facts the test controls. */
function siteWith() {
  const store = new Store(':memory:');
  const site = store.addSite(A, 'A Studio');
  let t = Date.parse('2026-11-16T06:00:00Z');
  const check = (findings: Finding[], pages: PageFact[] = [fact('/')]) => {
    const runId = store.startRun(site.id, 'cli');
    store.db.prepare(`UPDATE runs SET started_at = ? WHERE id = ?`).run(new Date(t).toISOString(), runId);
    const report = {
      schemaVersion: 1,
      tool: { name: 'x-find', version: '0' },
      generatedAt: '',
      mode: 'live',
      site: A,
      pagesChecked: pages.length,
      staging: false,
      findings,
      checks: [],
      scores: [],
      overrides: [],
      formula: '',
    } as unknown as Report;
    store.finishRun(runId, report, { crawlerAccess: [], urls: pages.map((p) => p.url), pages });
    const now = new Date(t);
    reconcileActions(store, site.id, now);
    t += 86_400_000;
    return now;
  };
  const status = () =>
    Object.fromEntries(
      store.db
        .prepare(`SELECT key, status, done_by FROM actions WHERE site_id = ?`)
        .all(site.id)
        .map((r) => [String(r['key']), `${String(r['status'])}${r['done_by'] ? `/${String(r['done_by'])}` : ''}`]),
    );
  return { store, site, check, status, at: () => new Date(t) };
}

describe('done detection', () => {
  const noindex = finding('robots-meta-noindex', 'error', '/x/');

  it('closes an action by itself when the next check no longer finds the problem, and reopens it if it returns', () => {
    const { store, site, check, status } = siteWith();
    check([noindex]);
    expect(status()).toEqual({ 'finding:robots-meta-noindex:error': 'open' });
    check([]);
    expect(status()).toEqual({ 'finding:robots-meta-noindex:error': 'done/x-find' });
    const w = weekView(store, site.id);
    expect(w.thisWeek).toEqual([]);
    expect(w.done.map((a) => a.doneBy)).toEqual(['x-find']);
    check([noindex]);
    expect(status()).toEqual({ 'finding:robots-meta-noindex:error': 'open' });
    expect(weekView(store, site.id).thisWeek[0]!.note).toMatch(/came back/);
  });

  it('reopens a crawl problem the owner marked done when the next check still finds it', () => {
    const { store, site, check, status, at } = siteWith();
    check([noindex]);
    // Marked done an hour before the next daily check.
    setActionStatus(store, site.id, 'finding:robots-meta-noindex:error', 'done', new Date(at().getTime() - 3_600_000));
    expect(status()).toEqual({ 'finding:robots-meta-noindex:error': 'done/you' });
    check([noindex]);
    expect(status()).toEqual({ 'finding:robots-meta-noindex:error': 'open' });
    // The reason survives later refreshes (each Search Console sync and each `x-find week` refreshes too).
    reconcileActions(store, site.id);
    expect(weekView(store, site.id).thisWeek[0]!.note).toMatch(/still finds it/);
  });

  it('keeps dismissed actions dismissed and shows at most three a week', () => {
    const { store, site, check, status } = siteWith();
    const many = ['a', 'b', 'c', 'd'].map((p) => finding(`check-${p}`, 'warning', `/${p}/`));
    check(many);
    const w = weekView(store, site.id);
    expect(w.thisWeek).toHaveLength(3);
    expect(w.backlog).toHaveLength(1);
    setActionStatus(store, site.id, 'finding:check-a:warning', 'dismissed');
    check(many);
    expect(status()['finding:check-a:warning']).toBe('dismissed');
    expect(weekView(store, site.id).thisWeek.map((a) => a.key)).not.toContain('finding:check-a:warning');
  });

  it('does not close anything when there is no successful check to compare with', () => {
    const { store, site, check, status } = siteWith();
    check([noindex]);
    // A failed check leaves the last successful one in place: nothing changes.
    const runId = store.startRun(site.id, 'cli');
    store.failRun(runId, 'network down');
    reconcileActions(store, site.id);
    expect(status()).toEqual({ 'finding:robots-meta-noindex:error': 'open' });
  });

  it('rejects unknown actions', () => {
    const { store, site } = siteWith();
    expect(setActionStatus(store, site.id, 'nope', 'done')).toBe(false);
  });
});

describe('done detection for Search Console actions', () => {
  /** Stores what a Search Console sync would: the 28-day windows, one search near page one, and inspections. */
  function withSearch(opts: { near: boolean; unindexed: string[]; at: Date }) {
    const { store, site, check, status } = siteWith();
    check([], [fact('/'), ...opts.unindexed.map((p) => fact(p))]);
    const db = store.db;
    db.prepare(
      `INSERT INTO gsc_meta (site_id, property, cur_start, cur_end, prev_start, prev_end, synced_at) VALUES (?, 'sc-domain:a.com', '2026-10-17', '2026-11-13', '2026-09-19', '2026-10-16', ?)
       ON CONFLICT(site_id) DO UPDATE SET synced_at = excluded.synced_at`,
    ).run(site.id, opts.at.toISOString());
    db.prepare(`DELETE FROM gsc_rows WHERE site_id = ?`).run(site.id);
    if (opts.near)
      db.prepare(
        `INSERT INTO gsc_rows (site_id, period, kind, k1, k2, clicks, impressions, ctr, position) VALUES (?, 'cur', 'query_page', '3d rigging', ?, 2, 300, 0.006, 12)`,
      ).run(site.id, `${A}/`);
    db.prepare(`DELETE FROM inspections WHERE site_id = ?`).run(site.id);
    for (const p of ['/', ...opts.unindexed])
      db.prepare(
        `INSERT INTO inspections (site_id, url, verdict, coverage_state, checked_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        site.id,
        A + p,
        p === '/' ? 'PASS' : 'NEUTRAL',
        p === '/' ? 'Submitted and indexed' : 'URL is unknown to Google',
        opts.at.toISOString(),
      );
    db.prepare(`INSERT INTO gsc_syncs (site_id, at, status, inspected) VALUES (?, ?, 'ok', 1)`).run(
      site.id,
      opts.at.toISOString(),
    );
    reconcileActions(store, site.id, opts.at);
    return { store, site, status };
  }

  it('lets advice from numbers expire instead of counting it as done', () => {
    const t = new Date('2026-11-17T08:00:00Z');
    const { store, site, status } = withSearch({ near: true, unindexed: [], at: t });
    expect(status()['near:3d rigging']).toBe('open');
    store.db.prepare(`DELETE FROM gsc_rows WHERE site_id = ?`).run(site.id);
    store.db.prepare(`INSERT INTO gsc_syncs (site_id, at, status) VALUES (?, ?, 'ok')`).run(site.id, t.toISOString());
    reconcileActions(store, site.id, t);
    expect(status()['near:3d rigging']).toBe('expired');
    expect(weekView(store, site.id, t).done).toEqual([]);
  });

  it('keeps nothing closed on a failed sync', () => {
    const t = new Date('2026-11-17T08:00:00Z');
    const { store, site, status } = withSearch({ near: true, unindexed: [], at: t });
    store.db.prepare(`DELETE FROM gsc_rows WHERE site_id = ?`).run(site.id);
    store.db
      .prepare(`INSERT INTO gsc_syncs (site_id, at, status, error) VALUES (?, ?, 'failed', 'x')`)
      .run(site.id, t.toISOString());
    reconcileActions(store, site.id, t);
    expect(status()['near:3d rigging']).toBe('open');
  });

  it('keeps "requested indexing" done for two weeks, then brings it back if pages are still waiting', () => {
    const t = new Date('2026-11-17T08:00:00Z');
    const { store, site, status } = withSearch({ near: false, unindexed: ['/services/a/'], at: t });
    expect(status()['index-request']).toBe('open');
    setActionStatus(store, site.id, 'index-request', 'done', t);
    reconcileActions(store, site.id, new Date('2026-11-24T08:00:00Z'));
    expect(status()['index-request']).toBe('done/you');
    reconcileActions(store, site.id, new Date('2026-12-02T08:00:00Z'));
    expect(status()['index-request']).toBe('open');
    expect(weekView(store, site.id).thisWeek.find((a) => a.key === 'index-request')!.note).toMatch(/14 days/);
  });

  it('closes "request indexing" by itself once Google has indexed the pages', () => {
    const t = new Date('2026-11-17T08:00:00Z');
    const { store, site, status } = withSearch({ near: false, unindexed: ['/services/a/'], at: t });
    store.db
      .prepare(`UPDATE inspections SET verdict = 'PASS', coverage_state = 'Submitted and indexed' WHERE site_id = ?`)
      .run(site.id);
    store.db.prepare(`INSERT INTO gsc_syncs (site_id, at, status) VALUES (?, ?, 'ok')`).run(site.id, t.toISOString());
    reconcileActions(store, site.id, t);
    expect(status()['index-request']).toBe('done/x-find');
  });
});
