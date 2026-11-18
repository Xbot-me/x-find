// Copies the repo README into the package, so npm shows the same text. Relative links become GitHub links, since
// docs/ isn't part of the package.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '../../../README.md');
const out = path.join(import.meta.dirname, '../README.md');
const text = readFileSync(root, 'utf8').replace(
  /\]\((?!https?:|#)([^)]+)\)/g,
  (_, p) => `](https://github.com/Xbot-me/x-find/blob/main/${p})`,
);
writeFileSync(out, text);
