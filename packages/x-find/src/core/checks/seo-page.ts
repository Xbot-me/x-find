import { canonicalHref } from '../analyze.js';
import { SRC } from '../sources.js';
import type { Issue, PageCheck, PageModel } from '../types.js';

const metaByName = (page: PageModel, name: string) =>
  page.metas.filter((m) => m.name?.toLowerCase() === name && m.content !== null);
const metaByProperty = (page: PageModel, prop: string) =>
  page.metas.filter((m) => m.property?.toLowerCase() === prop && m.content);
const canonicalLinks = (page: PageModel) => page.links.filter((l) => l.rel.includes('canonical'));
const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const seoPageChecks: PageCheck[] = [
  {
    id: 'title-missing',
    scope: 'page',
    category: 'seo',
    severity: 'error',
    title: 'Page has no title',
    fix: 'Add a <title> in <head> that describes this specific page.',
    sources: [SRC.title],
    run(page) {
      const inHead = page.titles.filter((t) => t.inHead && t.text);
      if (inHead.length) return [];
      if (page.titles.some((t) => t.text)) return [{ message: 'The <title> is outside <head>, where it is not used.' }];
      return [{ message: page.titles.length ? 'The <title> element is empty.' : 'No <title> element.' }];
    },
  },
  {
    id: 'title-multiple',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'More than one title',
    fix: 'Keep one <title> element. Several usually means a template and a component both set it.',
    sources: [SRC.title],
    run(page) {
      return page.titles.length > 1
        ? [{ message: `${page.titles.length} <title> elements.`, evidence: page.titles.map((t) => t.text).join(' | ') }]
        : [];
    },
  },
  {
    id: 'title-length',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'Title may be truncated in results',
    fix: 'Put the words that matter first. Google sets no length limit but cuts titles to fit the screen.',
    sources: [SRC.title],
    run(page, { config }) {
      const t = page.titles.find((x) => x.inHead)?.text ?? '';
      const max = config.thresholds.titleMaxChars;
      return t.length > max ? [{ message: `Title is ${t.length} characters (guide: ${max}).`, evidence: t }] : [];
    },
  },
  {
    id: 'description-missing',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    indexableOnly: true,
    title: 'No meta description',
    fix: 'Add <meta name="description"> summarising what the page offers. Google may use it as the snippet.',
    sources: [SRC.snippet],
    run(page) {
      const d = metaByName(page, 'description');
      if (d.some((m) => m.inHead && m.content!.trim())) return [];
      if (d.some((m) => m.content!.trim())) return [{ message: 'The meta description is outside <head>.' }];
      return [{ message: d.length ? 'The meta description is empty.' : 'No meta description.' }];
    },
  },
  {
    id: 'description-multiple',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'More than one meta description',
    fix: 'Keep one meta description.',
    sources: [SRC.snippet],
    run(page) {
      const d = metaByName(page, 'description');
      return d.length > 1 ? [{ message: `${d.length} meta descriptions.` }] : [];
    },
  },
  {
    id: 'description-length',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'Description may be truncated in results',
    fix: 'Lead with the most useful detail. Google sets no length limit but shortens snippets to fit.',
    sources: [SRC.snippet],
    run(page, { config }) {
      const d = metaByName(page, 'description')[0]?.content?.trim() ?? '';
      const max = config.thresholds.descriptionMaxChars;
      return d.length > max
        ? [{ message: `Description is ${d.length} characters (guide: ${max}).`, evidence: short(d, 200) }]
        : [];
    },
  },
  {
    id: 'canonical-missing',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'No canonical URL',
    fix: 'Add <link rel="canonical" href="…"> with the absolute URL of this page, so duplicates (tracking parameters, trailing slashes) fold into it.',
    sources: [SRC.canonical],
    run(page) {
      if (page.robots.noindex) return [];
      return canonicalHref(page) === null && canonicalLinks(page).length === 0
        ? [{ message: 'No canonical declared.' }]
        : [];
    },
  },
  {
    id: 'canonical-multiple',
    scope: 'page',
    category: 'seo',
    severity: 'error',
    title: 'Several canonical URLs',
    fix: 'Declare exactly one canonical. With conflicting signals Google may ignore all of them.',
    sources: [SRC.canonical],
    run(page) {
      const links = canonicalLinks(page);
      return links.length > 1
        ? [{ message: `${links.length} canonical links.`, evidence: links.map((l) => l.href).join(' | ') }]
        : [];
    },
  },
  {
    id: 'canonical-relative',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'Canonical is a relative URL',
    fix: 'Use the full absolute URL, including https:// and the host.',
    sources: [SRC.canonical],
    run(page) {
      return canonicalLinks(page)
        .filter((l) => l.href && !/^https?:\/\//i.test(l.href.trim()))
        .map((l) => ({ message: 'Canonical is relative.', evidence: l.href! }));
    },
  },
  {
    id: 'canonical-not-in-head',
    scope: 'page',
    category: 'seo',
    severity: 'error',
    title: 'Canonical is outside <head>',
    fix: 'Move the canonical into <head>. If it is already there in the source, an element that is not allowed in <head> (a <div>, <img>, or text) closes the head early: move that element into <body>.',
    sources: [SRC.canonical],
    run(page) {
      return canonicalLinks(page)
        .filter((l) => !l.inHead)
        .map((l) => ({
          message: 'The canonical ends up in <body> after HTML parsing, so Google ignores it.',
          evidence: l.href ?? '',
        }));
    },
  },
  {
    id: 'canonical-fragment',
    scope: 'page',
    category: 'seo',
    severity: 'error',
    title: 'Canonical contains a #fragment',
    fix: 'Remove the #fragment from the canonical URL.',
    sources: [SRC.canonical],
    run(page) {
      return canonicalLinks(page)
        .filter((l) => l.href?.includes('#'))
        .map((l) => ({ message: 'Canonical URL has a fragment.', evidence: l.href! }));
    },
  },
  {
    id: 'canonical-http-on-https',
    scope: 'page',
    category: 'seo',
    severity: 'error',
    title: 'HTTPS page declares an HTTP canonical',
    fix: 'Point the canonical at the https:// URL. An http canonical tells Google to prefer the insecure version.',
    sources: [SRC.canonical],
    run(page) {
      const c = canonicalHref(page);
      return page.url.startsWith('https://') && c?.startsWith('http://')
        ? [{ message: 'Canonical uses http://.', evidence: c }]
        : [];
    },
  },
  {
    id: 'robots-meta-noindex',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'Page is noindex',
    fix: 'If this page should appear in search, remove noindex from the robots meta tag or X-Robots-Tag header.',
    sources: [SRC.robotsMeta],
    run(page, { config }) {
      if (!page.robots.noindex || config.staging) return [];
      const from = page.robots.all
        .filter((d) => d.value === 'noindex' || d.value === 'none')
        .map((d) => `${d.from} (${d.agent})`);
      return [{ message: 'Page asks not to be indexed.', evidence: [...new Set(from)].join(', ') }];
    },
  },
  {
    id: 'robots-meta-invalid',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'Unknown or ignored robots directive',
    fix: 'Remove directives Google ignores and fix misspelled ones, so the tag says what you mean.',
    sources: [SRC.robotsMeta],
    run(page) {
      const issues: Issue[] = [];
      for (const d of page.robots.all) {
        if (d.agent !== '*' && d.agent !== 'googlebot') continue;
        const v = d.value;
        if (
          /^(all|index|follow|noindex|nofollow|none|nosnippet|indexifembedded|notranslate|noimageindex|noai|noimageai)$/.test(
            v,
          )
        )
          continue;
        if (/^max-snippet:-?\d+$/.test(v) || /^max-video-preview:-?\d+$/.test(v)) continue;
        if (/^max-image-preview:(none|standard|large)$/.test(v)) continue;
        if (v.startsWith('unavailable_after:') && !Number.isNaN(Date.parse(v.slice(18)))) continue;
        const ignored = /^(noarchive|nocache|nositelinkssearchbox|noodp|noydir)$/.test(v);
        issues.push({
          message: ignored ? `"${v}" is ignored by Google.` : `"${v}" is not a valid robots directive.`,
          key: v,
        });
      }
      return issues;
    },
  },
  {
    id: 'meta-in-body',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'Head tags ended up in <body>',
    fix: 'Something in <head> that is not allowed there (a <div>, <img>, <iframe> or stray text) closes the head early, so the tags after it are parsed as body content and ignored. Move that element into <body>.',
    sources: [SRC.canonical],
    run(page) {
      const names = new Set(['description', 'robots', 'googlebot', 'viewport']);
      const bad = [
        ...page.metas
          .filter(
            (m) =>
              !m.inHead && ((m.name && names.has(m.name.toLowerCase())) || m.property?.toLowerCase().startsWith('og:')),
          )
          .map((m) => `<meta ${m.name ? `name="${m.name}"` : `property="${m.property}"`}>`),
        ...page.links
          .filter((l) => !l.inHead && l.rel.includes('alternate') && l.hreflang)
          .map(() => '<link rel="alternate" hreflang>'),
      ];
      return bad.length
        ? [{ message: `${bad.length} head tag(s) parsed into <body>.`, evidence: [...new Set(bad)].join(', ') }]
        : [];
    },
  },
  {
    id: 'viewport-missing',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'No viewport meta tag',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">. Google indexes the mobile version of pages.',
    sources: [SRC.mobile],
    run(page) {
      return metaByName(page, 'viewport').length ? [] : [{ message: 'No <meta name="viewport">.' }];
    },
  },
  {
    id: 'h1-missing',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    indexableOnly: true,
    title: 'No main heading',
    fix: 'Give the page a visible <h1> naming its topic. Google uses main headings among the sources for title links.',
    sources: [SRC.title],
    run(page) {
      return page.headings.some((h) => h.level === 1 && h.text) ? [] : [{ message: 'No non-empty <h1>.' }];
    },
  },
  {
    id: 'link-not-crawlable',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'Link Google cannot follow',
    fix: 'Use <a href="/real-url"> for navigation. Google does not follow javascript: links or <a> without href.',
    sources: [SRC.links],
    run(page) {
      const issues: Issue[] = [];
      for (const a of page.anchors) {
        if (a.href !== null && /^\s*javascript:/i.test(a.href)) {
          issues.push({ message: 'Link uses a javascript: URL.', evidence: short(a.text || a.href), key: a.href });
        } else if (a.href === null && (a.text || a.imageAlt)) {
          issues.push({
            message: '<a> without href.',
            evidence: short(a.text || a.imageAlt),
            key: a.text || a.imageAlt,
            severity: 'notice',
          });
        }
      }
      return issues;
    },
  },
  {
    id: 'link-empty-text',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'Link without text',
    fix: 'Give the link visible text, or alt text on its image, describing where it goes.',
    sources: [SRC.links],
    run(page) {
      return page.anchors
        .filter((a) => a.url && !a.text && !a.imageAlt)
        .map((a) => ({
          message: a.label ? 'Link has only an aria-label/title, no text.' : 'Link has no text.',
          evidence: a.href ?? '',
          key: a.url!,
          ...(a.label ? { severity: 'notice' as const } : {}),
        }));
    },
  },
  {
    id: 'link-generic-text',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'Generic link text',
    fix: 'Write link text that makes sense on its own, e.g. "character rigging pricing" instead of "click here".',
    sources: [SRC.links],
    run(page, { config }) {
      const generic = new Set(config.genericLinkText);
      return page.anchors
        .filter(
          (a) =>
            a.url &&
            generic.has(
              a.text
                .toLowerCase()
                .replace(/[.!?…:→»›]+$/u, '')
                .trim(),
            ),
        )
        .map((a) => ({ message: `Link text "${a.text}".`, evidence: a.href ?? '', key: `${a.text}|${a.url}` }));
    },
  },
  {
    id: 'link-internal-http',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'Internal link uses http://',
    fix: 'Link to the https:// URL directly instead of relying on a redirect.',
    sources: [SRC.canonical],
    run(page) {
      if (!page.url.startsWith('https://')) return [];
      const host = new URL(page.url).hostname;
      return page.anchors
        .filter((a) => a.url?.startsWith('http://') && new URL(a.url).hostname === host)
        .map((a) => ({ message: 'Internal link uses http://.', evidence: a.url!, key: a.url! }));
    },
  },
  {
    id: 'link-localhost',
    scope: 'page',
    category: 'seo',
    severity: 'error',
    title: 'Link to localhost',
    fix: 'Replace development URLs with the public URL or a relative path.',
    sources: [SRC.links],
    run(page) {
      return [...page.anchors.map((a) => a.url), ...page.images.map((i) => i.url), ...page.links.map((l) => l.href)]
        .filter((u): u is string => !!u && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)/i.test(u))
        .map((u) => ({ message: 'Points to a local development address.', evidence: u, key: u }));
    },
  },
  {
    id: 'img-alt-missing',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'Image without alt attribute',
    fix: 'Add alt text describing the image. Use alt="" only for purely decorative images.',
    sources: [SRC.images],
    run(page) {
      return page.images
        .filter((i) => i.alt === null)
        .map((i) => ({ message: 'Image has no alt attribute.', evidence: i.src ?? '', key: i.src ?? '' }));
    },
  },
  {
    id: 'img-dimensions-missing',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'Image without width and height',
    fix: 'Set width and height attributes (or CSS aspect-ratio) so the page does not shift while images load.',
    sources: [SRC.cls],
    run(page) {
      return page.images
        .filter((i) => !i.width || !i.height)
        .map((i) => ({ message: 'Image has no width/height.', evidence: i.src ?? '', key: i.src ?? '' }));
    },
  },
  {
    id: 'html-lang-missing',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'Page language not declared',
    fix: 'Add lang to <html>, e.g. <html lang="en">.',
    sources: [SRC.wcagLang, SRC.bcp47],
    run(page) {
      if (!page.lang) return [{ message: 'No lang attribute on <html>.' }];
      return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(page.lang.trim())
        ? []
        : [{ message: `"${page.lang}" is not a valid language tag.` }];
    },
  },
  {
    id: 'content-thin',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    indexableOnly: true,
    title: 'Little text on the page',
    fix: 'Make sure the page has enough original content to be worth showing: what it is, who it is for, evidence, next step.',
    sources: [SRC.spam],
    run(page, { config }) {
      const min = config.thresholds.thinContentWords;
      return page.wordCount < min ? [{ message: `${page.wordCount} words of visible text (guide: ${min}).` }] : [];
    },
  },
  {
    id: 'url-structure',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'URL is harder to read',
    fix: 'Prefer lower-case words separated by hyphens. Change existing URLs only with a permanent redirect.',
    sources: [SRC.urlStructure],
    run(page) {
      const path = decodeURIComponent(new URL(page.url).pathname);
      const problems = [
        path.includes('_') && 'underscores',
        /[A-Z]/.test(path) && 'upper-case letters',
        / /.test(path) && 'spaces',
        /\/\//.test(path) && 'double slashes',
      ].filter(Boolean);
      return problems.length ? [{ message: `URL has ${problems.join(', ')}.`, evidence: path }] : [];
    },
  },
  {
    id: 'charset-missing',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'Character encoding not declared early',
    fix: 'Make <meta charset="utf-8"> the first element in <head> (it must be within the first 1024 bytes).',
    sources: [SRC.htmlCharset],
    run(page) {
      return page.charsetEarly ? [] : [{ message: 'No charset in the first 1024 bytes or the Content-Type header.' }];
    },
  },
  {
    id: 'og-missing',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    indexableOnly: true,
    title: 'No link-preview tags',
    fix: 'Add og:title and og:image so links shared in chats and social posts show a proper preview.',
    sources: [SRC.ogp],
    run(page) {
      const missing = ['og:title', 'og:image'].filter((p) => metaByProperty(page, p).length === 0);
      return missing.length ? [{ message: `Missing ${missing.join(' and ')}.` }] : [];
    },
  },
  {
    id: 'hreflang-invalid',
    scope: 'page',
    category: 'seo',
    severity: 'warning',
    title: 'Invalid hreflang annotation',
    fix: 'Use absolute URLs, valid codes (e.g. en, en-GB, x-default), and include the page itself in its hreflang set.',
    sources: [SRC.hreflang],
    run(page, { index }) {
      const alts = page.links.filter((l) => l.inHead && l.rel.includes('alternate') && l.hreflang);
      if (!alts.length) return [];
      const issues: Issue[] = [];
      for (const l of alts) {
        const code = l.hreflang!.trim();
        if (!/^(x-default|[a-zA-Z]{2,3}(-([a-zA-Z]{4}))?(-([a-zA-Z]{2}|\d{3}))?)$/.test(code))
          issues.push({ message: `"${code}" is not a valid hreflang code.`, key: `code:${code}` });
        if (!l.href || !/^https?:\/\//i.test(l.href))
          issues.push({ message: `hreflang "${code}" uses a relative URL.`, key: `rel:${code}` });
      }
      const self = alts.some((l) => {
        try {
          return index.norm(new URL(l.href ?? '', page.url).href) === index.norm(page.url);
        } catch {
          return false;
        }
      });
      if (!self) issues.push({ message: 'The hreflang set does not include this page itself.', key: 'self' });
      return issues;
    },
  },
];
