import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('the package README (shown on npm) matches the repo README', () => {
  const file = path.join(import.meta.dirname, '../README.md');
  const before = readFileSync(file, 'utf8');
  execFileSync(process.execPath, [path.join(import.meta.dirname, '../scripts/sync-readme.mjs')]);
  expect(readFileSync(file, 'utf8'), 'run `pnpm readme` in packages/x-find').toBe(before);
});
