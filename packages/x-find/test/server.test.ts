import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import { runChecks } from '../src/core/run.js';
import { loadFolder } from '../src/node/folder.js';
import { runCommand, serveCommand, sitesCommand } from '../src/server/commands.js';
import { entityFacts } from '../src/core/entity.js';
import { isDue, RunQueue } from '../src/server/runner.js';
import type { SiteRunner } from '../src/server/runner.js';
import { createServer } from '../src/server/server.js';
import { SearchSyncer } from '../src/server/gsc.js';
import { Store } from '../src/server/store.js';
import { reconcileActions } from '../src/server/weekly.js';
import type { RunRow, SiteRow } from '../src/server/store.js';

const fixture = (n: string) => path.join(import.meta.dirname, 'fixtures', n);

/** A runner that returns the bad fixture first, then the good one, without any network. */
function fixtureRunner(sequence: string[]): SiteRunner {
  let i = 0;
  return async () => {
    const name = sequence[Math.min(i++, sequence.length - 1)]!;
    const config = resolveConfig({ site: 'https://example.com' });
    const site = await loadFolder(fixture(name), { site: config.site, trailingSlash: 'ignore' });
    return { report: runChecks(site, config), live: { crawlerAccess: [], entity: entityFacts(site, config) } };
  };
}

describe('Store', () => {
  it('stores runs with scores, counts and findings', async () => {
    const store = new Store(':memory:');
    const site = store.addSite('https://example.com/some/path', 'Example');
    expect(site.origin).toBe('https://example.com');
    const queue = new RunQueue(store, fixtureRunner(['bad']));
    queue.enqueue(site.id, 'manual');
    expect(queue.enqueue(site.id, 'manual')).toBe(false); // already queued
    await queue.whenIdle();
    const [run] = store.runs(site.id);
    expect(run).toMatchObject({ status: 'ok', trigger: 'manual', pages: 7 });
    expect(run!.errors).toBeGreaterThan(0);
    const report = store.report(run!.id)!;
    const fps = report.findings.map((f) => f.fingerprint);
    expect(store.firstSeen(site.id, fps).size).toBe(fps.length);
    store.close();
  });

  it('records a failed run with its error', async () => {
    const store = new Store(':memory:');
    const site = store.addSite('https://example.com', 'Example');
    const queue = new RunQueue(store, async () => {
      throw new Error('getaddrinfo ENOTFOUND example.com');
    });
    queue.enqueue(site.id, 'schedule');
    await queue.whenIdle();
    expect(store.runs(site.id)[0]).toMatchObject({ status: 'failed', error: 'getaddrinfo ENOTFOUND example.com' });
    store.close();
  });

  it('marks a run interrupted by a crash as failed on the next start', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'x-find-store-')), 'x.db');
    const a = new Store(file);
    const site = a.addSite('https://example.com', 'Example');
    a.startRun(site.id, 'schedule');
    a.close();
    const b = new Store(file);
    expect(b.runs(site.id)[0]).toMatchObject({ status: 'failed', error: 'interrupted' });
    b.close();
  });
});

describe('isDue', () => {
  const site = { id: 1, runHour: 6 } as SiteRow;
  const at = (s: string) => new Date(s);
  const run = (startedAt: string, status: RunRow['status'] = 'ok') =>
    ({ startedAt: at(startedAt).toISOString(), status }) as RunRow;

  it('runs a site that was never checked', () => {
    expect(isDue(site, [], at('2026-11-15T03:00'))).toBe(true);
  });
  it('waits for the hour, then runs once a day', () => {
    const yesterday = [run('2026-11-14T06:05')];
    expect(isDue(site, yesterday, at('2026-11-15T05:59'))).toBe(false);
    expect(isDue(site, yesterday, at('2026-11-15T06:00'))).toBe(true);
    expect(isDue(site, [run('2026-11-15T06:01'), ...yesterday], at('2026-11-15T09:00'))).toBe(false);
  });
  it('catches up when the computer was off at the usual time', () => {
    expect(isDue(site, [run('2026-11-13T06:05')], at('2026-11-15T02:00'))).toBe(true);
  });
  it('waits an hour after a failure, and never runs twice at once', () => {
    const failed = [run('2026-11-15T06:00', 'failed'), run('2026-11-14T06:00')];
    expect(isDue(site, failed, at('2026-11-15T06:30'))).toBe(false);
    expect(isDue(site, failed, at('2026-11-15T07:01'))).toBe(true);
    expect(isDue(site, [run('2026-11-15T06:00', 'running')], at('2026-11-15T09:00'))).toBe(false);
  });
});

describe('HTTP API', () => {
  let store: Store, server: ReturnType<typeof createServer>, base: string, queue: RunQueue;
  beforeAll(async () => {
    store = new Store(':memory:');
    queue = new RunQueue(store, fixtureRunner(['bad', 'good']));
    server = createServer({ store, queue, search: new SearchSyncer(store, () => null), port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  });
  const post = (p: string, body?: unknown, headers: Record<string, string> = { 'x-find-request': '1' }) =>
    fetch(base + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : null,
    });

  it('serves the one-task screen, the full dashboard, the art and the glass styles with a strict content security policy', async () => {
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    const html = await res.text();
    expect(html).toMatch(/<title>x-find<\/title>/);
    expect(html).toContain('/assets/art.js');
    const details = await fetch(base + '/details');
    expect(details.status).toBe(200);
    expect(await details.text()).toMatch(/Readiness over time/);
    const art = await fetch(base + '/assets/art.js');
    expect(art.headers.get('content-type')).toMatch(/javascript/);
    expect(await art.text()).toMatch(/globalThis\.ART/);
    const glass = await fetch(base + '/assets/glass.css');
    expect(glass.headers.get('content-type')).toMatch(/text\/css/);
    expect(await glass.text()).toMatch(/\.ambient/);
    expect(html).toContain('/assets/glass.css');
  });

  it('refuses requests addressed to another host name (DNS rebinding)', async () => {
    // fetch() won't let a caller set Host, so use a raw request like a rebinding page would produce.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(base + '/api/sites', { headers: { host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
  });

  it('refuses writes without the x-find-request header (CSRF)', async () => {
    expect((await post('/api/sites', { origin: 'https://example.com' }, {})).status).toBe(403);
  });

  it('validates new sites', async () => {
    expect((await post('/api/sites', { origin: 'ftp://example.com' })).status).toBe(400);
    expect((await post('/api/sites', 'nope')).status).toBe(400);
  });

  it('adds a site, checks it, and shows tasks, scores and crawlers', async () => {
    const res = await post('/api/sites', { origin: 'https://example.com' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect((await post('/api/sites', { origin: 'https://example.com/' })).status).toBe(409);
    await queue.whenIdle();
    const view = (await (await fetch(`${base}/api/sites/${id}`)).json()) as {
      report: { scores: { score: number }[] };
      tasks: { severity: string; label: string; items: { firstSeen: string | null }[] }[];
      geo: { measured: boolean; items: { id: string; sources: string[] }[] };
      changes: unknown;
      crawlers: { token: string; robots: string }[];
      history: unknown[];
    };
    expect(view.report.scores).toHaveLength(3);
    expect(view.tasks[0]!.severity).toBe('error');
    expect(view.tasks[0]!.items[0]!.firstSeen).toBeTruthy();
    expect(view.tasks.every((t) => /^(Required|Recommended|For your information)( · estimate)?$/.test(t.label))).toBe(
      true,
    );
    expect(view.geo.measured).toBe(true);
    expect(view.geo.items.map((i) => i.id)).toContain('name');
    expect(view.changes).toBeNull(); // only one check so far
    expect(view.crawlers.find((c) => c.token === 'PerplexityBot')?.robots).toBe('blocked');
    expect(view.history).toHaveLength(1);
    // Tests don't run under launchd, so the sidebar must say "runs in a terminal".
    expect((view as unknown as { background: unknown }).background).toBe(false);
  });

  it("shows this week's actions and lets the owner mark one done or not relevant", async () => {
    const id = store.sites()[0]!.id;
    reconcileActions(store, id);
    type View = { week: { thisWeek: { key: string; steps: string[] }[]; done: { key: string }[] } };
    const before = (await (await fetch(`${base}/api/sites/${id}`)).json()) as View;
    expect(before.week.thisWeek.length).toBeGreaterThan(0);
    expect(before.week.thisWeek.length).toBeLessThanOrEqual(3);
    const key = before.week.thisWeek[0]!.key;
    expect((await post(`/api/sites/${id}/actions`, { key, status: 'done' }, {})).status).toBe(403);
    expect((await post(`/api/sites/${id}/actions`, { key, status: 'maybe' })).status).toBe(400);
    expect((await post(`/api/sites/${id}/actions`, { key: 'nope', status: 'done' })).status).toBe(404);
    expect((await post(`/api/sites/${id}/actions`, { key, status: 'done' })).status).toBe(200);
    const after = (await (await fetch(`${base}/api/sites/${id}`)).json()) as View;
    expect(after.week.done.map((a) => a.key)).toContain(key);
    expect(after.week.thisWeek.map((a) => a.key)).not.toContain(key);
  });

  it('runs again on request and reports what was fixed', async () => {
    const id = store.sites()[0]!.id;
    const res = await post(`/api/sites/${id}/run`);
    expect(res.status).toBe(202);
    await queue.whenIdle();
    const view = (await (await fetch(`${base}/api/sites/${id}`)).json()) as {
      changes: { fixed: unknown[]; added: unknown[] };
      runs: { id: number }[];
    };
    expect(view.changes.fixed.length).toBeGreaterThan(10);
    const html = await fetch(`${base}/runs/${view.runs[0]!.id}/report.html`);
    expect(await html.text()).toMatch(/fixed/);
  });

  it('answers 404 for unknown sites, runs and paths', async () => {
    expect((await fetch(`${base}/api/sites/999`)).status).toBe(404);
    expect((await fetch(`${base}/runs/999/report.html`)).status).toBe(404);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

describe('commands', () => {
  it('sites add/list, run and serve share the data in X_FIND_HOME', async () => {
    process.env['X_FIND_HOME'] = mkdtempSync(path.join(tmpdir(), 'x-find-home-'));
    expect(sitesCommand({ action: 'add', url: 'https://example.com', hour: 7 })).toBe(0);
    expect(() => sitesCommand({ action: 'add', url: 'https://example.com' })).toThrow(/already added/);
    expect(() => sitesCommand({ action: 'add', url: 'https://x.com', hour: 25 })).toThrow(/0–23/);
    expect(await runCommand(undefined, fixtureRunner(['good']), () => null)).toBe(0);
    await expect(runCommand('https://unknown.example', fixtureRunner(['good']), () => null)).rejects.toThrow(
      /not added/,
    );
    expect(sitesCommand({ action: 'list', url: undefined })).toBe(0);

    const { url, close } = await serveCommand({
      port: 0,
      host: '127.0.0.1',
      schedule: false,
      runner: fixtureRunner(['good']),
    });
    const sites = (await (await fetch(`${url}/api/sites`)).json()) as { origin: string; latest: { seo: number } }[];
    expect(sites).toMatchObject([{ origin: 'https://example.com', latest: { seo: 100 } }]);
    await close();
  });
});

describe('remote access (tunnels and proxies)', () => {
  const PASSWORD = 'correct horse battery';
  async function start(password: string | null) {
    const store = new Store(':memory:');
    const queue = new RunQueue(store, fixtureRunner(['good']));
    const server = createServer({
      store,
      queue,
      search: new SearchSyncer(store, () => null),
      port: 0,
      host: '127.0.0.1',
      password,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    // Like `cloudflared --http-host-header localhost:PORT`: the Host looks local, the Cloudflare headers don't.
    const req = (p: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
        const r = http.request(
          `http://127.0.0.1:${port}${p}`,
          {
            method: opts.method ?? 'GET',
            headers: {
              host: `localhost:${port}`,
              'cf-ray': 'abc-SIN',
              'cf-connecting-ip': '203.0.113.9',
              ...opts.headers,
            },
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
          },
        );
        r.on('error', reject);
        r.end(opts.body);
      });
    return {
      req,
      port,
      close: () =>
        new Promise<void>((r) =>
          server.close(() => {
            store.close();
            r();
          }),
        ),
    };
  }
  const login = (body: string) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  it('refuses tunnelled requests when no password is set, even with a rewritten Host', async () => {
    const s = await start(null);
    const r = await s.req('/api/sites');
    expect(r.status).toBe(403);
    expect(r.body).toMatch(/Remote access is off/);
    // Local requests still work.
    expect((await fetch(`http://127.0.0.1:${s.port}/api/sites`)).status).toBe(200);
    await s.close();
  });

  it('asks for the password, sets a session cookie, then serves the dashboard and API', async () => {
    const s = await start(PASSWORD);
    expect((await s.req('/')).headers.location).toBe('/login');
    expect((await s.req('/api/sites')).status).toBe(401);
    expect((await s.req('/login', login('password=wrong'))).status).toBe(401);
    // A pasted password with a trailing newline still works.
    const ok = await s.req('/login', login(`password=${encodeURIComponent(PASSWORD + '\n')}`));
    expect(ok.status).toBe(303);
    const cookie = String(ok.headers['set-cookie']).split(';')[0]!;
    expect(String(ok.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await s.req('/api/sites', { headers: { cookie } })).status).toBe(200);
    expect((await s.req('/', { headers: { cookie } })).status).toBe(200);
    // Writes still need the dashboard's own header.
    expect((await s.req('/api/sites', { method: 'POST', headers: { cookie }, body: '{}' })).status).toBe(403);
    await s.close();
  });

  it('accepts a tunnel hostname once a password is set', async () => {
    const s = await start(PASSWORD);
    expect((await s.req('/', { headers: { host: 'dash.example.com' } })).headers.location).toBe('/login');
    await s.close();
  });

  it('locks an address out after five wrong passwords', async () => {
    const s = await start(PASSWORD);
    for (let i = 0; i < 5; i++) expect((await s.req('/login', login('password=nope'))).status).toBe(401);
    expect((await s.req('/login', login(`password=${encodeURIComponent(PASSWORD)}`))).status).toBe(429);
    await s.close();
  });
});

describe('stored dashboard password', () => {
  it('x-find password new writes an owner-only random password that serve reads', async () => {
    const { passwordCommand, readPassword } = await import('../src/server/commands.js');
    const { statSync, readFileSync } = await import('node:fs');
    process.env['X_FIND_HOME'] = mkdtempSync(path.join(tmpdir(), 'x-find-pw-'));
    delete process.env['X_FIND_PASSWORD'];
    expect(readPassword()).toBeNull();
    expect(await passwordCommand('new')).toBe(0);
    const file = path.join(process.env['X_FIND_HOME'], 'dashboard-password');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const pw = readFileSync(file, 'utf8').trim();
    expect(pw).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(readPassword()).toBe(pw);
    process.env['X_FIND_PASSWORD'] = 'from-the-environment';
    expect(readPassword()).toBe('from-the-environment');
    delete process.env['X_FIND_PASSWORD'];
    expect(await passwordCommand('remove')).toBe(0);
    expect(readPassword()).toBeNull();
  });
});

describe('Check if it’s fixed', () => {
  it('re-checks the live site and reports a task done once the problem is gone', async () => {
    const store = new Store(':memory:');
    // First check finds problems; the re-check sees the fixed site.
    const queue = new RunQueue(store, fixtureRunner(['bad', 'good']));
    const server = createServer({
      store,
      queue,
      search: new SearchSyncer(store, () => null),
      port: 0,
      host: '127.0.0.1',
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const site = store.addSite('https://example.com', 'Example');
      queue.enqueue(site.id, 'manual');
      await queue.whenIdle();
      reconcileActions(store, site.id);
      type Focus = {
        focus: { tasks: { key: string; status: string; headline: string; brief: string }[]; left: number };
      };
      const view = (await (await fetch(`${base}/api/sites/${site.id}`)).json()) as Focus;
      expect(view.focus.left).toBeGreaterThan(0);
      const task = view.focus.tasks.find((t) => t.status === 'open')!;
      expect(task.headline.length).toBeGreaterThan(10);
      expect(task.brief).toMatch(/Done when:/);

      const post = (body: unknown, headers: Record<string, string> = { 'x-find-request': '1' }) =>
        fetch(`${base}/api/sites/${site.id}/actions/check`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
      expect((await post({ key: task.key }, {})).status).toBe(403);
      expect((await post({ key: 'nope' })).status).toBe(404);
      const res = (await (await post({ key: task.key })).json()) as { status: string };
      expect(res.status).toBe('done');
      expect(store.runs(site.id, 5)).toHaveLength(2);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    }
  });

  it('keeps an “I’ve asked Google” task waiting until Google has the pages', async () => {
    const store = new Store(':memory:');
    const site = store.addSite('https://example.com', 'Example');
    const queue = new RunQueue(store, fixtureRunner(['bad']));
    queue.enqueue(site.id, 'manual');
    await queue.whenIdle();
    reconcileActions(store, site.id);
    const key = String(store.db.prepare(`SELECT key FROM actions WHERE site_id = ? LIMIT 1`).get(site.id)!['key']);
    const { setActionStatus } = await import('../src/server/weekly.js');
    expect(setActionStatus(store, site.id, key, 'waiting')).toBe(true);
    reconcileActions(store, site.id);
    expect(
      store.db.prepare(`SELECT status FROM actions WHERE site_id = ? AND key = ?`).get(site.id, key)!['status'],
    ).toBe('waiting');
    store.close();
  });
});
