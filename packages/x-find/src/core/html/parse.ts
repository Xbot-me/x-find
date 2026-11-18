/**
 * Turns an HTML document into a PageModel using parse5, which follows the HTML parsing spec. That matters for search:
 * an element that isn't allowed in <head> (e.g. a <div> or <img>) closes the head early, and everything after it,
 * canonical and meta tags included, ends up in <body>, where Google ignores them. A regex parser can't see this.
 */
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type {
  Anchor,
  HttpInfo,
  ImageRef,
  JsonLdBlock,
  LinkTag,
  MetaTag,
  PageModel,
  RobotsDirectives,
} from '../types.js';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template']);

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function attr(el: Element, name: string): string | null {
  const a = el.attrs.find((x) => x.name === name);
  return a ? a.value : null;
}

function children(node: Node): Node[] {
  return 'childNodes' in node ? (node as ParentNode).childNodes : [];
}

function* walk(node: Node): Generator<Element> {
  for (const child of children(node)) {
    if (isElement(child)) {
      yield child;
      if (child.tagName === 'template') continue;
      yield* walk(child);
    }
  }
}

function textOf(node: Node, out: string[] = []): string[] {
  for (const child of children(node)) {
    if (child.nodeName === '#text') out.push((child as DefaultTreeAdapterMap['textNode']).value);
    else if (isElement(child) && !SKIP_TEXT.has(child.tagName)) textOf(child, out);
  }
  return out;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Words for thin-content checks. CJK and similar scripts have no spaces, so each such character counts as a word. */
export function countWords(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/gu);
  const rest = text.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/gu,
    ' ',
  );
  const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length + (cjk?.length ?? 0);
}

function resolve(href: string | null, base: string): string | null {
  if (href === null) return null;
  const h = href.trim();
  if (h === '' || h.startsWith('#')) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

const VALUED_DIRECTIVES = new Set(['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after']);

/** Parses robots meta content or an X-Robots-Tag value into (agent, directive) pairs. */
export function parseRobotsValue(value: string, defaultAgent: string): { agent: string; value: string }[] {
  const out: { agent: string; value: string }[] = [];
  let agent = defaultAgent;
  for (const part of value.split(',')) {
    let token = part.trim().toLowerCase();
    if (!token) continue;
    const m = /^([a-z0-9_-]+)\s*:\s*(.*)$/.exec(token);
    if (m && !VALUED_DIRECTIVES.has(m[1]!)) {
      agent = m[1]!;
      token = m[2]!.trim();
      if (!token) continue;
    }
    out.push({ agent, value: token.replace(/\s*:\s*/, ':') });
  }
  return out;
}

export function robotsDirectives(metas: MetaTag[], headers: Record<string, string> | undefined): RobotsDirectives {
  const all: RobotsDirectives['all'] = [];
  for (const m of metas) {
    const name = m.name?.toLowerCase();
    if (!name || m.content === null) continue;
    if (name === 'robots' || name === 'googlebot' || name === 'googlebot-news' || /bot$/.test(name)) {
      for (const d of parseRobotsValue(m.content, name === 'robots' ? '*' : name)) all.push({ ...d, from: 'meta' });
    }
  }
  const header = headers?.['x-robots-tag'];
  if (header) for (const d of parseRobotsValue(header, '*')) all.push({ ...d, from: 'header' });

  const forGoogle = all.filter((d) => d.agent === '*' || d.agent === 'googlebot' || d.agent === 'robots');
  const has = (v: string) => forGoogle.some((d) => d.value === v);
  const snippetValues = forGoogle
    .filter((d) => d.value.startsWith('max-snippet:'))
    .map((d) => Number(d.value.slice('max-snippet:'.length)))
    .filter((n) => Number.isFinite(n));
  // The most restrictive rule wins; -1 means "no limit".
  const limited = snippetValues.filter((n) => n >= 0);
  return {
    all,
    noindex: has('noindex') || has('none'),
    nofollow: has('nofollow') || has('none'),
    nosnippet: has('nosnippet'),
    maxSnippet: limited.length ? Math.min(...limited) : snippetValues.length ? -1 : null,
  };
}

export interface ParseInput {
  url: string;
  source: string;
  html: string;
  http?: HttpInfo;
}

export function parsePage({ url, source, html, http }: ParseInput): PageModel {
  const doc = parse(html);
  const htmlEl = children(doc).find((n): n is Element => isElement(n) && n.tagName === 'html');
  const head = htmlEl ? children(htmlEl).find((n): n is Element => isElement(n) && n.tagName === 'head') : undefined;
  const body = htmlEl ? children(htmlEl).find((n): n is Element => isElement(n) && n.tagName === 'body') : undefined;

  const headSet = new Set<Element>();
  if (head) for (const el of walk(head)) headSet.add(el);

  let base = url;
  const titles: PageModel['titles'] = [];
  const metas: MetaTag[] = [];
  const links: LinkTag[] = [];
  const anchors: Anchor[] = [];
  const images: ImageRef[] = [];
  const jsonld: JsonLdBlock[] = [];
  const headings: PageModel['headings'] = [];
  let inlineScriptBytes = 0;
  let externalScripts = 0;

  // <base href> applies to every relative URL in the document; read it first.
  for (const el of walk(doc)) {
    if (el.tagName === 'base') {
      const href = attr(el, 'href');
      if (href) {
        try {
          base = new URL(href, url).href;
        } catch {
          /* invalid base: browsers ignore it */
        }
      }
      break;
    }
  }

  for (const el of walk(doc)) {
    const inHead = headSet.has(el);
    switch (el.tagName) {
      case 'title':
        // An <svg><title> is an accessibility label, not the document title.
        if (el.namespaceURI === 'http://www.w3.org/1999/xhtml')
          titles.push({ text: collapse(textOf(el).join('')), inHead });
        break;
      case 'meta':
        metas.push({
          name: attr(el, 'name'),
          property: attr(el, 'property'),
          httpEquiv: attr(el, 'http-equiv'),
          charset: attr(el, 'charset'),
          content: attr(el, 'content'),
          inHead,
        });
        break;
      case 'link':
        links.push({
          rel: (attr(el, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean),
          href: attr(el, 'href'),
          hreflang: attr(el, 'hreflang'),
          inHead,
        });
        break;
      case 'a': {
        const href = attr(el, 'href');
        const imageAlt = [...walk(el)]
          .filter((c) => c.tagName === 'img')
          .map((c) => attr(c, 'alt') ?? '')
          .join(' ');
        anchors.push({
          href,
          url: resolve(href, base),
          text: collapse(textOf(el).join(' ')),
          imageAlt: collapse(imageAlt),
          label: collapse(attr(el, 'aria-label') ?? attr(el, 'title') ?? ''),
          rel: (attr(el, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean),
        });
        break;
      }
      case 'img':
        images.push({
          src: attr(el, 'src'),
          url: resolve(attr(el, 'src'), base),
          alt: attr(el, 'alt'),
          width: attr(el, 'width'),
          height: attr(el, 'height'),
        });
        break;
      case 'script': {
        const type = (attr(el, 'type') ?? '').toLowerCase().trim();
        const content = children(el)
          .filter((c) => c.nodeName === '#text')
          .map((c) => (c as DefaultTreeAdapterMap['textNode']).value)
          .join('');
        if (type === 'application/ld+json') {
          try {
            jsonld.push({ raw: content, value: JSON.parse(content) });
          } catch (e) {
            jsonld.push({ raw: content, error: (e as Error).message });
          }
        } else if (attr(el, 'src') !== null) {
          externalScripts++;
        } else if (type === '' || type === 'module' || type.includes('javascript')) {
          inlineScriptBytes += content.length;
        }
        break;
      }
      default: {
        const m = /^h([1-6])$/.exec(el.tagName);
        if (m) headings.push({ level: Number(m[1]), text: collapse(textOf(el).join(' ')) });
      }
    }
  }

  const text = body ? collapse(textOf(body).join(' ')) : '';
  const first1k = html.slice(0, 1024);
  const charsetEarly = /<meta[^>]+charset\s*=/i.test(first1k) || /charset=/i.test(http?.headers['content-type'] ?? '');

  return {
    url,
    source,
    ...(http ? { http } : {}),
    bytes: new TextEncoder().encode(html).length,
    titles,
    metas,
    links,
    lang: htmlEl ? attr(htmlEl, 'lang') : null,
    charsetEarly,
    headings,
    anchors,
    images,
    jsonld,
    text,
    wordCount: countWords(text),
    inlineScriptBytes,
    externalScripts,
    robots: robotsDirectives(metas, http?.headers),
  };
}
