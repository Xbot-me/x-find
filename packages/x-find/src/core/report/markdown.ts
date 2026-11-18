import type { ReportDiff } from '../diff.js';
import type { Report } from '../types.js';
import { CATEGORY_LABEL, displayPath, groupFindings, labelText, rulesText } from './group.js';

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Markdown for PR comments, issues and GitHub job summaries. */
export function formatMarkdown(report: Report, opts: { maxUrls?: number; diff?: ReportDiff } = {}): string {
  const max = opts.maxUrls ?? 10;
  const out: string[] = [];
  out.push(`## x-find: ${report.site}`);
  out.push('');
  out.push(
    `${report.pagesChecked} pages · ${report.mode} mode${report.staging ? ' · staging' : ''} · x-find ${report.tool.version}${rulesText(report)}`,
  );
  out.push('');
  out.push('| | SEO | AEO | GEO |');
  out.push('|---|---|---|---|');
  out.push(`| Readiness | ${report.scores.map((s) => (s.score === null ? '–' : `**${s.score}**`)).join(' | ')} |`);
  if (opts.diff) {
    out.push(
      `| Change | ${report.scores
        .map((s) => {
          const d = opts.diff!.scoreDelta[s.category];
          return d === null || d === undefined ? '–' : d > 0 ? `+${d}` : String(d);
        })
        .join(' | ')} |`,
    );
  }
  for (const s of report.scores)
    if (s.cap)
      out.push(`\n> ${CATEGORY_LABEL[s.category]} capped at ${s.cap.value}: ${s.cap.reason} (uncapped ${s.uncapped})`);
  out.push('');
  const counts = { error: 0, warning: 0, notice: 0 };
  for (const f of report.findings) counts[f.severity]++;
  out.push(`**${counts.error} errors · ${counts.warning} warnings · ${counts.notice} notices**`);
  if (opts.diff)
    out.push(
      `\nSince baseline: ${opts.diff.added.length} new · ${opts.diff.fixed.length} fixed · ${opts.diff.open.length} still open`,
    );
  out.push('');

  const newSet = new Set(opts.diff?.added.map((f) => f.fingerprint));
  const groups = groupFindings(report);
  for (const sev of ['error', 'warning', 'notice'] as const) {
    const gs = groups.filter((g) => g.severity === sev);
    if (!gs.length) continue;
    out.push(`### ${sev === 'error' ? 'Errors' : sev === 'warning' ? 'Warnings' : 'Notices'}`);
    out.push('');
    for (const g of gs) {
      const open = sev === 'notice' ? '' : ' open';
      out.push(
        `<details${open}><summary><b>${esc(g.title)}</b> · <code>${g.checkId}</code> · ${CATEGORY_LABEL[g.category]} · ${g.findings.length} · ${labelText(g)}</summary>`,
      );
      out.push('');
      out.push('| URL | Finding |');
      out.push('|---|---|');
      for (const f of g.findings.slice(0, max)) {
        const flag = newSet.has(f.fingerprint) ? '🆕 ' : '';
        out.push(
          `| ${flag}\`${esc(displayPath(f.url, report.site))}\` | ${esc(f.message)}${f.evidence ? `<br><sub>${esc(f.evidence)}</sub>` : ''} |`,
        );
      }
      if (g.findings.length > max) out.push(`| … | ${g.findings.length - max} more |`);
      out.push('');
      out.push(`**Fix:** ${g.fix}  `);
      out.push(`**Source:** ${g.sources.map((s) => `<${s}>`).join(' · ')}`);
      out.push('');
      out.push('</details>');
      out.push('');
    }
  }
  if (opts.diff?.fixed.length) {
    out.push('### Fixed since baseline');
    out.push('');
    for (const f of opts.diff.fixed.slice(0, 20))
      out.push(`- ~~${esc(f.title)}~~ \`${esc(displayPath(f.url, report.site))}\``);
    out.push('');
  }
  const notMeasured = report.checks.filter((s) => s.status === 'not-measured').map((s) => `\`${s.id}\``);
  if (notMeasured.length) out.push(`<sub>Not measured in this mode: ${notMeasured.join(', ')}.</sub>\n`);
  out.push(`<sub>Readiness scores come from these checks, not from rankings or traffic. ${esc(report.formula)}</sub>`);
  return out.join('\n');
}
