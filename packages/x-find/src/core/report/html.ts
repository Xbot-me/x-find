import type { ReportDiff } from '../diff.js';
import type { Report } from '../types.js';
import { CATEGORY_LABEL, displayPath, groupFindings, labelText, rulesText } from './group.js';

const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A single self-contained HTML file (no scripts, no external requests) to share with people who don't use a terminal. */
export function formatHtml(report: Report, opts: { diff?: ReportDiff } = {}): string {
  const groups = groupFindings(report);
  const counts = { error: 0, warning: 0, notice: 0 };
  for (const f of report.findings) counts[f.severity]++;
  const newSet = new Set(opts.diff?.added.map((f) => f.fingerprint));
  const date = report.generatedAt.slice(0, 16).replace('T', ' ');

  const scoreCards = report.scores
    .map((s) => {
      const tone = s.score === null ? 'none' : s.score >= 90 ? 'good' : s.score >= 60 ? 'mid' : 'bad';
      const delta = opts.diff?.scoreDelta[s.category];
      const losses = s.topLosses.length
        ? `<ul class="losses">${s.topLosses.map((l) => `<li><code>${h(l.id)}</code> −${l.lost}</li>`).join('')}</ul>`
        : '';
      return `<div class="card score ${tone}"><div class="label">${CATEGORY_LABEL[s.category]}</div><div class="num">${s.score ?? '–'}</div>${
        delta ? `<div class="delta">${delta > 0 ? '+' : ''}${delta} since baseline</div>` : ''
      }${s.cap ? `<div class="cap">Capped at ${s.cap.value}: ${h(s.cap.reason)} (uncapped ${s.uncapped})</div>` : ''}${losses}</div>`;
    })
    .join('');

  const sections = (['error', 'warning', 'notice'] as const)
    .map((sev) => {
      const gs = groups.filter((g) => g.severity === sev);
      if (!gs.length) return '';
      const label = sev === 'error' ? 'Errors' : sev === 'warning' ? 'Warnings' : 'Notices';
      return `<h2>${label} <span class="count">${counts[sev]}</span></h2>${gs
        .map(
          (
            g,
          ) => `<details class="group ${sev}"${sev === 'error' ? ' open' : ''}><summary><span class="dot"></span><b>${h(g.title)}</b><span class="meta"><code>${h(g.checkId)}</code> · ${CATEGORY_LABEL[g.category]} · ${g.findings.length} · ${h(labelText(g))}</span></summary>
<p class="fix"><b>Fix:</b> ${h(g.fix)}</p>
<p class="src">Source: ${g.sources.map((s) => `<a href="${h(s)}">${h(s.replace(/^https?:\/\//, ''))}</a>`).join(' · ')}</p>
<table><tbody>${g.findings
            .map(
              (f) =>
                `<tr><td class="url">${newSet.has(f.fingerprint) ? '<span class="new">new</span> ' : ''}<code>${h(displayPath(f.url, report.site))}</code></td><td>${h(f.message)}${
                  f.evidence ? `<div class="ev">${h(f.evidence)}</div>` : ''
                }</td></tr>`,
            )
            .join('')}</tbody></table></details>`,
        )
        .join('')}`;
    })
    .join('');

  const notMeasured = report.checks.filter((s) => s.status === 'not-measured').map((s) => s.id);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>x-find report · ${h(report.site.replace(/^https?:\/\//, ''))}</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--line:#e7e5e4;--card:#fff;--err:#b91c1c;--warn:#b45309;--note:#1d4ed8;--good:#15803d;--code:#f5f5f4}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--card:#1c1917;--err:#f87171;--warn:#fbbf24;--note:#93c5fd;--good:#4ade80;--code:#292524}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 12px}
.sub{color:var(--muted);margin:0 0 24px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}.score .label{color:var(--muted);font-size:13px}
.score .num{font-size:36px;font-weight:700}.good .num{color:var(--good)}.mid .num{color:var(--warn)}.bad .num{color:var(--err)}
.cap{color:var(--err);font-size:13px}.delta{font-size:13px;color:var(--muted)}.losses{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}
.count{color:var(--muted);font-weight:400}.group{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:8px 0;padding:0 16px}
summary{cursor:pointer;padding:12px 0;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.meta{color:var(--muted);font-size:13px}
.dot{width:9px;height:9px;border-radius:50%;flex:none;align-self:center}.error .dot{background:var(--err)}.warning .dot{background:var(--warn)}.notice .dot{background:var(--note)}
.fix,.src{margin:0 0 8px;font-size:14px}.src{color:var(--muted);overflow-wrap:anywhere}a{color:var(--note)}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:14px;table-layout:fixed}td{border-top:1px solid var(--line);padding:8px 8px 8px 0;vertical-align:top;overflow-wrap:anywhere}
td.url{width:34%}code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:13px}.ev{color:var(--muted);font-size:13px}
.new{color:#fff;background:var(--err);border-radius:4px;padding:0 5px;font-size:12px}footer{color:var(--muted);font-size:13px;margin-top:40px}
@media (max-width:600px){td.url{width:45%}}
</style>
</head>
<body><main>
<h1>${h(report.site)}</h1>
<p class="sub">${report.pagesChecked} pages · ${report.mode} mode${report.staging ? ' · staging' : ''} · ${h(date)} UTC · x-find ${h(report.tool.version)}${h(rulesText(report))}</p>
<div class="cards">${scoreCards}<div class="card"><div class="label" style="color:var(--muted);font-size:13px">Findings</div><div style="font-size:15px;margin-top:6px"><b style="color:var(--err)">${counts.error}</b> errors<br><b style="color:var(--warn)">${counts.warning}</b> warnings<br><b style="color:var(--note)">${counts.notice}</b> notices${
    opts.diff ? `<br><br>${opts.diff.added.length} new · ${opts.diff.fixed.length} fixed` : ''
  }</div></div></div>
${sections || '<p>No findings.</p>'}
<footer>${notMeasured.length ? `<p>Not measured in this mode: ${notMeasured.map((id) => `<code>${h(id)}</code>`).join(' ')}</p>` : ''}
<p>Readiness scores come from these checks, not from rankings or traffic. ${h(report.formula)}</p></footer>
</main></body></html>
`;
}
