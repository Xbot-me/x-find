import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { RunQueue, Scheduler, liveRunner } from './runner.js';
import type { SiteRunner } from './runner.js';
import { explainGoogleError, matchProperty } from '../connectors/google.js';
import type { SearchConsole } from '../connectors/google.js';
import {
  installKey,
  loadClient,
  SearchSyncer,
  searchView,
  setProperty,
  siteIndexing,
  syncSearchConsole,
} from './gsc.js';
import { reconcileActions, weekView } from './weekly.js';
import { generatePassword, MIN_PASSWORD_LENGTH, PASSWORD_FILE } from './auth.js';
import { createServer } from './server.js';
import { Store } from './store.js';

/** Where the local service keeps its data: $X_FIND_HOME or ~/.x-find. */
export function homeDir(): string {
  return process.env['X_FIND_HOME'] || path.join(homedir(), '.x-find');
}

/**
 * The dashboard password: $X_FIND_PASSWORD, else the file written by `x-find password new`. null = no remote access.
 */
export function readPassword(): string | null {
  const env = process.env['X_FIND_PASSWORD']?.trim();
  if (env) return env;
  const file = path.join(homeDir(), PASSWORD_FILE);
  if (!existsSync(file)) return null;
  const value = readFileSync(file, 'utf8').trim();
  return value || null;
}

/** `x-find password new | show-path | remove`: the password for remote access, stored owner-only. */
export async function passwordCommand(action: string | undefined): Promise<number> {
  const file = path.join(homeDir(), PASSWORD_FILE);
  if (action === 'new') {
    await mkdir(homeDir(), { recursive: true });
    await writeFile(file, generatePassword() + '\n', { mode: 0o600 });
    await chmod(file, 0o600);
    out(`A new dashboard password is saved in ${file} (readable only by you).`);
    out(`Copy it: pbcopy < ${file}   (or open the file)`);
    out('Restart x-find serve to use it. Anyone signed in with the old password is signed out.');
    return 0;
  }
  if (action === 'remove') {
    if (existsSync(file)) await unlink(file);
    out('Password removed. After a restart, remote access is refused again.');
    return 0;
  }
  if (!action || action === 'status') {
    out(
      process.env['X_FIND_PASSWORD']
        ? 'Set by X_FIND_PASSWORD.'
        : existsSync(file)
          ? `Stored in ${file}.`
          : 'No password: remote access is refused.',
    );
    return 0;
  }
  throw new Error(`unknown action "${action}" (use new, status or remove)`);
}

export function openStore(): Store {
  return new Store(path.join(homeDir(), 'x-find.db'));
}

const out = (s: string) => process.stdout.write(s + '\n');

export interface SitesArgs {
  action: string | undefined;
  url: string | undefined;
  name?: string | undefined;
  hour?: number | undefined;
}

/** `x-find sites list | add <url> | remove` (remove is deliberately not offered: history is kept). */
export function sitesCommand(args: SitesArgs): number {
  const store = openStore();
  try {
    if (!args.action || args.action === 'list') {
      const sites = store.sites();
      if (!sites.length) out('No sites yet. Add one: x-find sites add https://example.com');
      for (const s of sites) {
        const last = store.okRuns(s.id, 1)[0];
        out(
          `${String(s.id).padStart(3)}  ${s.origin.padEnd(40)} daily after ${String(s.runHour).padStart(2, '0')}:00  ${
            last
              ? `last ${last.startedAt.slice(0, 16).replace('T', ' ')}  SEO ${last.seo} AEO ${last.aeo} GEO ${last.geo}`
              : 'not checked yet'
          }`,
        );
      }
      out(`Data: ${path.join(homeDir(), 'x-find.db')}`);
      return 0;
    }
    if (args.action === 'add') {
      if (!args.url || !/^https?:\/\//i.test(args.url))
        throw new Error('usage: x-find sites add https://example.com [--name "My site"] [--hour 6]');
      if (store.siteByOrigin(args.url)) throw new Error(`${new URL(args.url).origin} is already added`);
      const hour = args.hour ?? 6;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('--hour must be 0–23');
      const site = store.addSite(args.url, args.name ?? new URL(args.url).hostname, {}, hour);
      out(`Added ${site.origin} (id ${site.id}). Run it now with: x-find run ${site.origin}`);
      return 0;
    }
    throw new Error(`unknown action "${args.action}" (use list or add)`);
  } finally {
    store.close();
  }
}

/** The Search Console client from the key in the x-find folder, if one was connected. */
export function defaultSearchLoader(): SearchConsole | null {
  return loadClient(homeDir());
}

/** `x-find run [url]`: checks one or all sites now and stores the results (for cron, or by hand). */
export async function runCommand(
  url: string | undefined,
  runner: SiteRunner = liveRunner,
  loadSearch: () => SearchConsole | null = defaultSearchLoader,
): Promise<number> {
  const store = openStore();
  try {
    const sites = url ? [store.siteByOrigin(url)].filter((s) => s !== null) : store.sites();
    if (url && !sites.length) throw new Error(`${url} is not added. Add it with: x-find sites add ${url}`);
    if (!sites.length) throw new Error('No sites yet. Add one: x-find sites add https://example.com');
    let failed = 0;
    const search = new SearchSyncer(store, loadSearch, { inspectDelayMs: 120 }, out);
    const syncs: Promise<unknown>[] = [];
    const queue = new RunQueue(store, runner, (siteId, runId, ok) => {
      const site = store.site(siteId)!;
      const run = store.run(runId)!;
      if (ok)
        out(
          `${site.origin}  SEO ${run.seo} · AEO ${run.aeo} · GEO ${run.geo} · ${run.errors} errors, ${run.warnings} warnings`,
        );
      else {
        failed++;
        out(`${site.origin}  failed: ${run.error}`);
      }
      syncs.push(search.sync(siteId).then(() => reconcileActions(store, siteId)));
    });
    for (const s of sites) queue.enqueue(s.id, 'cli');
    await queue.whenIdle();
    await Promise.all(syncs);
    return failed ? 1 : 0;
  } finally {
    store.close();
  }
}

export interface ServeArgs {
  port: number;
  host: string;
  schedule: boolean;
  runner?: SiteRunner;
  loadSearch?: () => SearchConsole | null;
  /** Password for remote access (tunnels, proxies, network). Unset = remote requests are refused. */
  password?: string | null;
}

/** `x-find serve`: dashboard on localhost plus the daily schedule. Runs until stopped. */
export async function serveCommand(args: ServeArgs): Promise<{ close: () => Promise<void>; url: string }> {
  const store = openStore();
  const log = (line: string) => out(`[${new Date().toLocaleTimeString()}] ${line}`);
  const search = new SearchSyncer(store, args.loadSearch ?? defaultSearchLoader, { inspectDelayMs: 120 }, log);
  // After each check (daily or by hand), refresh Search Console data too.
  const queue = new RunQueue(store, args.runner ?? liveRunner, (siteId, runId, ok) => {
    const site = store.site(siteId);
    const run = store.run(runId);
    if (ok) log(`${site?.origin}  SEO ${run?.seo} · AEO ${run?.aeo} · GEO ${run?.geo}`);
    else log(`${site?.origin}  check failed: ${run?.error}`);
    safeReconcile(siteId);
    void search.sync(siteId).then(() => safeReconcile(siteId));
  });
  // The weekly list must never take the dashboard down with it.
  const safeReconcile = (siteId: number) => {
    try {
      reconcileActions(store, siteId);
    } catch (e) {
      log(`weekly actions for site ${siteId} could not be updated: ${(e as Error).message}`);
    }
  };
  for (const s of store.sites()) safeReconcile(s.id);
  if (args.password && args.password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`X_FIND_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  const server = createServer({
    store,
    queue,
    search,
    port: args.port,
    host: args.host,
    password: args.password ?? null,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(args.port, args.host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://${args.host === '0.0.0.0' || args.host === '::' ? 'localhost' : args.host}:${port}`;
  const scheduler = new Scheduler(store, queue);
  if (args.schedule) scheduler.start();
  return {
    url,
    close: async () => {
      scheduler.stop();
      await new Promise<void>((r) => server.close(() => r()));
      await queue.whenIdle();
      store.close();
    },
  };
}

/** `x-find week [url]`: the stage, this week's actions, and what was done recently. */
export function weekCommand(url: string | undefined): number {
  const store = openStore();
  try {
    const sites = url ? [store.siteByOrigin(url)].filter((s) => s !== null) : store.sites();
    if (url && !sites.length) throw new Error(`${url} is not added. Add it with: x-find sites add ${url}`);
    if (!sites.length) throw new Error('No sites yet. Add one: x-find sites add https://example.com');
    for (const site of sites) {
      reconcileActions(store, site.id);
      const w = weekView(store, site.id);
      out(`${site.name} · ${site.origin}`);
      out(
        w.stage
          ? `Stage ${w.stage.level} of 4: ${w.stage.name}. ${w.stage.job}\n  ${w.stage.facts.join('\n  ')}`
          : 'Stage: connect Search Console to see where the site stands (x-find gsc connect).',
      );
      out('');
      if (!w.thisWeek.length) out('This week: nothing to do. Every check passes.');
      else out('This week');
      w.thisWeek.forEach((a, i) => {
        out(`${i + 1}. ${a.title}  [${a.who}]`);
        if (a.note) out(`   ${a.note}`);
        out(`   Why: ${a.why}`);
        a.steps.forEach((st, j) => out(`   ${String.fromCharCode(97 + j)}) ${st}`));
        for (const p of a.pages.slice(0, 5)) out(`   · ${p.url}${p.inspectUrl ? `\n     ${p.inspectUrl}` : ''}`);
        out(`   Done when: ${a.doneWhen}`);
        out(`   Source: ${a.sources.join(' · ')}`);
      });
      if (w.backlog.length) out(`\nWaiting: ${w.backlog.length} more (${w.backlog.map((a) => a.title).join('; ')})`);
      if (w.done.length)
        out(
          `\nDone in the last 14 days:\n${w.done.map((a) => `  ✓ ${a.title} (${a.doneBy === 'x-find' ? 'x-find saw it fixed' : 'you marked it done'} ${String(a.doneAt).slice(0, 10)})`).join('\n')}`,
        );
      out('');
    }
    return 0;
  } finally {
    store.close();
  }
}

/** `x-find gsc connect --key <file> | status | sync [url] | property <url> <property>` */
export async function gscCommand(
  action: string | undefined,
  args: { key?: string | undefined; url?: string | undefined; property?: string | undefined },
  loadSearch: () => SearchConsole | null = defaultSearchLoader,
): Promise<number> {
  const store = openStore();
  try {
    if (action === 'connect') {
      if (!args.key) throw new Error('usage: x-find gsc connect --key ~/Downloads/your-key.json');
      const { email, path: dest } = await installKey(homeDir(), args.key);
      out(`Key saved to ${dest} (readable only by you). Service account: ${email}`);
      const client = loadSearch();
      if (!client) throw new Error('The key could not be loaded.');
      let properties: string[];
      try {
        properties = (await client.listSites()).map((p) => p.siteUrl);
      } catch (e) {
        throw new Error(explainGoogleError(e, email), { cause: e });
      }
      if (!properties.length) {
        out(`Google accepted the key, but ${email} can't see any property yet.`);
        out(
          'Add it in Search Console → Settings → Users and permissions → Add user (Restricted is enough), then run: x-find gsc sync',
        );
        return 0;
      }
      out(`Properties it can read: ${properties.join(', ')}`);
      for (const site of store.sites()) {
        const match = matchProperty(properties, site.origin);
        out(match ? `  ${site.origin} → ${match}` : `  ${site.origin} → no matching property yet`);
      }
      out('Run x-find gsc sync to pull the data now (it also runs after every daily check).');
      return 0;
    }
    if (action === 'property') {
      const site = args.url ? store.siteByOrigin(args.url) : null;
      if (!site || !args.property)
        throw new Error('usage: x-find gsc property https://example.com sc-domain:example.com');
      setProperty(store, site.id, args.property);
      out(`${site.origin} will use ${args.property}.`);
      return 0;
    }
    if (action === 'sync') {
      const client = loadSearch();
      if (!client) throw new Error('Search Console is not connected. Run: x-find gsc connect --key <file>');
      const sites = args.url ? [store.siteByOrigin(args.url)].filter((s) => s !== null) : store.sites();
      if (!sites.length) throw new Error(args.url ? `${args.url} is not added.` : 'No sites yet.');
      let failed = 0;
      for (const site of sites) {
        try {
          const r = await syncSearchConsole(store, site, client, { inspectDelayMs: 120 });
          out(`${site.origin}  ${r.property}: ${r.days} days, ${r.queries} searches, ${r.inspected} pages inspected`);
          reconcileActions(store, site.id);
          const ix = siteIndexing(store, site.id, r.property);
          if (ix.inspected)
            out(
              `${site.origin}  In Google: ${ix.indexed} of ${ix.inspected} inspected pages you want in search${ix.meant > ix.inspected ? ` (${ix.meant - ix.inspected} not inspected yet)` : ''}. ${ix.verdict}`,
            );
        } catch (e) {
          failed++;
          out(`${site.origin}  ${(e as Error).message}`);
        }
      }
      return failed ? 1 : 0;
    }
    if (!action || action === 'status') {
      const client = (() => {
        try {
          return loadSearch();
        } catch (e) {
          out(`The saved key can't be read: ${(e as Error).message}`);
          return null;
        }
      })();
      out(client ? `Connected as ${client.email}` : 'Not connected. Run: x-find gsc connect --key <file>');
      for (const site of store.sites()) {
        const v = searchView(store, site.id, !!client, client?.email ?? null);
        const last = v.lastSync as { at?: string; status?: string; error?: string } | null;
        out(
          `  ${site.origin}  ${v.property ?? 'no property yet'}  ${last ? `last sync ${String(last.at).slice(0, 16)} ${last.status}${last.error ? `: ${last.error}` : ''}` : 'never synced'}`,
        );
      }
      return 0;
    }
    throw new Error(`unknown action "${action}" (use connect, status, sync or property)`);
  } finally {
    store.close();
  }
}
