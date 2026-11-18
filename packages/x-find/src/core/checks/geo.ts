import { hasType, ldNodes, ORG_TYPES, stringOrUrl } from '../jsonld.js';
import { imageSize } from '../imagesize.js';
import { SRC } from '../sources.js';
import type { CheckContext, Issue, PageModel, SiteCheck } from '../types.js';

export function homePage(ctx: CheckContext): PageModel | undefined {
  return ctx.index.pageByUrl.get(ctx.index.norm(`${ctx.site.origin}/`));
}

export function orgNodes(page: PageModel) {
  return ldNodes(page).filter((n) => hasType(n, ...ORG_TYPES));
}

/** Logo URLs declared by Organization items on any page, resolved. Used by the loaders to fetch the files. */
export function declaredLogoUrls(pages: PageModel[]): string[] {
  const out = new Set<string>();
  for (const p of pages) {
    for (const n of orgNodes(p)) {
      const logo = stringOrUrl(n.node['logo']);
      if (!logo) continue;
      try {
        out.add(new URL(logo, p.url).href);
      } catch {
        /* ignore */
      }
    }
  }
  return [...out];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A regex that finds spellings of the brand that differ only in case, spacing, hyphens or a trailing plural "s",
 * e.g. "BrightLeaf Studio" also matches "Brightleaf Studios" and "Bright Leaf studio".
 */
export function brandPattern(name: string): RegExp {
  const words = name.trim().split(/\s+/);
  const parts = words.map((w) =>
    w
      // allow a space or hyphen at inner camel-case boundaries: BrightLeaf → Bright[\s-]?Leaf
      .split(/(?<=[a-z])(?=[A-Z])/)
      .map(escapeRe)
      .join('[\\s-]?'),
  );
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\s-]*')}s?(?![\\p{L}\\p{N}])`, 'giu');
}

export const geoSiteChecks: SiteCheck[] = [
  {
    id: 'org-missing',
    scope: 'site',
    category: 'geo',
    severity: 'warning',
    title: 'No Organization structured data on the home page',
    fix: 'Add Organization (or a subtype such as ProfessionalService) JSON-LD on the home page with name, url, logo and sameAs links to your official profiles.',
    sources: [SRC.organization],
    run(ctx) {
      const home = homePage(ctx);
      if (!home) return { subjects: 0, issues: [] };
      return {
        subjects: 1,
        issues: orgNodes(home).length ? [] : [{ url: home.url, message: 'No Organization item on the home page.' }],
      };
    },
  },
  {
    id: 'org-logo',
    scope: 'site',
    category: 'geo',
    severity: 'warning',
    title: 'Organization logo missing or too small',
    fix: 'Set Organization.logo to a crawlable image of at least 112×112 px (a square PNG, or SVG) that reads on a white background.',
    sources: [SRC.organization],
    run(ctx) {
      const home = homePage(ctx);
      const org = home ? orgNodes(home)[0] : undefined;
      if (!home || !org) return { subjects: 0, issues: [] };
      const raw = stringOrUrl(org.node['logo']);
      if (!raw) return { subjects: 1, issues: [{ url: home.url, message: 'Organization has no logo.' }] };
      let url: string;
      try {
        url = new URL(raw, home.url).href;
      } catch {
        return { subjects: 1, issues: [{ url: home.url, message: 'Logo URL is invalid.', evidence: raw }] };
      }
      const res = ctx.site.resources.get(ctx.index.norm(url));
      if (!res)
        return {
          subjects: 1,
          issues: [{ url: home.url, message: 'Logo was not checked (not loaded).', evidence: url, severity: 'notice' }],
        };
      if (!res.exists)
        return { subjects: 1, issues: [{ url: home.url, message: 'Logo file not found.', evidence: url }] };
      const size = res.data ? imageSize(res.data) : null;
      if (!size)
        return {
          subjects: 1,
          issues: [{ url: home.url, message: 'Logo format not recognised.', evidence: url, severity: 'notice' }],
        };
      if (size.width < 112 || size.height < 112)
        return {
          subjects: 1,
          issues: [
            { url: home.url, message: `Logo is ${size.width}×${size.height} px (minimum 112×112).`, evidence: url },
          ],
        };
      return { subjects: 1, issues: [] };
    },
  },
  {
    id: 'org-sameas',
    scope: 'site',
    category: 'geo',
    severity: 'notice',
    title: 'Organization lists no profiles (sameAs)',
    fix: 'Add sameAs with the URLs of your official profiles (LinkedIn, GitHub, marketplace profiles, Wikipedia/Wikidata if any), so engines can connect them to you.',
    sources: [SRC.organization],
    run(ctx) {
      const home = homePage(ctx);
      const org = home ? orgNodes(home)[0] : undefined;
      if (!home || !org) return { subjects: 0, issues: [] };
      const sameAs = org.node['sameAs'];
      const n = Array.isArray(sameAs) ? sameAs.length : typeof sameAs === 'string' ? 1 : 0;
      return { subjects: 1, issues: n ? [] : [{ url: home.url, message: 'No sameAs links.' }] };
    },
  },
  {
    id: 'site-name',
    scope: 'site',
    category: 'geo',
    severity: 'notice',
    title: 'No WebSite name for Google site names',
    fix: 'Add WebSite structured data with "name" (and "alternateName" if you use a short form) on the home page.',
    sources: [SRC.siteNames],
    run(ctx) {
      const home = homePage(ctx);
      if (!home) return { subjects: 0, issues: [] };
      const ok = ldNodes(home).some((n) => hasType(n, 'WebSite') && typeof n.node['name'] === 'string');
      return { subjects: 1, issues: ok ? [] : [{ url: home.url, message: 'No WebSite item with a name.' }] };
    },
  },
  {
    id: 'favicon-missing',
    scope: 'site',
    category: 'seo',
    severity: 'notice',
    title: 'No favicon declared',
    fix: 'Add <link rel="icon" href="/favicon.png"> (a square image, at least 48×48 px) on the home page.',
    sources: [SRC.favicon],
    run(ctx) {
      const home = homePage(ctx);
      if (!home) return { subjects: 0, issues: [] };
      const ok = home.links.some(
        (l) => l.inHead && (l.rel.includes('icon') || l.rel.includes('apple-touch-icon')) && l.href,
      );
      return { subjects: 1, issues: ok ? [] : [{ url: home.url, message: 'No <link rel="icon">.' }] };
    },
  },
  {
    id: 'jsonld-id-unresolved',
    scope: 'site',
    category: 'geo',
    severity: 'warning',
    title: 'Structured data refers to an @id that is not defined',
    fix: 'Define the item with that @id somewhere on the site (usually the Organization or Person on the home or team page), or fix the reference.',
    sources: [SRC.sdPolicies],
    run(ctx) {
      const defined = new Set<string>();
      const refs: { page: PageModel; id: string }[] = [];
      const abs = (id: string, base: string) => {
        try {
          return new URL(id, base).href;
        } catch {
          return id;
        }
      };
      const visit = (v: unknown, page: PageModel) => {
        if (Array.isArray(v)) return v.forEach((x) => visit(x, page));
        if (!v || typeof v !== 'object') return;
        const o = v as Record<string, unknown>;
        const id = typeof o['@id'] === 'string' ? abs(o['@id'], page.url) : null;
        const keys = Object.keys(o).filter((k) => k !== '@id');
        if (id) {
          if (keys.length === 0) refs.push({ page, id });
          else defined.add(id);
        }
        for (const [k, x] of Object.entries(o)) if (k !== '@context') visit(x, page);
      };
      for (const p of ctx.site.pages) for (const b of p.jsonld) if (b.value !== undefined) visit(b.value, p);
      const internal = refs.filter((r) => r.id.startsWith(ctx.site.origin));
      const issues: Issue[] = [];
      const seen = new Set<string>();
      for (const r of internal) {
        if (defined.has(r.id) || seen.has(`${r.page.url}|${r.id}`)) continue;
        seen.add(`${r.page.url}|${r.id}`);
        issues.push({ url: r.page.url, message: 'Reference to an undefined @id.', evidence: r.id, key: r.id });
      }
      return { subjects: internal.length, issues };
    },
  },
  {
    id: 'brand-spelling',
    scope: 'site',
    category: 'geo',
    severity: 'warning',
    title: 'Brand name spelled differently',
    fix: 'Use one spelling of the brand everywhere: page text, titles, descriptions, structured data and outside profiles. Engines match entities by name.',
    sources: [SRC.organization],
    run(ctx) {
      const name = ctx.config.brand.name;
      if (!name) return { subjects: 0, issues: [] };
      const allowed = new Set([name, ...ctx.config.brand.variants]);
      const re = brandPattern(name);
      const issues: Issue[] = [];
      for (const page of ctx.site.pages) {
        const sources: [string, string][] = [
          ['text', page.text],
          ['title', page.titles.map((t) => t.text).join(' ')],
          ['meta', page.metas.map((m) => m.content ?? '').join(' ')],
          ['structured data', page.jsonld.map((b) => b.raw).join(' ')],
        ];
        const found = new Map<string, string>();
        for (const [where, text] of sources) {
          for (const m of text.matchAll(re)) {
            const spelled = m[0].replace(/\s+/g, ' ');
            if (!allowed.has(spelled) && !found.has(spelled)) found.set(spelled, where);
          }
        }
        for (const [spelled, where] of found)
          issues.push({ url: page.url, message: `"${spelled}" in ${where} (brand: "${name}").`, key: spelled });
      }
      return { subjects: ctx.site.pages.length, issues };
    },
  },
];
