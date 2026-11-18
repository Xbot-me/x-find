import { describe, expect, it } from 'vitest';
import { builtInChecks, CHECK_LABELS, findingLabel, resolveConfig, rulesId, runChecks } from '../src/core/index.js';
import type { SiteModel } from '../src/core/types.js';

describe('check labels', () => {
  it('classifies every built-in check, and nothing else', () => {
    const ids = builtInChecks.map((c) => c.id).sort();
    expect(Object.keys(CHECK_LABELS).sort()).toEqual(ids);
    for (const c of builtInChecks) {
      expect(['required', 'recommended', 'info'], c.id).toContain(c.basis);
      expect(['certain', 'likely'], c.id).toContain(c.confidence);
      expect(Number.isInteger(c.version) && c.version! >= 1, c.id).toBe(true);
    }
  });

  it('never calls a notice required', () => {
    // A required finding that costs nothing would be a contradiction; soften the label or raise the severity.
    const bad = builtInChecks.filter((c) => c.severity === 'notice' && c.basis === 'required').map((c) => c.id);
    expect(bad).toEqual([]);
  });

  it('fills in labels for findings saved before they existed', () => {
    expect(findingLabel({ checkId: 'link-broken-internal' })).toEqual({ basis: 'required', confidence: 'certain' });
    expect(findingLabel({ checkId: 'content-thin' })).toEqual({ basis: 'recommended', confidence: 'likely' });
    expect(findingLabel({ checkId: 'snippet-restricted', basis: 'info' }).basis).toBe('info');
    expect(findingLabel({ checkId: 'my-own-rule' })).toEqual({ basis: 'recommended', confidence: 'certain' });
  });
});

describe('rules id', () => {
  const checks = [
    { id: 'a', version: 1, status: 'passed' as const },
    { id: 'b', version: 1, status: 'failed' as const },
  ];

  it('is stable and ignores order and switched-off checks', () => {
    expect(rulesId(checks)).toBe(rulesId([...checks].reverse()));
    expect(rulesId([...checks, { id: 'c', version: 1, status: 'off' as const }])).toBe(rulesId(checks));
  });

  it('changes when a check version changes', () => {
    expect(rulesId([checks[0]!, { ...checks[1]!, version: 2 }])).not.toBe(rulesId(checks));
  });

  it('is on every report, with labels on every finding', () => {
    const site: SiteModel = {
      mode: 'folder',
      origin: 'https://a.com',
      pages: [],
      robotsTxt: null,
      llmsTxt: null,
      sitemaps: [],
      resources: new Map(),
      failedPages: new Map(),
    };
    const report = runChecks(site, resolveConfig({ site: 'https://a.com' }));
    expect(report.rulesId).toMatch(/^[0-9a-z]+$/);
    for (const f of report.findings) expect(f.basis && f.confidence, f.checkId).toBeTruthy();
    for (const s of report.checks) expect(s.basis, s.id).toBeTruthy();
  });
});
