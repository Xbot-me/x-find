import type { ReportDiff } from '../diff.js';
import type { Report } from '../types.js';
import { CATEGORY_LABEL, displayPath, groupFindings, labelText, rulesText } from './group.js';

export interface TextOptions {
  color?: boolean;
  /** URLs shown per check before "+ N more". */
  maxUrls?: number;
  /** Show notices in full (otherwise one line per check). */
  verbose?: boolean;
  diff?: ReportDiff;
}

export function formatText(report: Report, opts: TextOptions = {}): string {
  const c = opts.color
    ? {
        red: (s: string) => `\x1b[31m${s}\x1b[39m`,
        yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
        blue: (s: string) => `\x1b[34m${s}\x1b[39m`,
        green: (s: string) => `\x1b[32m${s}\x1b[39m`,
        dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
        bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
      }
    : { red: String, yellow: String, blue: String, green: String, dim: String, bold: String };
  const max = opts.maxUrls ?? 5;
  const out: string[] = [];

  out.push(
    c.bold(`x-find ${report.tool.version}`) +
      c.dim(
        ` · ${report.mode} · ${report.site} · ${report.pagesChecked} pages${report.staging ? ' · staging' : ''}${rulesText(report)}`,
      ),
  );
  out.push('');
  const scoreText = report.scores
    .map((s) => {
      const label = CATEGORY_LABEL[s.category]!;
      if (s.score === null) return `${label} –`;
      const colour = s.score >= 90 ? c.green : s.score >= 60 ? c.yellow : c.red;
      return `${label} ${colour(c.bold(String(s.score)))}`;
    })
    .join('   ');
  out.push(`Readiness  ${scoreText}`);
  for (const s of report.scores) {
    if (s.cap)
      out.push(
        c.red(
          `           ${CATEGORY_LABEL[s.category]} capped at ${s.cap.value}: ${s.cap.reason} (uncapped ${s.uncapped})`,
        ),
      );
  }
  if (opts.diff) {
    const d = opts.diff;
    const delta = Object.entries(d.scoreDelta)
      .filter(([, v]) => v !== null && v !== 0)
      .map(([k, v]) => `${CATEGORY_LABEL[k]} ${v! > 0 ? '+' : ''}${v}`)
      .join(', ');
    out.push(
      `Since baseline  ${c.red(`${d.added.length} new`)} · ${c.green(`${d.fixed.length} fixed`)} · ${d.open.length} still open${delta ? ` · ${delta}` : ''}`,
    );
  }
  out.push('');

  const groups = groupFindings(report);
  const counts = { error: 0, warning: 0, notice: 0 };
  for (const f of report.findings) counts[f.severity]++;
  const newSet = new Set(opts.diff?.added.map((f) => f.fingerprint));

  for (const sev of ['error', 'warning', 'notice'] as const) {
    const gs = groups.filter((g) => g.severity === sev);
    if (!gs.length) continue;
    const colour = sev === 'error' ? c.red : sev === 'warning' ? c.yellow : c.blue;
    const icon = sev === 'error' ? '✖' : sev === 'warning' ? '▲' : '●';
    out.push(
      colour(c.bold(`${sev === 'error' ? 'ERRORS' : sev === 'warning' ? 'WARNINGS' : 'NOTICES'} (${counts[sev]})`)),
    );
    for (const g of gs) {
      const compact = sev === 'notice' && !opts.verbose;
      out.push(
        `  ${colour(icon)} ${c.bold(g.title)} ${c.dim(`${g.checkId} · ${CATEGORY_LABEL[g.category]} · ${g.findings.length} · ${labelText(g)}`)}`,
      );
      if (compact) continue;
      for (const f of g.findings.slice(0, max)) {
        const mark = newSet.has(f.fingerprint) ? c.red('NEW ') : '';
        out.push(`      ${mark}${displayPath(f.url, report.site)}  ${f.message}`);
        if (f.evidence) out.push(c.dim(`        ${f.evidence}`));
      }
      if (g.findings.length > max) out.push(c.dim(`      + ${g.findings.length - max} more`));
      out.push(c.dim(`      Fix: ${g.fix}`));
      out.push(c.dim(`      Source: ${g.sources[0]}`));
    }
    out.push('');
  }
  if (!report.findings.length) out.push(c.green('No findings.'), '');

  const notMeasured = report.checks.filter((s) => s.status === 'not-measured').map((s) => s.id);
  if (notMeasured.length) {
    out.push(
      c.dim(
        `Not measured (${report.mode === 'folder' ? 'need the live site: run x-find against the URL' : 'see errors'}): ${notMeasured.join(', ')}`,
      ),
    );
  }
  if (report.overrides.length)
    out.push(
      c.dim(`Severity overrides from config: ${report.overrides.map((o) => `${o.id}=${o.severity}`).join(', ')}`),
    );
  out.push(c.dim(`Scores measure readiness from these checks, not rankings or traffic. ${report.formula}`));
  return out.join('\n');
}
