#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { builtInChecks } from '../core/checks/index.js';
import { ConfigError, resolveConfig } from '../core/config.js';
import { diffReports } from '../core/diff.js';
import { formatHtml } from '../core/report/html.js';
import { formatMarkdown } from '../core/report/markdown.js';
import { formatText } from '../core/report/text.js';
import { runChecks } from '../core/run.js';
import type { Report, Severity } from '../core/types.js';
import { VERSION } from '../core/version.js';
import { CONFIG_TEMPLATES, loadConfigFile } from './config.js';
import { loadFolder } from './folder.js';
import { crawlLive } from './live.js';

const HELP = `x-find ${VERSION}: can search and AI answer engines find, read and cite this site?

Usage
  x-find check <folder|url> [options]   Check a build folder (e.g. ./dist) or a live site
  x-find init [--preset ci|full]        Write x-find.config.mjs
  x-find checks                         List every check with its severity and source

Local service (dashboard + daily checks on this computer; data in ~/.x-find)
  x-find serve [--port 4747]            Dashboard at http://127.0.0.1:4747 and the daily schedule.
                                        Through a tunnel or proxy it needs a password:
  x-find password new                   Generate one (saved in ~/.x-find, owner-only; or set X_FIND_PASSWORD)
  x-find service install                Run serve in the background (macOS): starts at login, restarts if it stops
  x-find service status | uninstall     Check or remove the background service
  x-find sites add <url> [--hour 6]     Watch a site (checked daily after that local hour)
  x-find sites list                     Watched sites and their latest scores
  x-find run [url]                      Check all watched sites (or one) now and store the result
  x-find week [url]                     What to do this week, and what was done (from the stored checks)

Google Search Console (rankings, countries, indexing)
  x-find gsc connect --key <file.json>  Use a service-account key (setup steps: Connections in the dashboard)
  x-find gsc status                     Connection and last sync per site
  x-find gsc sync [url]                 Pull Search Console data now (also runs after every check)
  x-find gsc property <url> <property>  Choose the property by hand, e.g. sc-domain:example.com

Check options
  --site <url>             Public URL of the site (folder mode; or set "site" in the config)
  --config <file>          Config file (default: x-find.config.{mjs,js,json} in this folder)
  --staging                Preview build that is noindex on purpose: don't fail for that
  --json <file>            Write the full report as JSON
  --md <file>              Write a Markdown report (PR comments, issues)
  --html <file>            Write a self-contained HTML report
  --baseline <file>        Compare with an earlier --json report: new / fixed / still open
  --fail-on <level>        Exit 1 on findings at or above: error (default), warning, notice, never
  --fail-on-regression     With --baseline: also exit 1 if any score dropped or new errors appeared
  --min-score <n>          Exit 1 if any category scores below n
  --only <ids>             Run only these checks (comma-separated)
  --max-pages <n>          Live mode: page limit (default 500)
  --concurrency <n>        Live mode: parallel requests (default 4)
  --no-crawler-test        Live mode: skip requests with each crawler's user agent
  --verbose                Show every notice
  --quiet                  Print only the summary line
  --no-color               Plain output

Exit codes: 0 ok · 1 findings or thresholds failed · 2 usage, config or network error
Docs: https://github.com/Xbot-me/x-find`;

const RANK: Record<Severity, number> = { notice: 1, warning: 2, error: 3 };

function fail(message: string): never {
  process.stderr.write(`x-find: ${message}\n`);
  process.exit(2);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      site: { type: 'string' },
      config: { type: 'string' },
      staging: { type: 'boolean' },
      json: { type: 'string' },
      md: { type: 'string' },
      html: { type: 'string' },
      baseline: { type: 'string' },
      'fail-on': { type: 'string', default: 'error' },
      'fail-on-regression': { type: 'boolean' },
      'min-score': { type: 'string' },
      only: { type: 'string' },
      'max-pages': { type: 'string' },
      concurrency: { type: 'string' },
      'no-crawler-test': { type: 'boolean' },
      verbose: { type: 'boolean' },
      quiet: { type: 'boolean' },
      'no-color': { type: 'boolean' },
      preset: { type: 'string', default: 'ci' },
      name: { type: 'string' },
      hour: { type: 'string' },
      port: { type: 'string', default: '4747' },
      host: { type: 'string', default: '127.0.0.1' },
      'no-schedule': { type: 'boolean' },
      key: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const [command, target] = positionals;
  if (values.help || !command) {
    process.stdout.write(`${HELP}\n`);
    return command || values.help ? 0 : 2;
  }

  if (command === 'init') {
    const preset = values.preset as keyof typeof CONFIG_TEMPLATES;
    if (!(preset in CONFIG_TEMPLATES)) fail(`unknown preset "${preset}" (use ci or full)`);
    const file = path.resolve('x-find.config.mjs');
    if (existsSync(file)) fail('x-find.config.mjs already exists');
    await writeFile(file, CONFIG_TEMPLATES[preset]);
    process.stdout.write(`Wrote ${file}. Set "site" to your public URL.\n`);
    return 0;
  }

  if (command === 'checks') {
    for (const c of builtInChecks) {
      process.stdout.write(
        `${c.id.padEnd(30)} ${c.category.toUpperCase()}  ${c.severity.padEnd(8)}${c.live ? ' live' : '     '}  ${(c.basis ?? '') + (c.confidence === 'likely' ? ', estimate' : '')}\n${' '.repeat(31)}${c.title}\n${' '.repeat(31)}${c.sources[0]}\n`,
      );
    }
    return 0;
  }

  if (command === 'sites') {
    const { sitesCommand } = await import('../server/commands.js');
    try {
      return sitesCommand({
        action: target,
        url: positionals[2],
        name: values.name,
        hour: values.hour === undefined ? undefined : Number(values.hour),
      });
    } catch (e) {
      fail((e as Error).message);
    }
  }

  if (command === 'password') {
    const { passwordCommand } = await import('../server/commands.js');
    try {
      return await passwordCommand(target);
    } catch (e) {
      fail((e as Error).message);
    }
  }

  if (command === 'gsc') {
    const { gscCommand } = await import('../server/commands.js');
    try {
      return await gscCommand(target, { key: values.key, url: positionals[2], property: positionals[3] });
    } catch (e) {
      fail((e as Error).message);
    }
  }

  if (command === 'week') {
    const { weekCommand } = await import('../server/commands.js');
    try {
      return weekCommand(target);
    } catch (e) {
      fail((e as Error).message);
    }
  }

  if (command === 'service') {
    const { homeDir } = await import('../server/commands.js');
    const { defaultServiceEnv, serviceCommand } = await import('../server/service.js');
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port must be a port number');
    const spec = {
      node: process.execPath,
      cli: fileURLToPath(import.meta.url),
      home: homeDir(),
      port,
      xfindHome: process.env['X_FIND_HOME'] || undefined,
    };
    try {
      return await serviceCommand(
        target,
        defaultServiceEnv(spec, (l) => process.stdout.write(`${l}\n`)),
      );
    } catch (e) {
      fail((e as Error).message);
    }
  }

  if (command === 'run') {
    const { runCommand } = await import('../server/commands.js');
    try {
      return await runCommand(target);
    } catch (e) {
      fail((e as Error).message);
    }
  }

  if (command === 'serve') {
    const { serveCommand, homeDir, readPassword } = await import('../server/commands.js');
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail('--port must be a port number');
    const host = values.host;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host))
      process.stderr.write(`x-find: listening on ${host}: anyone on that network can open the dashboard.\n`);
    const password = readPassword();
    const { url, close } = await serveCommand({ port, host, schedule: !values['no-schedule'], password }).catch(
      (e: Error) => fail(e.message),
    );
    process.stdout.write(
      password
        ? 'Remote access (tunnel, proxy, network): password required.\n'
        : 'Remote access (tunnel, proxy, network): refused. Run x-find password new to allow it with a password.\n',
    );
    process.stdout.write(
      `x-find dashboard: ${url}\nData: ${homeDir()}\n${values['no-schedule'] ? 'Daily checks are off (--no-schedule).' : 'Daily checks are on while this runs.'} Stop with Ctrl+C.\n`,
    );
    await new Promise<void>((resolve) => {
      const stop = () => void close().then(resolve);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return 0;
  }

  if (command !== 'check') fail(`unknown command "${command}". Run x-find --help.`);
  if (!target) fail('missing <folder|url>. Example: x-find check ./dist --site https://example.com');

  const failOn = values['fail-on'];
  if (!['error', 'warning', 'notice', 'never'].includes(failOn))
    fail('--fail-on must be error, warning, notice or never');
  const num = (v: string | undefined, name: string) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) fail(`${name} must be a number`);
    return n;
  };
  const minScore = num(values['min-score'], '--min-score');
  const color = !values['no-color'] && process.stdout.isTTY && !process.env['NO_COLOR'];

  const { value: rawConfig } = await loadConfigFile(process.cwd(), values.config);
  const isUrl = /^https?:\/\//i.test(target);
  const config = resolveConfig(rawConfig, {
    ...(values.site ? { site: values.site } : isUrl ? { site: new URL(target).origin } : {}),
    ...(values.staging ? { staging: true } : {}),
  });

  let baseline: Report | undefined;
  if (values.baseline) {
    try {
      baseline = JSON.parse(await readFile(values.baseline, 'utf8')) as Report;
      if (baseline.schemaVersion !== 1) fail(`${values.baseline} is not an x-find report (schemaVersion 1)`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') baseline = undefined;
      else fail(`could not read baseline: ${(e as Error).message}`);
    }
  }

  let site;
  if (isUrl) {
    const progress = process.stderr.isTTY && !values.quiet;
    site = await crawlLive(target, {
      trailingSlash: config.trailingSlash,
      ...(values['max-pages'] ? { maxPages: num(values['max-pages'], '--max-pages')! } : {}),
      ...(values.concurrency ? { concurrency: Math.max(1, num(values.concurrency, '--concurrency')!) } : {}),
      skipCrawlerAccess: !!values['no-crawler-test'],
      ...(progress
        ? {
            onProgress: (done: number, queued: number) =>
              process.stderr.write(`\rCrawling… ${done} fetched, ${queued} queued   `),
          }
        : {}),
    });
    if (progress) process.stderr.write('\r\x1b[K');
  } else {
    if (!config.site)
      fail('folder mode needs the public URL: pass --site https://example.com or set "site" in x-find.config.mjs');
    site = await loadFolder(target, {
      site: config.site,
      trailingSlash: config.trailingSlash,
      cleanUrls: config.cleanUrls,
    });
    if (!site.pages.length) fail(`no .html files found in ${target}. Point x-find at your build output (e.g. ./dist).`);
  }

  const report = runChecks(site, config, values.only ? { only: values.only.split(',').map((s) => s.trim()) } : {});
  const diff = baseline ? diffReports(baseline, report) : undefined;

  if (values.json) await writeFile(values.json, JSON.stringify(report, null, 2));
  if (values.md) await writeFile(values.md, formatMarkdown(report, diff ? { diff } : {}));
  if (values.html) await writeFile(values.html, formatHtml(report, diff ? { diff } : {}));

  if (values.quiet) {
    const counts = { error: 0, warning: 0, notice: 0 };
    for (const f of report.findings) counts[f.severity]++;
    process.stdout.write(
      `${report.scores.map((s) => `${s.category.toUpperCase()} ${s.score ?? '–'}`).join(' · ')} · ${counts.error} errors, ${counts.warning} warnings, ${counts.notice} notices\n`,
    );
  } else {
    process.stdout.write(formatText(report, { color, verbose: !!values.verbose, ...(diff ? { diff } : {}) }) + '\n');
  }
  for (const e of report.checkErrors) process.stderr.write(`x-find: check "${e.checkId}" crashed: ${e.message}\n`);

  // GitHub Actions: job summary and annotations for errors.
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) await appendFile(summary, formatMarkdown(report, diff ? { diff } : {}) + '\n');
    for (const f of report.findings.filter((x) => x.severity === 'error').slice(0, 10)) {
      const msg = `${f.url ?? report.site}: ${f.message}`.replace(/\r?\n/g, ' ');
      process.stdout.write(`::error title=x-find ${f.checkId}::${msg}\n`);
    }
  }

  let code = 0;
  if (failOn !== 'never' && report.findings.some((f) => RANK[f.severity] >= RANK[failOn as Severity])) code = 1;
  if (minScore !== undefined && report.scores.some((s) => s.score !== null && s.score < minScore)) code = 1;
  if (values['fail-on-regression'] && diff) {
    const dropped = Object.values(diff.scoreDelta).some((d) => d !== null && d < 0);
    const newErrors = diff.added.some((f) => f.severity === 'error');
    if (dropped || newErrors) code = 1;
  }
  return code;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof ConfigError) fail(e.message);
    fail((e as Error).stack ?? String(e));
  },
);
