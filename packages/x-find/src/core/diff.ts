import type { Finding, Report } from './types.js';

export interface ReportDiff {
  added: Finding[];
  fixed: Finding[];
  open: Finding[];
  /** Score change per category (current − baseline), null when either side had no score. */
  scoreDelta: Record<string, number | null>;
}

/**
 * Compares two reports by finding fingerprint. A finding only counts as fixed when its check actually ran this time
 * (a live-only check in a folder run is "not measured", not fixed).
 */
export function diffReports(
  baseline: Pick<Report, 'findings' | 'scores'>,
  current: Pick<Report, 'findings' | 'checks' | 'scores'>,
): ReportDiff {
  const before = new Map(baseline.findings.map((f) => [f.fingerprint, f]));
  const now = new Map(current.findings.map((f) => [f.fingerprint, f]));
  const measured = new Set(
    current.checks.filter((c) => c.status === 'passed' || c.status === 'failed').map((c) => c.id),
  );
  const scoreDelta: Record<string, number | null> = {};
  for (const s of current.scores) {
    const b = baseline.scores.find((x) => x.category === s.category)?.score;
    scoreDelta[s.category] = s.score !== null && b !== null && b !== undefined ? s.score - b : null;
  }
  return {
    added: current.findings.filter((f) => !before.has(f.fingerprint)),
    fixed: baseline.findings.filter((f) => !now.has(f.fingerprint) && measured.has(f.checkId)),
    open: current.findings.filter((f) => before.has(f.fingerprint)),
    scoreDelta,
  };
}
