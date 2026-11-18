import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError } from '../core/config.js';

export const CONFIG_NAMES = ['x-find.config.mjs', 'x-find.config.js', 'x-find.config.json'];

/** Loads the project config: an explicit path, or the first x-find.config.* found in `cwd`. */
export async function loadConfigFile(cwd: string, explicit?: string): Promise<{ path: string | null; value: unknown }> {
  const file = explicit
    ? path.resolve(cwd, explicit)
    : CONFIG_NAMES.map((n) => path.join(cwd, n)).find((p) => existsSync(p));
  if (!file) return { path: null, value: {} };
  if (!existsSync(file)) throw new ConfigError(`Config file not found: ${file}`);
  if (file.endsWith('.json')) {
    try {
      return { path: file, value: JSON.parse(await readFile(file, 'utf8')) };
    } catch (e) {
      throw new ConfigError(`Could not parse ${file}: ${(e as Error).message}`);
    }
  }
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  return { path: file, value: mod.default ?? {} };
}

export const CONFIG_TEMPLATES = {
  ci: `// x-find config (https://github.com/Xbot-me/x-find). Docs: every option is optional except \`site\`.
/** @type {import('x-find').UserConfig} */
export default {
  // The public URL of the site. Used to turn files in your build folder into URLs.
  site: 'https://example.com',
  // How your host serves folders: 'always' (/about/), 'never' (/about) or 'ignore'.
  trailingSlash: 'ignore',
  // Paths to leave out, e.g. admin or API routes.
  ignore: ['/admin/**', '/api/**'],
};
`,
  full: `// x-find config (https://github.com/Xbot-me/x-find).
/** @type {import('x-find').UserConfig} */
export default {
  site: 'https://example.com',
  trailingSlash: 'ignore',
  cleanUrls: true,
  // GEO: flags other spellings of the brand ("Example Studios", "example studio").
  brand: { name: 'Example Studio', allow: [] },
  ignore: ['/admin/**', '/api/**'],
  // Change a check's severity ('error' | 'warning' | 'notice' | 'off'). Overrides are listed in every report.
  checks: {
    // 'title-length': 'off',
    // 'jsonld-review-markup': 'error',
  },
  thresholds: {
    titleMaxChars: 60,
    descriptionMaxChars: 160,
    thinContentWords: 200,
    similarity: 0.9,
  },
  // Custom rules have the same shape as built-in checks. Example:
  rules: [
    // {
    //   id: 'no-lorem-ipsum',
    //   scope: 'page',
    //   category: 'seo',
    //   severity: 'error',
    //   title: 'Placeholder text left on the page',
    //   fix: 'Replace the placeholder copy.',
    //   sources: ['https://developers.google.com/search/docs/fundamentals/creating-helpful-content'],
    //   run: (page) => (/lorem ipsum/i.test(page.text) ? [{ message: 'Contains "lorem ipsum".' }] : []),
    // },
  ],
};
`,
} as const;
