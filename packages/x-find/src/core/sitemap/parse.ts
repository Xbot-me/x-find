/**
 * Sitemap and sitemap index parser (https://www.sitemaps.org/protocol.html, Google's sitemap rules). Sitemaps use a
 * tiny, fixed XML vocabulary, so a strict scanner is enough and keeps the core free of an XML dependency. It reports
 * what makes Google reject or ignore entries rather than trying to be a general XML validator.
 */

export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

export interface ParsedSitemap {
  kind: 'urlset' | 'sitemapindex' | 'text' | 'unknown';
  entries: SitemapEntry[];
  errors: string[];
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value: string, errors: string[]): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);|&/g, (match, name: string | undefined) => {
    if (!name) {
      errors.push(`unescaped "&" in "${value.slice(0, 120)}" (must be written &amp;)`);
      return '&';
    }
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    const v = ENTITY[name];
    if (v === undefined) {
      errors.push(`unknown entity "${match}"`);
      return match;
    }
    return v;
  });
}

function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** W3C Datetime as used by sitemaps: YYYY, YYYY-MM, YYYY-MM-DD, or a full date-time with a timezone. */
export function isW3cDatetime(v: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/.test(v);
}

export function parseSitemap(body: string): ParsedSitemap {
  const errors: string[] = [];
  const xml = stripComments(body.replace(/^\uFEFF/, '')).trim();

  if (!xml.startsWith('<')) {
    // Text sitemap: one absolute URL per line, nothing else.
    const lines = xml
      .split(/\r\n|\r|\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return { kind: 'text', entries: lines.map((loc) => ({ loc, lastmod: null })), errors };
  }

  const root = /<(urlset|sitemapindex)[\s>]/.exec(xml.replace(/^<\?xml[^>]*\?>\s*/, ''));
  if (!root || xml.replace(/^<\?xml[^>]*\?>\s*/, '').search(/<(urlset|sitemapindex)[\s>]/) !== 0) {
    errors.push('root element is not <urlset> or <sitemapindex>');
    return { kind: 'unknown', entries: [], errors };
  }
  const kind = root[1] as 'urlset' | 'sitemapindex';
  if (!new RegExp(`</${kind}>\\s*$`).test(xml)) errors.push(`missing closing </${kind}>`);

  const item = kind === 'urlset' ? 'url' : 'sitemap';
  const entries: SitemapEntry[] = [];
  const itemRe = new RegExp(`<${item}(?:\\s[^>]*)?>([\\s\\S]*?)</${item}>`, 'g');
  for (const m of xml.matchAll(itemRe)) {
    const inner = m[1] ?? '';
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(inner);
    if (!loc) {
      errors.push(`<${item}> without <loc>`);
      continue;
    }
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/.exec(inner);
    entries.push({
      loc: decode(loc[1]!.trim(), errors),
      lastmod: lastmod ? lastmod[1]!.trim() : null,
    });
  }
  return { kind, entries, errors };
}
