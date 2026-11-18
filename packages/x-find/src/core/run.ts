import { buildIndex } from './analyze.js';
import { builtInChecks } from './checks/index.js';
import { CHECK_LABELS, DEFAULT_LABEL } from './checks/labels.js';
import { hash, pathOf } from './checks/util.js';
import { globToRegExp } from './config.js';
import { isAllowed } from './robots/parse.js';
import type {
  Category,
  CategoryScore,
  Check,
  CheckContext,
  CheckSummary,
  Finding,
  Issue,
  Report,
  ResolvedConfig,
  Severity,
  SiteModel,
} from './types.js';
import { VERSION } from './version.js';

const RANK: Record<Severity, number> = { notice: 1, warning: 2, error: 3 };
export const WEIGHT: Record<Severity, number> = { error: 10, warning: 3, notice: 0 };
export const SCORE_FORMULA =
  'score = ⌊100 × Σ weight × credit ÷ Σ weight⌋ over the checks that ran in each category; weights: error 10, warning 3, notice 0 (not scored). ' +
  'credit = 1 when a check passes; when it fails, 0.5 × (1 − failed ÷ checked), so any failure costs at least half the weight and the rest scales with how much of the site fails. ' +
  'SEO is capped at 20 when the home page is noindex or blocked for Googlebot.';

function softer(a: Severity, b: Severity | undefined): Severity {
  if (!b) return a;
  return RANK[b] < RANK[a] ? b : a;
}

export function fingerprint(checkId: string, url: string | undefined, key: string | undefined): string {
  return hash(`${checkId}|${url ? pathOf(url) : ''}|${key ?? ''}`);
}

/** The basis and confidence of a finding, also for reports saved before findings carried them. */
export function findingLabel(f: Pick<Finding, 'checkId' | 'basis' | 'confidence'>): {
  basis: NonNullable<Finding['basis']>;
  confidence: NonNullable<Finding['confidence']>;
} {
  const l = CHECK_LABELS[f.checkId] ?? DEFAULT_LABEL;
  return { basis: f.basis ?? l.basis, confidence: f.confidence ?? l.confidence };
}

/** Short hash of the check ids and versions that ran: equal ids mean the same rules scored both reports. */
export function rulesId(checks: Pick<CheckSummary, 'id' | 'version' | 'status'>[]): string {
  const ran = checks.filter((c) => c.status !== 'off').map((c) => `${c.id}@${c.version ?? DEFAULT_LABEL.version}`);
  return hash(ran.sort().join(','));
}

export interface RunOptions {
  /** Restrict to these check ids (after severity overrides). */
  only?: string[];
}

export interface RunResult extends Report {
  checkErrors: { checkId: string; message: string }[];
}

export function runChecks(input: SiteModel, config: ResolvedConfig, options: RunOptions = {}): RunResult {
  const ignore = config.ignore.map(globToRegExp);
  const ignored = (url: string) => ignore.some((re) => re.test(pathOf(url).split('?')[0]!));
  const site: SiteModel = { ...input, pages: input.pages.filter((p) => !ignored(p.url)) };
  const index = buildIndex(site, config);
  const ctx: CheckContext = { site, config, index };

  const checks: Check[] = [...builtInChecks, ...config.rules];
  const ids = new Set<string>();
  for (const c of checks) {
    if (ids.has(c.id)) throw new Error(`Duplicate check id "${c.id}"`);
    ids.add(c.id);
  }

  const findings: Finding[] = [];
  const summaries: CheckSummary[] = [];
  const checkErrors: RunResult['checkErrors'] = [];

  for (const check of checks) {
    const override = config.severity[check.id];
    const severity = override ?? check.severity;
    const label = {
      basis: check.basis ?? DEFAULT_LABEL.basis,
      confidence: check.confidence ?? DEFAULT_LABEL.confidence,
      version: check.version ?? DEFAULT_LABEL.version,
    };
    const base = {
      id: check.id,
      title: check.title,
      category: check.category,
      severity,
      sources: check.sources,
      ...label,
    };
    if (severity === 'off' || (options.only && !options.only.includes(check.id))) {
      summaries.push({ ...base, status: 'off', subjects: 0, failed: 0 });
      continue;
    }
    if (check.live && site.mode !== 'live') {
      summaries.push({ ...base, status: 'not-measured', subjects: 0, failed: 0 });
      continue;
    }

    let subjects: number;
    let issues: (Issue & { url?: string })[] = [];
    try {
      if (check.scope === 'page') {
        const pages = check.indexableOnly ? index.indexable : site.pages;
        subjects = pages.length;
        for (const page of pages) {
          for (const issue of check.run(page, ctx)) issues.push({ ...issue, url: issue.url ?? page.url });
        }
      } else {
        const r = check.run(ctx);
        subjects = r.subjects;
        issues = r.issues;
      }
    } catch (e) {
      checkErrors.push({ checkId: check.id, message: (e as Error).message });
      summaries.push({ ...base, status: 'not-measured', subjects: 0, failed: 0 });
      continue;
    }

    const failing = new Set<string>();
    for (const issue of issues) {
      const sev = softer(severity, issue.severity);
      if (sev !== 'notice') failing.add(issue.url ? pathOf(issue.url) : `#${issue.key ?? ''}`);
      findings.push({
        checkId: check.id,
        title: check.title,
        category: check.category,
        severity: sev,
        ...(issue.url ? { url: issue.url } : {}),
        message: issue.message,
        ...(issue.evidence ? { evidence: issue.evidence } : {}),
        fix: check.fix,
        sources: check.sources,
        fingerprint: fingerprint(check.id, issue.url, issue.key),
        basis: issue.basis ?? label.basis,
        confidence: label.confidence,
      });
    }
    const failed = Math.min(subjects || failing.size, failing.size);
    summaries.push({
      ...base,
      subjects: Math.max(subjects, failed),
      failed,
      status: subjects === 0 && issues.length === 0 ? 'not-applicable' : issues.length ? 'failed' : 'passed',
    });
  }

  // Fingerprints must be unique for baseline diffs; the same issue twice on one page (e.g. two <img> without src)
  // gets an occurrence suffix, stable as long as the page keeps the same order.
  const seenFp = new Map<string, number>();
  for (const f of findings) {
    const n = seenFp.get(f.fingerprint) ?? 0;
    seenFp.set(f.fingerprint, n + 1);
    if (n > 0) f.fingerprint = `${f.fingerprint}~${n}`;
  }

  findings.sort(
    (a, b) =>
      RANK[b.severity] - RANK[a.severity] ||
      a.checkId.localeCompare(b.checkId) ||
      (a.url ?? '').localeCompare(b.url ?? '') ||
      a.message.localeCompare(b.message),
  );

  return {
    schemaVersion: 1,
    tool: { name: 'x-find', version: VERSION },
    rulesId: rulesId(summaries),
    generatedAt: new Date().toISOString(),
    mode: site.mode,
    site: site.origin,
    pagesChecked: site.pages.length,
    staging: config.staging,
    findings,
    checks: summaries,
    scores: score(summaries, ctx),
    overrides: Object.entries(config.severity).map(([id, s]) => ({ id, severity: s })),
    formula: SCORE_FORMULA,
    checkErrors,
  };
}

export function score(summaries: CheckSummary[], ctx: CheckContext): CategoryScore[] {
  const categories: Category[] = ['seo', 'aeo', 'geo'];
  const home = ctx.index.pageByUrl.get(ctx.index.norm(`${ctx.site.origin}/`));
  return categories.map((category) => {
    let total = 0;
    let lost = 0;
    const losses: { id: string; lost: number }[] = [];
    for (const s of summaries) {
      if (s.category !== category || s.severity === 'off' || s.severity === 'notice') continue;
      if (s.status !== 'passed' && s.status !== 'failed') continue;
      if (s.subjects === 0) continue;
      const w = WEIGHT[s.severity];
      total += w;
      if (s.failed > 0) {
        const l = w * (0.5 + 0.5 * Math.min(1, s.failed / s.subjects));
        lost += l;
        losses.push({ id: s.id, lost: l });
      }
    }
    // Floor, so 100 always means nothing failed.
    const uncapped = total ? Math.floor(100 * (1 - lost / total)) : null;
    let cap: CategoryScore['cap'] = null;
    if (category === 'seo' && !ctx.config.staging && home) {
      if (home.robots.noindex) cap = { value: 20, reason: 'The home page is noindex.' };
      else if (!isAllowed(ctx.index.robots, 'Googlebot', home.url))
        cap = { value: 20, reason: 'robots.txt blocks Googlebot from the home page.' };
    }
    const value = uncapped === null ? null : cap ? Math.min(uncapped, cap.value) : uncapped;
    const pct = (n: number) => (total ? Math.round(((100 * n) / total) * 10) / 10 : 0);
    return {
      category,
      score: value,
      uncapped,
      cap,
      topLosses: losses
        .sort((a, b) => b.lost - a.lost)
        .slice(0, 5)
        .map((l) => ({ id: l.id, lost: pct(l.lost) })),
    };
  });
}
