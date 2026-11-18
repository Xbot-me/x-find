import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandPattern } from '../src/core/checks/geo.js';
import { ConfigError, globToRegExp, resolveConfig } from '../src/core/config.js';
import { diffReports } from '../src/core/diff.js';
import { imageSize } from '../src/core/imagesize.js';
import type { CheckSummary, Finding } from '../src/core/types.js';
import { VERSION } from '../src/core/version.js';
import { urlPathsFor } from '../src/node/folder.js';

describe('brandPattern', () => {
  const find = (name: string, text: string) => [...text.matchAll(brandPattern(name))].map((m) => m[0]);
  it('finds case, spacing, hyphen and plural variants', () => {
    expect(
      find('BrightLeaf Studio', 'BrightLeaf Studio, Brightleaf Studios, Bright Leaf studio and Bright-Leaf Studio.'),
    ).toEqual(['BrightLeaf Studio', 'Brightleaf Studios', 'Bright Leaf studio', 'Bright-Leaf Studio']);
  });
  it('does not match inside other words', () => {
    expect(find('Acme', 'Acmeology and NotAcme, but Acme.')).toEqual(['Acme']);
  });
});

describe('imageSize', () => {
  it('reads PNG, GIF and SVG sizes', () => {
    const png = new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures/good/logo.png')));
    expect(imageSize(png)).toEqual({ width: 200, height: 200, type: 'png' });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0x64, 0x00]);
    expect(imageSize(gif)).toEqual({ width: 300, height: 100, type: 'gif' });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256"></svg>');
    expect(imageSize(svg)).toEqual({ width: 512, height: 256, type: 'svg' });
  });
  it('reads a JPEG frame header', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x96, 0x01, 0x2c, 0x03,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 300, height: 150, type: 'jpeg' });
  });
  it('returns null for unknown data', () => {
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('config', () => {
  it('applies defaults and normalises the site URL', () => {
    const c = resolveConfig({ site: 'https://example.com/' });
    expect(c.site).toBe('https://example.com');
    expect(c.thresholds.titleMaxChars).toBe(60);
    expect(c.trailingSlash).toBe('ignore');
  });
  it('rejects unknown keys and bad values with a readable message', () => {
    expect(() => resolveConfig({ sitee: 'x' })).toThrow(ConfigError);
    expect(() => resolveConfig({ checks: { 'title-length': 'loud' } })).toThrow(/checks\.title-length/);
  });
  it('matches ignore globs', () => {
    expect(globToRegExp('/admin/**').test('/admin/a/b')).toBe(true);
    expect(globToRegExp('/blog/*').test('/blog/a/b')).toBe(false);
  });
});

describe('urlPathsFor', () => {
  it('maps build files to the URLs static hosts serve', () => {
    expect(urlPathsFor('index.html', { trailingSlash: 'ignore' })[0]).toBe('/');
    expect(urlPathsFor('about/index.html', { trailingSlash: 'always' })[0]).toBe('/about/');
    expect(urlPathsFor('about/index.html', { trailingSlash: 'never' })[0]).toBe('/about');
    expect(urlPathsFor('about.html', { trailingSlash: 'ignore' })[0]).toBe('/about');
    expect(urlPathsFor('about.html', { trailingSlash: 'ignore', cleanUrls: false })[0]).toBe('/about.html');
  });
});

describe('diffReports', () => {
  const f = (fp: string, checkId = 'a'): Finding => ({
    checkId,
    title: '',
    category: 'seo',
    severity: 'error',
    message: '',
    fix: '',
    sources: [],
    fingerprint: fp,
  });
  const sum = (id: string, status: CheckSummary['status']): CheckSummary => ({
    id,
    title: '',
    category: 'seo',
    severity: 'error',
    status,
    subjects: 1,
    failed: 0,
    sources: [],
  });
  it('splits new, fixed and open, and never calls an unmeasured check fixed', () => {
    const base = {
      findings: [f('1'), f('2'), f('3', 'live')],
      scores: [{ category: 'seo' as const, score: 80, uncapped: 80, cap: null, topLosses: [] }],
    };
    const cur = {
      findings: [f('2'), f('4')],
      checks: [sum('a', 'failed'), sum('live', 'not-measured')],
      scores: [{ category: 'seo' as const, score: 90, uncapped: 90, cap: null, topLosses: [] }],
    };
    const d = diffReports(base, cur);
    expect(d.added.map((x) => x.fingerprint)).toEqual(['4']);
    expect(d.fixed.map((x) => x.fingerprint)).toEqual(['1']);
    expect(d.open.map((x) => x.fingerprint)).toEqual(['2']);
    expect(d.scoreDelta['seo']).toBe(10);
  });
});

describe('package', () => {
  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it('src/core uses no Node APIs, so it runs in Workers and browsers', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(path.join(import.meta.dirname, '../src/core'));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/from ['"](node:|fs|path|url|zlib|os|child_process)['"/]/);
      expect(src, file).not.toMatch(/\bprocess\.|\bBuffer\b|__dirname|require\(/);
    }
  });
});

describe('docs', () => {
  it('docs/checks.md lists exactly the built-in checks', async () => {
    const { builtInChecks } = await import('../src/core/checks/index.js');
    const doc = readFileSync(path.join(import.meta.dirname, '../../../docs/checks.md'), 'utf8');
    const documented = new Set([...doc.matchAll(/^\| `([a-z0-9-]+)`/gm)].map((m) => m[1]));
    const built = new Set(builtInChecks.map((c) => c.id));
    expect(
      [...built].filter((id) => !documented.has(id)),
      'built but not documented',
    ).toEqual([]);
    expect(
      [...documented].filter((id) => !built.has(id!)),
      'documented but not built',
    ).toEqual([]);
  });
});
