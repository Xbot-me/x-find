import { BASIS_TEXT } from '../checks/labels.js';
import { findingLabel } from '../run.js';
import type { Basis, Confidence, Finding, Report, Severity } from '../types.js';

export interface FindingGroup {
  checkId: string;
  title: string;
  severity: Severity;
  category: string;
  fix: string;
  sources: string[];
  basis: Basis;
  confidence: Confidence;
  findings: Finding[];
}

/** Findings grouped by check and severity, worst first, keeping the report's order inside each group. */
export function groupFindings(report: Pick<Report, 'findings'>): FindingGroup[] {
  const map = new Map<string, FindingGroup>();
  for (const f of report.findings) {
    const key = `${f.severity}|${f.checkId}`;
    let g = map.get(key);
    if (!g) {
      g = {
        checkId: f.checkId,
        title: f.title,
        severity: f.severity,
        category: f.category,
        fix: f.fix,
        sources: f.sources,
        ...findingLabel(f),
        findings: [],
      };
      map.set(key, g);
    }
    g.findings.push(f);
  }
  const rank = { error: 0, warning: 1, notice: 2 } as const;
  return [...map.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || b.findings.length - a.findings.length);
}

export function displayPath(url: string | undefined, site: string): string {
  if (!url) return '(site)';
  return url.startsWith(site) ? url.slice(site.length) || '/' : url;
}

export const CATEGORY_LABEL: Record<string, string> = { seo: 'SEO', aeo: 'AEO', geo: 'GEO' };

/** "Required", "Recommended" or "For your information", plus "estimate" when the check can be wrong. */
export function labelText(g: Pick<FindingGroup, 'basis' | 'confidence'>): string {
  return BASIS_TEXT[g.basis] + (g.confidence === 'likely' ? ' · estimate' : '');
}

/** " · rules abc123" for report headers, so two reports scored by different rules can be told apart. */
export function rulesText(report: Pick<Report, 'rulesId'>): string {
  return report.rulesId ? ` · rules ${report.rulesId}` : '';
}
