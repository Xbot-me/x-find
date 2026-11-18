import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { declaredLogoUrls } from '../core/checks/geo.js';
import { parsePage } from '../core/html/parse.js';
import { parseRobotsTxt } from '../core/robots/parse.js';
import { parseSitemap } from '../core/sitemap/parse.js';
import type { PageModel, ResourceInfo, SiteModel, TextFile } from '../core/types.js';
import { makeNormalizer } from '../core/analyze.js';

export interface FolderOptions {
  /** Public origin of the site, e.g. https://example.com. */
  site: string;
  trailingSlash: 'always' | 'never' | 'ignore';
  /** Serve `about.html` at `/about` (most static hosts do). Default true. */
  cleanUrls?: boolean;
}

const SKIP_DIRS = new Set(['node_modules', '.git']);
/** Error pages are not part of the site's indexable content. */
const ERROR_PAGES = new Set(['404.html', '500.html', '50x.html']);

async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), base, out);
    } else if (entry.isFile()) {
      out.push(path.relative(base, path.join(dir, entry.name)).split(path.sep).join('/'));
    }
  }
  return out;
}

/** The URL path(s) a static host serves a file at. The first is the page's own URL. */
export function urlPathsFor(rel: string, opts: Pick<FolderOptions, 'trailingSlash' | 'cleanUrls'>): string[] {
  const clean = opts.cleanUrls ?? true;
  if (rel === 'index.html') return ['/', '/index.html'];
  if (rel.endsWith('/index.html')) {
    const dir = '/' + rel.slice(0, -'index.html'.length); // ends with /
    const noSlash = dir.slice(0, -1);
    const own = opts.trailingSlash === 'never' ? noSlash : dir;
    return [own, own === dir ? noSlash : dir, `/${rel}`];
  }
  if (rel.endsWith('.html')) {
    const noExt = '/' + rel.slice(0, -5);
    if (!clean) return [`/${rel}`];
    const own = opts.trailingSlash === 'always' ? `${noExt}/` : noExt;
    return [own, own === noExt ? `${noExt}/` : noExt, `/${rel}`];
  }
  return [`/${rel}`];
}

async function readText(file: string): Promise<{ body: string; bytes: number }> {
  let buf: Buffer = await readFile(file);
  if (file.endsWith('.gz')) buf = gunzipSync(buf);
  return { body: buf.toString('utf8'), bytes: buf.length };
}

export async function loadFolder(dir: string, opts: FolderOptions): Promise<SiteModel> {
  const root = path.resolve(dir);
  const st = await stat(root).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`Not a folder: ${dir}`);
  const origin = new URL(opts.site).origin;
  const norm = makeNormalizer(opts.trailingSlash);

  const files = await walk(root);
  const resources = new Map<string, ResourceInfo>();
  const fileByPath = new Map<string, string>();
  for (const rel of files) {
    for (const p of urlPathsFor(rel, opts)) {
      const url = origin + p;
      fileByPath.set(new URL(url).pathname, rel);
      resources.set(norm(url), { url, exists: true });
    }
  }

  const pages: PageModel[] = [];
  for (const rel of files) {
    if (!rel.endsWith('.html') || ERROR_PAGES.has(path.posix.basename(rel))) continue;
    const html = await readFile(path.join(root, rel), 'utf8');
    const url = origin + urlPathsFor(rel, opts)[0];
    pages.push(parsePage({ url, source: rel, html }));
  }

  const textFile = async (urlPath: string): Promise<TextFile | null> => {
    const rel = fileByPath.get(urlPath);
    if (!rel) return null;
    const { body, bytes } = await readText(path.join(root, rel));
    return { url: origin + urlPath, body, bytes };
  };

  const robotsTxt = await textFile('/robots.txt');
  const llmsTxt = await textFile('/llms.txt');

  // Sitemaps: those named in robots.txt, else the usual names; follow sitemap indexes.
  const sitemaps: TextFile[] = [];
  const queue: string[] = [];
  if (robotsTxt?.body) {
    for (const s of parseRobotsTxt(robotsTxt.body).sitemaps) {
      try {
        queue.push(new URL(s.url, origin).href);
      } catch {
        /* reported by robotstxt-sitemap-relative */
      }
    }
  }
  if (!queue.length) {
    for (const name of ['/sitemap-index.xml', '/sitemap_index.xml', '/sitemap.xml'])
      if (fileByPath.has(name)) queue.push(origin + name);
  }
  const seen = new Set<string>();
  while (queue.length && seen.size < 1000) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const u = new URL(url);
    if (u.origin !== origin) continue; // can't read another host's sitemap from a folder
    const file = await textFile(u.pathname);
    if (!file) {
      sitemaps.push({ url, body: null, bytes: 0 });
      continue;
    }
    sitemaps.push(file);
    const parsed = parseSitemap(file.body ?? '');
    if (parsed.kind === 'sitemapindex') for (const e of parsed.entries) queue.push(e.loc);
  }

  // Logo files named in Organization markup, so the size check can read them.
  for (const logo of declaredLogoUrls(pages)) {
    const u = new URL(logo);
    if (u.origin !== origin) continue;
    const rel = fileByPath.get(u.pathname);
    resources.set(
      norm(logo),
      rel
        ? { url: logo, exists: true, data: new Uint8Array(await readFile(path.join(root, rel))) }
        : { url: logo, exists: false },
    );
  }

  return { mode: 'folder', origin, pages, robotsTxt, llmsTxt, sitemaps, resources, failedPages: new Map() };
}
