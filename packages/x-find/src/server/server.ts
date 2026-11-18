import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { CRAWLERS } from '../core/crawlers.js';
import { diffReports } from '../core/diff.js';
import { labelText } from '../core/report/group.js';
import { formatHtml } from '../core/report/html.js';
import { geoView } from './geo.js';
import { findingLabel } from '../core/run.js';
import type { Finding, Report } from '../core/types.js';
import { VERSION } from '../core/version.js';
import {
  checkPassword,
  clientIp,
  hasSession,
  isRemote,
  LoginLimiter,
  loginPage,
  remoteOffPage,
  sessionCookie,
} from './auth.js';
import { searchView } from './gsc.js';
import { runningAsService } from './service.js';
import { linkMap } from './linkmap.js';
import { focusView, reconcileActions, setActionStatus, weekView } from './weekly.js';
import type { SearchSyncer } from './gsc.js';
import type { RunQueue } from './runner.js';
import type { Store } from './store.js';

const DASHBOARD = new URL('../../assets/dashboard.html', import.meta.url);
const FOCUS = new URL('../../assets/focus.html', import.meta.url);
/** Shared files the two pages load: the penguin art and the glass background. */
const SHARED: Record<string, { file: URL; type: string }> = {
  '/assets/art.js': { file: new URL('../../assets/art.js', import.meta.url), type: 'text/javascript; charset=utf-8' },
  '/assets/glass.css': { file: new URL('../../assets/glass.css', import.meta.url), type: 'text/css; charset=utf-8' },
};

export interface ServerOptions {
  store: Store;
  queue: RunQueue;
  search: SearchSyncer;
  port: number;
  host: string;
  /** Password for requests that don't come from this computer (tunnels, proxies, LAN). null = refuse them. */
  password?: string | null;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, 'Body too large');
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** Groups findings by check, worst first, for the to-do list. */
function groupByCheck(findings: Finding[], firstSeen: Map<string, string>) {
  const map = new Map<
    string,
    {
      checkId: string;
      title: string;
      severity: string;
      category: string;
      fix: string;
      sources: string[];
      /** "Required", "Recommended · estimate"…: what the finding means, apart from what it costs. */
      label: string;
      items: unknown[];
    }
  >();
  for (const f of findings) {
    let g = map.get(f.checkId + f.severity);
    if (!g) {
      g = {
        checkId: f.checkId,
        title: f.title,
        severity: f.severity,
        category: f.category,
        fix: f.fix,
        sources: f.sources,
        label: labelText(findingLabel(f)),
        items: [],
      };
      map.set(f.checkId + f.severity, g);
    }
    g.items.push({
      url: f.url ?? null,
      message: f.message,
      evidence: f.evidence ?? null,
      fingerprint: f.fingerprint,
      firstSeen: firstSeen.get(f.fingerprint) ?? null,
    });
  }
  const rank: Record<string, number> = { error: 0, warning: 1, notice: 2 };
  return [...map.values()].sort((a, b) => rank[a.severity]! - rank[b.severity]! || b.items.length - a.items.length);
}

/** Everything the dashboard shows for one site, from stored runs only. */
export function siteView(store: Store, siteId: number, queue: RunQueue, search: SearchSyncer) {
  const site = store.site(siteId);
  if (!site) throw new HttpError(404, 'No such site');
  const [latestRun, previousRun] = store.okRuns(siteId, 2);
  const report: Report | null = latestRun ? store.report(latestRun.id) : null;
  const previous: Report | null = previousRun ? store.report(previousRun.id) : null;
  const live = latestRun ? store.live(latestRun.id) : null;
  const findings = report?.findings ?? [];
  const firstSeen = store.firstSeen(
    siteId,
    findings.map((f) => f.fingerprint),
  );
  const diff = report && previous ? diffReports(previous, report) : null;
  const history = store
    .okRuns(siteId, 120)
    .reverse()
    .map((r) => ({ at: r.startedAt, seo: r.seo, aeo: r.aeo, geo: r.geo, errors: r.errors, warnings: r.warnings }));

  const blockedByRobots = (token: string) =>
    findings.some(
      (f) =>
        (f.checkId === 'ai-search-bot-blocked' || f.checkId === 'ai-training-bot-policy') &&
        f.message.startsWith(`${token} `),
    );
  const home = `${site.origin}/`;
  const crawlers = CRAWLERS.map((c) => {
    const access = live?.crawlerAccess.find((a) => a.crawlerId === c.id && a.url === home);
    return {
      id: c.id,
      token: c.token,
      operator: c.operator,
      purpose: c.purpose,
      affects: c.affects,
      robots: report ? (blockedByRobots(c.token) ? 'blocked' : 'allowed') : null,
      status: access?.status ?? null,
      challenge: access?.challenge ?? false,
      tested: !!access,
    };
  });

  const checks = report?.checks ?? [];
  return {
    // Whether daily checks keep running without a terminal (x-find service install).
    background: runningAsService(),
    site: { id: site.id, origin: site.origin, name: site.name, runHour: site.runHour },
    running: queue.pending(siteId),
    latest: latestRun ?? null,
    report: report
      ? {
          generatedAt: report.generatedAt,
          pagesChecked: report.pagesChecked,
          mode: report.mode,
          scores: report.scores,
          formula: report.formula,
          checkCounts: {
            total: checks.length,
            passed: checks.filter((c) => c.status === 'passed').length,
            failed: checks.filter((c) => c.status === 'failed').length,
            notMeasured: checks.filter((c) => c.status === 'not-measured').length,
          },
        }
      : null,
    tasks: groupByCheck(
      findings.filter((f) => f.severity !== 'notice'),
      firstSeen,
    ),
    notices: groupByCheck(
      findings.filter((f) => f.severity === 'notice'),
      firstSeen,
    ),
    changes: diff
      ? {
          since: previousRun!.startedAt,
          added: diff.added.map((f) => ({
            checkId: f.checkId,
            title: f.title,
            severity: f.severity,
            url: f.url ?? null,
            message: f.message,
          })),
          fixed: diff.fixed.map((f) => ({
            checkId: f.checkId,
            title: f.title,
            severity: f.severity,
            url: f.url ?? null,
            message: f.message,
          })),
          scoreDelta: diff.scoreDelta,
        }
      : null,
    history,
    crawlers,
    runs: store.runs(siteId, 20),
    links: linkMap(site.origin, live?.pages ?? null, findings),
    geo: geoView(site.origin, live?.entity, findings),
    focus: (() => {
      try {
        return focusView(store, siteId);
      } catch (e) {
        console.error(e);
        return null;
      }
    })(),
    week: (() => {
      try {
        return weekView(store, siteId);
      } catch (e) {
        console.error(e);
        return null;
      }
    })(),
    search: (() => {
      const client = search.client();
      return { ...searchView(store, siteId, !!client, client?.email ?? null), syncing: search.pending(siteId) };
    })(),
  };
}

export function createServer({ store, queue, search, port, host, password = null }: ServerOptions): http.Server {
  const limiter = new LoginLimiter();
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `${host}:${port}`]);

  const server = http.createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: only answer requests addressed to this machine by name.
      const hostHeader = (req.headers.host ?? '').toLowerCase();
      const actualPort = (server.address() as { port: number } | null)?.port ?? port;
      const okHost =
        allowedHosts.has(hostHeader) ||
        [`localhost:${actualPort}`, `127.0.0.1:${actualPort}`, `${host}:${actualPort}`].includes(hostHeader);
      // A remote request with a password set is checked by the login below instead.
      if (!okHost && !(password && isRemote(req))) throw new HttpError(421, 'Unexpected Host header');

      const url = new URL(req.url ?? '/', `http://${hostHeader}`);
      const method = req.method ?? 'GET';

      // Remote requests (tunnel, proxy, network) need a password and a session; local ones don't.
      if (isRemote(req)) {
        const html = (status: number, body: string, headers: Record<string, string> = {}) => {
          res.writeHead(status, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-frame-options': 'DENY',
            ...headers,
          });
          res.end(body);
        };
        if (!password) return html(403, remoteOffPage());
        if (url.pathname === '/login') {
          if (method === 'GET') return html(200, loginPage());
          if (method === 'POST') {
            const ip = clientIp(req);
            if (limiter.blocked(ip)) return html(429, loginPage('Too many attempts. Try again in 15 minutes.'));
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const c of req) {
              size += (c as Buffer).length;
              if (size > 4096) throw new HttpError(413, 'Body too large');
              chunks.push(c as Buffer);
            }
            // Surrounding whitespace is never part of the password (copy-paste adds it; the stored one is trimmed).
            const given = (new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('password') ?? '').trim();
            if (!checkPassword(given, password)) {
              limiter.fail(ip);
              return html(401, loginPage('Wrong password.'));
            }
            limiter.clear(ip);
            return html(303, '', { location: '/', 'set-cookie': sessionCookie(req, password) });
          }
        }
        if (!hasSession(req, password)) {
          if (url.pathname.startsWith('/api/')) throw new HttpError(401, 'Sign in first');
          return html(303, '', { location: '/login' });
        }
      }

      if (method !== 'GET' && method !== 'HEAD') {
        // Writes need a custom header, which a cross-site form or image can't send (and a cross-site fetch can't
        // without a CORS preflight this server never approves).
        if (req.headers['x-find-request'] !== '1') throw new HttpError(403, 'Missing x-find-request header');
      }

      // The one-task screen is the start page; the full dashboard stays at /details.
      const page =
        url.pathname === '/' || url.pathname === '/index.html' ? FOCUS : url.pathname === '/details' ? DASHBOARD : null;
      const shared = method === 'GET' ? SHARED[url.pathname] : undefined;
      if (shared) {
        res.writeHead(200, {
          'content-type': shared.type,
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
        });
        res.end(await readFile(shared.file, 'utf8'));
        return;
      }
      if (method === 'GET' && page) {
        const html = await readFile(page, 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
        });
        res.end(html);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/status') {
        return json(res, 200, { version: VERSION, sites: store.sites().length });
      }

      if (url.pathname === '/api/sites') {
        if (method === 'GET') {
          return json(
            res,
            200,
            store.sites().map((s) => ({
              id: s.id,
              origin: s.origin,
              name: s.name,
              runHour: s.runHour,
              latest: store.okRuns(s.id, 1)[0] ?? null,
              running: queue.pending(s.id),
            })),
          );
        }
        if (method === 'POST') {
          const body = await readJson(req);
          const origin = typeof body['origin'] === 'string' ? body['origin'] : '';
          let parsed: URL;
          try {
            parsed = new URL(origin);
            if (!/^https?:$/.test(parsed.protocol)) throw new Error();
          } catch {
            throw new HttpError(400, 'origin must be an http(s) URL');
          }
          if (store.siteByOrigin(parsed.origin)) throw new HttpError(409, 'Site already added');
          const name = typeof body['name'] === 'string' && body['name'].trim() ? body['name'].trim() : parsed.hostname;
          const site = store.addSite(parsed.origin, name);
          queue.enqueue(site.id, 'manual');
          return json(res, 201, { id: site.id });
        }
      }

      const siteMatch = /^\/api\/sites\/(\d+)(\/run|\/search-sync)?$/.exec(url.pathname);
      if (siteMatch) {
        const id = Number(siteMatch[1]);
        if (!store.site(id)) throw new HttpError(404, 'No such site');
        if (!siteMatch[2] && method === 'GET') return json(res, 200, siteView(store, id, queue, search));
        if (siteMatch[2] === '/run' && method === 'POST') {
          const queued = queue.enqueue(id, 'manual');
          return json(res, 202, { queued, running: queue.pending(id) });
        }
        if (siteMatch[2] === '/search-sync' && method === 'POST') {
          if (!search.client()) throw new HttpError(409, 'Search Console is not connected');
          void search.sync(id);
          return json(res, 202, { syncing: true });
        }
      }

      const actionMatch = /^\/api\/sites\/(\d+)\/actions$/.exec(url.pathname);
      if (actionMatch && method === 'POST') {
        const id = Number(actionMatch[1]);
        if (!store.site(id)) throw new HttpError(404, 'No such site');
        const body = await readJson(req);
        const key = typeof body['key'] === 'string' ? body['key'] : '';
        const status = body['status'];
        if (!key || (status !== 'done' && status !== 'dismissed' && status !== 'open' && status !== 'waiting'))
          throw new HttpError(400, 'key and status (done, dismissed, open or waiting) are required');
        if (!setActionStatus(store, id, key, status)) throw new HttpError(404, 'No such action');
        return json(res, 200, { ok: true });
      }

      // "Check if it's fixed": re-check the live site (or ask Google), then say whether this task is done.
      const checkMatch = /^\/api\/sites\/(\d+)\/actions\/check$/.exec(url.pathname);
      if (checkMatch && method === 'POST') {
        const id = Number(checkMatch[1]);
        if (!store.site(id)) throw new HttpError(404, 'No such site');
        const body = await readJson(req);
        const key = typeof body['key'] === 'string' ? body['key'] : '';
        const before = focusView(store, id).tasks.find((t) => t.key === key);
        if (!before) throw new HttpError(404, 'No such task');
        if (before.check === 'search') {
          if (!search.client()) throw new HttpError(409, 'Search Console is not connected');
          await search.sync(id);
        } else {
          queue.enqueue(id, 'manual');
          await queue.whenIdle();
        }
        reconcileActions(store, id);
        const after = focusView(store, id).tasks.find((t) => t.key === key) ?? null;
        const stored = store.db.prepare(`SELECT status FROM actions WHERE site_id = ? AND key = ?`).get(id, key)?.[
          'status'
        ];
        const latest = store.runs(id, 1)[0];
        return json(res, 200, {
          status: String(stored ?? after?.status ?? 'open'),
          task: after,
          checkFailed: before.check === 'crawl' && latest?.status === 'failed' ? latest.error : null,
        });
      }

      const runMatch = /^\/runs\/(\d+)\/report\.(html|json)$/.exec(url.pathname);
      if (runMatch && method === 'GET') {
        const run = store.run(Number(runMatch[1]));
        const report = run ? store.report(run.id) : null;
        if (!run || !report) throw new HttpError(404, 'No such report');
        if (runMatch[2] === 'json') {
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="x-find-${run.id}.json"`,
          });
          res.end(JSON.stringify(report, null, 2));
          return;
        }
        const previous = store.okRuns(run.siteId, 50).find((r) => r.startedAt < run.startedAt);
        const prevReport = previous ? store.report(previous.id) : null;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
        res.end(formatHtml(report, prevReport ? { diff: diffReports(prevReport, report) } : {}));
        return;
      }

      throw new HttpError(404, 'Not found');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      json(res, status, { error: e instanceof HttpError ? e.message : 'Internal error' });
    }
  });
  return server;
}
