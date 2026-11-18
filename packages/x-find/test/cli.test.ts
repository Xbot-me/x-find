import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const pkg = path.join(import.meta.dirname, '..');
const cli = path.join(pkg, 'dist/node/cli.js');
const fixture = (n: string) => path.join(import.meta.dirname, 'fixtures', n);
const run = (args: string[], cwd = pkg) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', GITHUB_ACTIONS: '' },
  });

describe('cli', () => {
  beforeAll(() => {
    if (!existsSync(cli)) execFileSync('pnpm', ['build'], { cwd: pkg, stdio: 'ignore' });
  });

  it('exits 0 on a clean site and 1 when errors are found', () => {
    expect(run(['check', fixture('good'), '--site', 'https://example.com', '--quiet']).status).toBe(0);
    const bad = run(['check', fixture('bad'), '--site', 'https://example.com', '--quiet']);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/^SEO \d+ · AEO \d+ · GEO \d+ · \d+ errors/);
  });

  it('honours --fail-on and --min-score', () => {
    expect(
      run(['check', fixture('bad'), '--site', 'https://example.com', '--quiet', '--fail-on', 'never']).status,
    ).toBe(0);
    expect(
      run(['check', fixture('good'), '--site', 'https://example.com', '--quiet', '--fail-on', 'notice']).status,
    ).toBe(1);
    expect(
      run([
        'check',
        fixture('bad'),
        '--site',
        'https://example.com',
        '--quiet',
        '--fail-on',
        'never',
        '--min-score',
        '90',
      ]).status,
    ).toBe(1);
  });

  it('exits 2 with a helpful message on usage errors', () => {
    const r = run(['check', fixture('good')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--site/);
    expect(run(['nope']).status).toBe(2);
  });

  it('writes JSON, Markdown and HTML reports and diffs against a baseline', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'x-find-'));
    const json = path.join(out, 'r.json');
    run([
      'check',
      fixture('bad'),
      '--site',
      'https://example.com',
      '--json',
      json,
      '--md',
      path.join(out, 'r.md'),
      '--html',
      path.join(out, 'r.html'),
    ]);
    const report = JSON.parse(readFileSync(json, 'utf8'));
    expect(report.schemaVersion).toBe(1);
    expect(readFileSync(path.join(out, 'r.md'), 'utf8')).toMatch(/^## x-find: https:\/\/example.com/);
    expect(readFileSync(path.join(out, 'r.html'), 'utf8')).toMatch(/^<!doctype html>/);
    const again = run([
      'check',
      fixture('bad'),
      '--site',
      'https://example.com',
      '--baseline',
      json,
      '--fail-on',
      'never',
    ]);
    expect(again.stdout).toMatch(/Since baseline\s+0 new · 0 fixed/);
    const regress = run([
      'check',
      fixture('bad'),
      '--site',
      'https://example.com',
      '--baseline',
      json,
      '--fail-on',
      'never',
      '--fail-on-regression',
    ]);
    expect(regress.status).toBe(0);
  });

  it('init writes a config that the checker accepts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'x-find-init-'));
    expect(run(['init', '--preset', 'full'], dir).status).toBe(0);
    expect(run(['init'], dir).status).toBe(2); // refuses to overwrite
    const r = run(['check', fixture('good'), '--quiet'], dir);
    expect(r.status).toBe(0);
  });

  it('lists every check with a source', () => {
    const r = run(['checks']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/canonical-not-in-head/);
  });
});
