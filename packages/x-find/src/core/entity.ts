/**
 * What a site says about who it is: the facts behind the GEO analysis on the details page. Read from the crawled pages
 * only (structured data, meta tags, titles, links). Nothing outside the site is fetched, so whether profiles link
 * back, or what other sites say about the brand, is not known here.
 *
 * Kept compact so it can be stored with each run, like pageFacts.
 */
import { ARTICLE_TYPES, hasType, ldNodes, ORG_TYPES, stringOrUrl } from './jsonld.js';
import type { LdNode } from './jsonld.js';
import type { PageModel, ResolvedConfig, SiteModel } from './types.js';

/** Organization properties Google's Organization structured data guide recommends (and that most sites can set). */
export const ORG_PROPS = [
  'name',
  'url',
  'logo',
  'description',
  'sameAs',
  'alternateName',
  'email',
  'telephone',
  'address',
  'contactPoint',
  'foundingDate',
  'legalName',
] as const;
export type OrgProp = (typeof ORG_PROPS)[number];

export interface NameSource {
  /** e.g. "WebSite name", "og:site_name", "Home page title". */
  where: string;
  value: string;
}

export interface EntityFacts {
  /** The Organization the home page (or failing that, any page) describes. */
  org: {
    page: string;
    types: string[];
    name: string | null;
    present: OrgProp[];
    sameAs: string[];
    /** Team members referenced by @id: how many, and how many are defined on a crawled page. */
    members: { referenced: number; defined: number };
  } | null;
  /** WebSite structured data on the home page. */
  website: { name: string | null; alternateNames: string[]; url: string | null } | null;
  /** Every place the home page names the site, for checking they agree. */
  names: NameSource[];
  /** People described with structured data, one per @id or name. */
  people: { name: string; page: string; hasJobTitle: boolean; hasProfiles: boolean; hasUrl: boolean }[];
  /** Service items described with structured data. */
  services: number;
  articles: { total: number; withAuthor: number; withAuthorLink: number; withDate: number };
  aboutPage: string | null;
  contactPage: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => stringOrUrl(x)).filter((x): x is string => !!x);
const has = (v: unknown) =>
  v !== undefined &&
  v !== null &&
  v !== '' &&
  !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

const ABOUT = /^\/(about|about-us|chi-siamo|uber-uns|ueber-uns|a-propos|quienes-somos|team|company)\/?$/i;
const CONTACT = /^\/(contact|contact-us|contatti|kontakt|contacto|contactez-nous)\/?$/i;

function pagePath(url: string, origin: string) {
  return url.startsWith(origin) ? url.slice(origin.length).split(/[?#]/)[0] || '/' : url;
}

export function entityFacts(site: SiteModel, _config?: ResolvedConfig): EntityFacts {
  const origin = site.origin;
  const homeUrl = `${origin}/`;
  const home = site.pages.find((p) => p.url === homeUrl) ?? null;

  // Every node on the site that has an @id and content, so references (member, author, @graph links) resolve even
  // when the item is defined on another page.
  const byId = new Map<string, { node: LdNode; page: PageModel }>();
  const all: { node: LdNode; page: PageModel }[] = [];
  for (const page of site.pages) {
    for (const node of ldNodes(page)) {
      all.push({ node, page });
      const id = str(node.node['@id']);
      if (id) {
        try {
          byId.set(new URL(id, page.url).href, { node, page });
        } catch {
          byId.set(id, { node, page });
        }
      }
    }
  }
  const resolve = (v: unknown, base: string): Record<string, unknown> | null => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const id = str(o['@id']);
    if (id && Object.keys(o).length === 1) {
      let key = id;
      try {
        key = new URL(id, base).href;
      } catch {
        /* keep as is */
      }
      return byId.get(key)?.node.node ?? null;
    }
    return o;
  };

  // Organization: the home page's first, else the first anywhere (some sites put it on the about page).
  const orgs = all.filter((x) => hasType(x.node, ...ORG_TYPES));
  const orgHit = orgs.find((x) => x.page.url === homeUrl) ?? orgs[0];
  let org: EntityFacts['org'] = null;
  if (orgHit) {
    const n = orgHit.node.node;
    const members = list(n['member']).concat(list(n['employee']), list(n['founder']));
    const memberNodes = [n['member'], n['employee'], n['founder']]
      .flatMap((v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]))
      .map((v) => resolve(v, orgHit.page.url));
    org = {
      page: orgHit.page.url,
      types: orgHit.node.types,
      name: str(n['name']),
      present: ORG_PROPS.filter((p) => has(n[p])),
      sameAs: list(n['sameAs']),
      members: {
        referenced: members.length,
        defined: memberNodes.filter((m) => m && Object.keys(m).length > 1).length,
      },
    };
  }

  // WebSite on the home page, and every name the home page gives the site.
  const names: NameSource[] = [];
  let website: EntityFacts['website'] = null;
  if (home) {
    const ws = ldNodes(home).find((x) => hasType(x, 'WebSite'));
    if (ws) {
      website = {
        name: str(ws.node['name']),
        alternateNames: list(ws.node['alternateName']),
        url: stringOrUrl(ws.node['url']),
      };
      if (website.name) names.push({ where: 'WebSite name', value: website.name });
      for (const a of website.alternateNames) names.push({ where: 'WebSite alternateName', value: a });
    }
    if (orgHit?.page.url === homeUrl && org?.name) names.push({ where: 'Organization name', value: org.name });
    const og = home.metas.find((m) => m.property === 'og:site_name' && str(m.content));
    if (og) names.push({ where: 'og:site_name', value: og.content!.trim() });
    const title = home.titles[0]?.text.trim();
    if (title) names.push({ where: 'Home page title', value: title });
    const h1 = home.headings.find((h) => h.level === 1)?.text.trim();
    if (h1) names.push({ where: 'Home page heading', value: h1 });
  }

  // People, once each.
  const people = new Map<string, EntityFacts['people'][number]>();
  for (const { node, page } of all) {
    if (!hasType(node, 'Person')) continue;
    const name = str(node.node['name']);
    if (!name) continue;
    const key = str(node.node['@id']) ?? name.toLowerCase();
    const prev = people.get(key);
    const item = {
      name,
      page: page.url,
      hasJobTitle: has(node.node['jobTitle']),
      hasProfiles: list(node.node['sameAs']).length > 0,
      hasUrl: !!stringOrUrl(node.node['url']),
    };
    // Prefer the fullest description of the same person.
    const score = (p: typeof item) => +p.hasJobTitle + +p.hasProfiles + +p.hasUrl;
    if (!prev || score(item) > score(prev)) people.set(key, item);
  }

  const serviceIds = new Set<string>();
  for (const { node, page } of all) {
    if (!hasType(node, 'Service') || Object.keys(node.node).length <= 2) continue;
    serviceIds.add(str(node.node['@id']) ?? `${page.url}|${str(node.node['name']) ?? serviceIds.size}`);
  }

  const articles = { total: 0, withAuthor: 0, withAuthorLink: 0, withDate: 0 };
  for (const { node, page } of all) {
    if (!node.top || !hasType(node, ...ARTICLE_TYPES)) continue;
    articles.total++;
    const authors = (Array.isArray(node.node['author']) ? node.node['author'] : [node.node['author']])
      .map((a) => (typeof a === 'string' ? { name: a } : resolve(a, page.url)))
      .filter((a): a is Record<string, unknown> => !!a && !!str(a['name']));
    if (authors.length) articles.withAuthor++;
    if (authors.some((a) => stringOrUrl(a['url']) || list(a['sameAs']).length)) articles.withAuthorLink++;
    if (str(node.node['datePublished'])) articles.withDate++;
  }

  const findPage = (re: RegExp, words: RegExp) => {
    const byPath = site.pages.find((p) => re.test(pagePath(p.url, origin)));
    if (byPath) return byPath.url;
    const link = home?.anchors.find((a) => a.url?.startsWith(origin) && words.test(a.text.trim()));
    return link?.url ?? null;
  };

  return {
    org,
    website,
    names,
    people: [...people.values()].slice(0, 30),
    services: serviceIds.size,
    articles,
    aboutPage: findPage(ABOUT, /^(about|about us|chi siamo|über uns|a propos|à propos|our team|team)$/i),
    contactPage: findPage(CONTACT, /^(contact|contact us|contatti|kontakt|contacto|get in touch)$/i),
  };
}
