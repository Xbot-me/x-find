import { CRAWLERS, CRAWLER_DOCS } from '../crawlers.js';
import { matchRobots } from '../robots/parse.js';
import { SRC } from '../sources.js';
import type { CheckContext, Issue, PageCheck, SiteCheck } from '../types.js';
import { isInternal, pathOf, urlState } from './util.js';

function pagesToTest(ctx: CheckContext) {
  const pages = ctx.index.indexable.length ? ctx.index.indexable : ctx.site.pages;
  const home = `${ctx.site.origin}/`;
  const urls = new Set([home, ...pages.map((p) => p.url)]);
  return [...urls];
}

export const aeoPageChecks: PageCheck[] = [
  {
    id: 'snippet-restricted',
    scope: 'page',
    category: 'aeo',
    severity: 'warning',
    indexableOnly: true,
    title: 'Page restricts snippets',
    fix: 'Remove nosnippet / max-snippet:0 if you want the page used as a source in Google AI Overviews and AI Mode: pages must be eligible for a snippet.',
    sources: [SRC.aiFeatures, SRC.robotsMeta],
    run(page) {
      const r = page.robots;
      if (r.nosnippet) return [{ message: 'nosnippet: not eligible as a supporting link in Google AI features.' }];
      if (r.maxSnippet === 0)
        return [{ message: 'max-snippet:0: not eligible as a supporting link in Google AI features.' }];
      if (r.maxSnippet !== null && r.maxSnippet > 0)
        return [
          {
            message: `max-snippet:${r.maxSnippet} limits how much text can be shown.`,
            severity: 'notice',
            basis: 'info',
          },
        ];
      return [];
    },
  },
  {
    id: 'content-needs-js',
    scope: 'page',
    category: 'aeo',
    severity: 'warning',
    indexableOnly: true,
    title: 'Content may need JavaScript',
    fix: 'Render the main content into the HTML on the server or at build time. Google renders JavaScript later and less reliably; most AI crawlers do not run it at all.',
    sources: [SRC.javascript, SRC.aiFeatures],
    run(page) {
      const scriptHeavy = page.externalScripts > 0 || page.inlineScriptBytes > 20_000;
      return page.wordCount < 50 && scriptHeavy
        ? [{ message: `Only ${page.wordCount} words in the HTML, with scripts that probably render the rest.` }]
        : [];
    },
  },
  {
    id: 'ai-optout-directives',
    scope: 'page',
    category: 'aeo',
    severity: 'notice',
    title: 'noai / noimageai directives',
    fix: 'A policy choice, not an error. No major search or answer engine documents support for these values, so they may have no effect.',
    sources: [SRC.robotsMeta],
    run(page) {
      const found = [
        ...new Set(page.robots.all.filter((d) => d.value === 'noai' || d.value === 'noimageai').map((d) => d.value)),
      ];
      return found.length ? [{ message: `Declares ${found.join(', ')}.` }] : [];
    },
  },
];

export const aeoSiteChecks: SiteCheck[] = [
  {
    id: 'ai-search-bot-blocked',
    scope: 'site',
    category: 'aeo',
    severity: 'error',
    title: 'Search or answer engine crawler blocked',
    fix: 'Allow this crawler in robots.txt (and in your CDN or firewall bot settings) if you want to appear and be cited in that engine.',
    sources: [SRC.robotsTxt, ...CRAWLER_DOCS],
    run(ctx) {
      if (ctx.config.staging || !ctx.index.robots) return { subjects: 0, issues: [] };
      const urls = pagesToTest(ctx);
      const search = CRAWLERS.filter((c) => c.purpose === 'search');
      const issues: Issue[] = [];
      for (const c of search) {
        const blocked = urls
          .map((u) => ({ u, m: matchRobots(ctx.index.robots!, c.token, u) }))
          .filter((x) => !x.m.allowed);
        if (!blocked.length) continue;
        const rule = blocked[0]!.m.rule;
        issues.push({
          message: `${c.token} (${c.operator}: ${c.affects}) is disallowed on ${blocked.length} of ${urls.length} pages.`,
          evidence: `${rule ? `robots.txt line ${rule.line}: Disallow: ${rule.raw}` : ''}; e.g. ${pathOf(blocked[0]!.u)}`,
          key: c.id,
        });
      }
      return { subjects: search.length, issues };
    },
  },
  {
    id: 'ai-training-bot-policy',
    scope: 'site',
    category: 'aeo',
    severity: 'notice',
    title: 'AI training crawler blocked',
    fix: 'Your choice: blocking training crawlers does not affect search results or citations. Listed so the policy is visible.',
    sources: CRAWLER_DOCS,
    run(ctx) {
      if (!ctx.index.robots) return { subjects: 0, issues: [] };
      const home = `${ctx.site.origin}/`;
      const training = CRAWLERS.filter((c) => c.purpose === 'training');
      const issues = training
        .filter((c) => !matchRobots(ctx.index.robots!, c.token, home).allowed)
        .map((c) => ({ message: `${c.token} (${c.affects}) is disallowed.`, key: c.id }));
      return { subjects: training.length, issues };
    },
  },
  {
    id: 'robotstxt-content-signal',
    scope: 'site',
    category: 'aeo',
    severity: 'warning',
    title: 'Content-Signal line is malformed or contradicts the rules',
    fix: 'Write Content-Signal as comma-separated key=value pairs with keys search, ai-input, ai-train and values yes or no, and keep it consistent with your Disallow rules.',
    sources: [SRC.contentSignals],
    run(ctx) {
      const r = ctx.index.robots;
      if (!r) return { subjects: 0, issues: [] };
      const lines = r.groups.flatMap((g) => g.contentSignals.map((s) => ({ ...s, group: g })));
      const issues: Issue[] = [];
      const url = ctx.site.robotsTxt?.url;
      for (const s of lines) {
        for (const part of s.value.split(',')) {
          const [k, v] = part.split('=').map((x) => x?.trim().toLowerCase());
          if (!k) continue;
          if (!['search', 'ai-input', 'ai-train'].includes(k))
            issues.push({ url, message: `Line ${s.line}: unknown signal "${k}".`, severity: 'notice', key: `k:${k}` });
          else if (v !== 'yes' && v !== 'no')
            issues.push({ url, message: `Line ${s.line}: "${k}" must be yes or no.`, key: `v:${k}` });
          else if (k === 'ai-train' && v === 'yes') {
            const blocked = CRAWLERS.filter(
              (c) => c.purpose === 'training' && !matchRobots(r, c.token, `${ctx.site.origin}/`).allowed,
            );
            if (blocked.length)
              issues.push({
                url,
                message: `Line ${s.line}: ai-train=yes, but ${blocked.map((c) => c.token).join(', ')} are disallowed.`,
                key: 'contradiction',
              });
          }
        }
      }
      return { subjects: lines.length, issues };
    },
  },
  {
    id: 'crawler-ua-blocked',
    scope: 'site',
    category: 'aeo',
    severity: 'error',
    live: true,
    title: 'Server blocks a crawler by user agent',
    fix: 'Allow this crawler in your CDN or firewall (e.g. Cloudflare: Security → Bots / AI Crawl Control). Robots.txt can allow a crawler that the firewall still blocks.',
    sources: CRAWLER_DOCS,
    run(ctx) {
      const access = ctx.site.live?.crawlerAccess ?? [];
      const issues: Issue[] = [];
      const ids = new Set(access.map((a) => a.crawlerId));
      for (const a of access) {
        const c = CRAWLERS.find((x) => x.id === a.crawlerId);
        if (!c) continue;
        const blocked = a.challenge || a.status === 401 || a.status === 403 || a.status === 429;
        if (!blocked) continue;
        issues.push({
          url: a.url,
          message: `${c.token} gets ${a.challenge ? 'a bot challenge page' : `HTTP ${a.status}`} (${c.affects}).`,
          evidence:
            'Tested by user-agent string from this machine; a firewall that verifies crawlers by IP may treat the real crawler differently.',
          key: `${c.id}|${pathOf(a.url)}`,
          ...(c.purpose === 'training' ? { severity: 'notice' as const, basis: 'info' as const } : {}),
        });
      }
      return { subjects: ids.size, issues };
    },
  },
  {
    id: 'llmstxt-missing',
    scope: 'site',
    category: 'aeo',
    severity: 'notice',
    title: 'No llms.txt',
    fix: 'Optional. Google says AI Overviews need no special files; some AI tools and agents read /llms.txt as a guide to your key pages.',
    sources: [SRC.llmsTxt, SRC.aiFeatures],
    run(ctx) {
      const f = ctx.site.llmsTxt;
      const present = f?.body != null && (f.status ?? 200) < 400;
      return { subjects: 1, issues: present ? [] : [{ url: `${ctx.site.origin}/llms.txt`, message: 'No /llms.txt.' }] };
    },
  },
  {
    id: 'llmstxt-invalid',
    scope: 'site',
    category: 'aeo',
    severity: 'warning',
    title: 'llms.txt does not follow the format',
    fix: 'Start with "# Site name", then an optional "> summary", then "## Section" headings with "- [Title](https://…): note" lists.',
    sources: [SRC.llmsTxt],
    run(ctx) {
      const f = ctx.site.llmsTxt;
      if (f?.body == null || (f.status ?? 200) >= 400) return { subjects: 0, issues: [] };
      const lines = f.body.replace(/^\uFEFF/, '').split(/\r?\n/);
      const issues: Issue[] = [];
      const first = lines.find((l) => l.trim() !== '');
      if (!first || !/^# \S/.test(first))
        issues.push({ url: f.url, message: 'The first line is not an H1 ("# Name").', key: 'h1' });
      if (/^<(!doctype|html)/i.test(f.body.trim()))
        issues.push({ url: f.url, message: 'Serves HTML, not Markdown.', key: 'html' });
      // Free text before the first "## " may hold any Markdown; the H2 sections are meant to be link lists.
      let inSection = false;
      lines.forEach((l, i) => {
        if (/^## /.test(l)) inSection = true;
        if (!inSection) return;
        if (/^\s*[-*]\s/.test(l) && !/^\s*[-*]\s+\[[^\]]+\]\([^)\s]+\)(\s*:.*)?\s*$/.test(l))
          issues.push({
            url: f.url,
            message: `Line ${i + 1}: item in a "##" section is not a link ("- [Title](url): note").`,
            evidence: l.trim().slice(0, 100),
            key: `l:${l.trim()}`,
            severity: 'notice',
          });
      });
      return { subjects: 1, issues };
    },
  },
  {
    id: 'llmstxt-bad-link',
    scope: 'site',
    category: 'aeo',
    severity: 'warning',
    title: 'llms.txt links to a page that is missing or hidden',
    fix: 'Link only to live, indexable pages. Update or remove the others.',
    sources: [SRC.llmsTxt],
    run(ctx) {
      const f = ctx.site.llmsTxt;
      if (f?.body == null || (f.status ?? 200) >= 400) return { subjects: 0, issues: [] };
      const links = [...f.body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => {
        try {
          return new URL(m[1]!, f.url).href;
        } catch {
          return null;
        }
      });
      const internal = links.filter((u): u is string => !!u && isInternal(ctx, u));
      const issues: Issue[] = [];
      for (const u of new Set(internal)) {
        const s = urlState(ctx, u);
        const page = ctx.index.pageByUrl.get(ctx.index.norm(u));
        if (s.state === 'missing')
          issues.push({ url: f.url, message: 'Links to a URL with no page.', evidence: u, key: u });
        else if (s.state === 'error' || s.state === 'redirect')
          issues.push({ url: f.url, message: `Links to a URL that returns HTTP ${s.status}.`, evidence: u, key: u });
        else if (page?.robots.noindex && !ctx.config.staging)
          issues.push({ url: f.url, message: 'Links to a noindex page.', evidence: u, key: u });
      }
      return { subjects: new Set(internal).size, issues };
    },
  },
];
