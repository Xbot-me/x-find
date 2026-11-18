import { isAllowed } from '../robots/parse.js';
import { SRC } from '../sources.js';
import type { Issue, SiteCheck } from '../types.js';
import { duplicates, hash, isInternal, jaccard, pathOf, shingles, urlState } from './util.js';

const metaDescription = (p: { metas: { name: string | null; content: string | null; inHead: boolean }[] }) =>
  p.metas.find((m) => m.inHead && m.name?.toLowerCase() === 'description')?.content?.trim() || null;

export const seoSiteChecks: SiteCheck[] = [
  {
    id: 'title-duplicate',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'Same title on several pages',
    fix: 'Give every indexable page its own title describing that page.',
    sources: [SRC.title],
    run({ index }) {
      const groups = duplicates(index.indexable, (p) => p.titles.find((t) => t.inHead)?.text.toLowerCase() || null);
      const issues: Issue[] = groups.flatMap((g) =>
        g.map((p) => ({
          url: p.url,
          message: `Title shared with ${g.length - 1} other page(s).`,
          evidence: `"${p.titles[0]?.text}" also on ${g
            .filter((x) => x !== p)
            .map((x) => pathOf(x.url))
            .slice(0, 3)
            .join(', ')}`,
        })),
      );
      return { subjects: index.indexable.length, issues };
    },
  },
  {
    id: 'description-duplicate',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'Same description on several pages',
    fix: 'Write a description for each page that summarises that page.',
    sources: [SRC.snippet],
    run({ index }) {
      const groups = duplicates(index.indexable, (p) => metaDescription(p)?.toLowerCase() ?? null);
      const issues: Issue[] = groups.flatMap((g) =>
        g.map((p) => ({
          url: p.url,
          message: `Description shared with ${g.length - 1} other page(s).`,
          evidence: `also on ${g
            .filter((x) => x !== p)
            .map((x) => pathOf(x.url))
            .slice(0, 3)
            .join(', ')}`,
        })),
      );
      return { subjects: index.indexable.length, issues };
    },
  },
  {
    id: 'canonical-target-bad',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Canonical points to a page that cannot be the canonical',
    fix: 'Point the canonical at a live (200), indexable page that declares itself as canonical.',
    sources: [SRC.canonical],
    run(ctx) {
      const { index, site } = ctx;
      const issues: Issue[] = [];
      let subjects = 0;
      for (const page of site.pages) {
        const target = index.canonicalOf(page);
        if (!target || index.norm(target) === index.norm(page.url)) continue;
        subjects++;
        if (!isInternal(ctx, target)) continue; // cross-domain canonicals are allowed
        const state = urlState(ctx, target);
        const targetPage = index.pageByUrl.get(index.norm(target));
        let problem: string | null = null;
        if (state.state === 'missing') problem = 'does not exist';
        else if (state.state === 'error') problem = `returns HTTP ${state.status}`;
        else if (state.state === 'redirect') problem = `redirects (HTTP ${state.status})`;
        else if (targetPage?.robots.noindex) problem = 'is noindex';
        else if (targetPage) {
          const next = index.canonicalOf(targetPage);
          if (next && index.norm(next) !== index.norm(target)) problem = `canonicalises again to ${next}`;
        }
        if (problem)
          issues.push({ url: page.url, message: `Canonical target ${problem}.`, evidence: target, key: target });
      }
      return { subjects, issues };
    },
  },
  {
    id: 'link-broken-internal',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'Broken internal link',
    fix: 'Update or remove links that point to pages or files that do not exist.',
    sources: [SRC.http, SRC.links],
    run(ctx) {
      const { site } = ctx;
      const issues: Issue[] = [];
      let subjects = 0;
      const seen = new Map<string, ReturnType<typeof urlState>>();
      for (const page of site.pages) {
        for (const a of page.anchors) {
          if (!a.url || !isInternal(ctx, a.url)) continue;
          subjects++;
          let state = seen.get(a.url);
          if (!state) seen.set(a.url, (state = urlState(ctx, a.url)));
          if (state.state === 'missing' || state.state === 'error') {
            issues.push({
              url: page.url,
              message:
                state.state === 'missing'
                  ? 'Links to a URL with no matching file.'
                  : `Links to a URL that returns HTTP ${state.status}.`,
              evidence: `${pathOf(a.url)}${a.text ? ` ("${a.text.slice(0, 60)}")` : ''}`,
              key: a.url,
            });
          }
        }
      }
      return { subjects, issues };
    },
  },
  {
    id: 'page-orphan',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'Page no other page links to',
    fix: 'Link to this page from at least one related page (and the navigation or a hub page if it matters).',
    sources: [SRC.links],
    run(ctx) {
      const { index, site } = ctx;
      const home = index.norm(site.origin + '/');
      const candidates = index.indexable.filter((p) => index.norm(p.url) !== home);
      const issues = candidates
        .filter((p) => !index.inbound.get(index.norm(p.url))?.size)
        .map((p) => ({ url: p.url, message: 'No internal links point to this page.' }));
      return { subjects: candidates.length, issues };
    },
  },
  {
    id: 'content-duplicate',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'Pages with identical content',
    fix: 'Merge the pages, or point the copies at one page with rel=canonical (or a redirect).',
    sources: [SRC.canonical],
    run({ index }) {
      const groups = duplicates(index.indexable, (p) => (p.wordCount >= 20 ? hash(p.text) : null));
      const issues = groups.flatMap((g) =>
        g.map((p) => ({
          url: p.url,
          message: `Same text as ${g.length - 1} other page(s).`,
          evidence: g
            .filter((x) => x !== p)
            .map((x) => pathOf(x.url))
            .slice(0, 3)
            .join(', '),
        })),
      );
      return { subjects: index.indexable.length, issues };
    },
  },
  {
    id: 'content-near-duplicate',
    scope: 'site',
    category: 'seo',
    severity: 'notice',
    title: 'Pages with nearly the same content',
    fix: 'Make each page distinct (its own problem, solution and evidence) or merge them. Many near-identical pages can look like doorway pages.',
    sources: [SRC.spam],
    run({ index, config }) {
      const pages = index.indexable.filter((p) => p.wordCount >= 50).slice(0, 2000);
      const sh = pages.map((p) => shingles(p.text));
      const issues: Issue[] = [];
      const exact = new Set(duplicates(pages, (p) => hash(p.text)).flat());
      for (let i = 0; i < pages.length; i++) {
        for (let j = i + 1; j < pages.length; j++) {
          if (exact.has(pages[i]!) && exact.has(pages[j]!)) continue;
          const score = jaccard(sh[i]!, sh[j]!);
          if (score >= config.thresholds.similarity) {
            issues.push({
              url: pages[i]!.url,
              message: `${Math.round(score * 100)}% of the text overlaps with ${pathOf(pages[j]!.url)}.`,
              key: pages[j]!.url,
            });
          }
        }
      }
      return { subjects: pages.length, issues };
    },
  },
  {
    id: 'hreflang-not-reciprocal',
    scope: 'site',
    category: 'seo',
    severity: 'warning',
    title: 'hreflang without a return link',
    fix: 'Each page in an hreflang set must list every other page in the set, and those pages must link back.',
    sources: [SRC.hreflang],
    run(ctx) {
      const { index, site } = ctx;
      const issues: Issue[] = [];
      let subjects = 0;
      for (const page of site.pages) {
        for (const l of page.links) {
          if (!l.inHead || !l.rel.includes('alternate') || !l.hreflang || !l.href) continue;
          let target: string;
          try {
            target = new URL(l.href, page.url).href;
          } catch {
            continue;
          }
          if (index.norm(target) === index.norm(page.url)) continue;
          const other = index.pageByUrl.get(index.norm(target));
          if (!other) continue;
          subjects++;
          const back = other.links.some((x) => {
            if (!x.rel.includes('alternate') || !x.hreflang || !x.href) return false;
            try {
              return index.norm(new URL(x.href, other.url).href) === index.norm(page.url);
            } catch {
              return false;
            }
          });
          if (!back)
            issues.push({
              url: page.url,
              message: `${pathOf(target)} (${l.hreflang}) does not link back.`,
              key: target,
            });
        }
      }
      return { subjects, issues };
    },
  },
  {
    id: 'robots-noindex-blocked',
    scope: 'site',
    category: 'seo',
    severity: 'error',
    title: 'noindex page is also blocked in robots.txt',
    fix: 'Allow crawling of pages you want removed with noindex: when robots.txt blocks them, Google never sees the noindex and may keep the URL indexed.',
    sources: [SRC.robotsMeta, SRC.robotsTxt],
    run({ site, index, config }) {
      if (config.staging) return { subjects: 0, issues: [] };
      const noindex = site.pages.filter((p) => p.robots.noindex);
      const issues = noindex
        .filter((p) => !isAllowed(index.robots, 'Googlebot', p.url))
        .map((p) => ({ url: p.url, message: 'Googlebot is disallowed, so it cannot see the noindex.' }));
      return { subjects: noindex.length, issues };
    },
  },
];
