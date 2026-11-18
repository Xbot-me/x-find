/**
 * The GEO analysis on the details page: what engines can read about who the site is, and what to do next, in order.
 * Built from the entity facts stored with the latest run and that run's findings. It adds no checks and changes no
 * scores. Every step cites the document it comes from and is labelled like findings (required, recommended, info).
 *
 * No AI engine documents what makes it cite or recommend a site, so this describes how clearly the site states who it
 * is, not whether engines will mention it.
 */
import type { EntityFacts, OrgProp } from '../core/entity.js';
import { SRC } from '../core/sources.js';
import type { Basis, Finding } from '../core/types.js';

export type GeoStatus = 'good' | 'partial' | 'missing' | 'not-measured';

export interface GeoItem {
  id: string;
  title: string;
  status: GeoStatus;
  /** One plain sentence: where the site stands. */
  summary: string;
  /** Supporting facts, one per line. */
  details: string[];
  /** What to do, or null when nothing is needed. */
  step: string | null;
  basis: Basis;
  sources: string[];
}

export interface GeoView {
  /** False when the latest run predates entity facts: run a check to see the analysis. */
  measured: boolean;
  items: GeoItem[];
  /** The items' steps, most important first. */
  steps: { id: string; title: string; step: string; basis: Basis; sources: string[] }[];
}

const PROP_TEXT: Record<OrgProp, string> = {
  name: 'name',
  url: 'website address',
  logo: 'logo',
  description: 'description',
  sameAs: 'official profiles (sameAs)',
  alternateName: 'other names (alternateName)',
  email: 'email',
  telephone: 'phone',
  address: 'address',
  contactPoint: 'contact point',
  foundingDate: 'founding date',
  legalName: 'legal name',
};
/** The properties every organization can and should state; the rest depend on the business. */
const CORE: OrgProp[] = ['name', 'url', 'logo', 'description'];
const ASK: Partial<Record<OrgProp, string>> = {
  name: 'a name',
  url: 'the website address',
  logo: 'a logo',
  description: 'a description',
};
// sameAs is core too, but has its own item ("Your official profiles"), so it isn't asked for twice.

const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)github\.com$/, 'GitHub'],
  [/(^|\.)(x|twitter)\.com$/, 'X'],
  [/(^|\.)facebook\.com$/, 'Facebook'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)fiverr\.com$/, 'Fiverr'],
  [/(^|\.)upwork\.com$/, 'Upwork'],
  [/(^|\.)behance\.net$/, 'Behance'],
  [/(^|\.)dribbble\.com$/, 'Dribbble'],
  [/(^|\.)artstation\.com$/, 'ArtStation'],
  [/(^|\.)sketchfab\.com$/, 'Sketchfab'],
  [/(^|\.)wikidata\.org$/, 'Wikidata'],
  [/(^|\.)wikipedia\.org$/, 'Wikipedia'],
  [/(^|\.)crunchbase\.com$/, 'Crunchbase'],
  [/(^|\.)trustpilot\.com$/, 'Trustpilot'],
  [/(^|\.)google\.com$|(^|\.)g\.page$/, 'Google'],
];

export function platformOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PLATFORMS.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const squash = (s: string) => s.toLowerCase().replace(/[\s\-_.]+/g, '');
const path = (url: string, origin: string) => (url.startsWith(origin) ? url.slice(origin.length) || '/' : url);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function geoView(origin: string, entity: EntityFacts | undefined, findings: Finding[]): GeoView {
  if (!entity) return { measured: false, items: [], steps: [] };
  const items: GeoItem[] = [];
  const findingsOf = (id: string) => findings.filter((f) => f.checkId === id);

  // 1. The name engines will use.
  {
    const main = entity.website?.name ?? entity.org?.name ?? null;
    const accepted = [main, ...(entity.website?.alternateNames ?? [])].filter((x): x is string => !!x).map(squash);
    // Headings are often a slogan, so they are shown but not counted as a disagreement.
    const off = entity.names.filter(
      (n) => n.where !== 'Home page heading' && accepted.length && !accepted.some((a) => squash(n.value).includes(a)),
    );
    const spelling = findingsOf('brand-spelling');
    const details = entity.names.map((n) => `${n.where}: "${n.value}"`);
    for (const f of spelling.slice(0, 5)) details.push(`${path(f.url ?? origin, origin)}: ${f.message}`);
    if (!entity.website) {
      items.push({
        id: 'name',
        title: 'The name engines use for you',
        status: 'missing',
        summary: main
          ? `No WebSite structured data on the home page, so Google picks your site name from the title and other text.`
          : 'Nothing on the home page states your site name in structured data.',
        details,
        step: 'Add WebSite structured data to the home page with "name" and "url" (both required for it to count), and "alternateName" for any short form you use.',
        basis: 'recommended',
        sources: [SRC.siteNames],
      });
    } else if (!entity.website.name) {
      items.push({
        id: 'name',
        title: 'The name engines use for you',
        status: 'missing',
        summary: 'The home page has WebSite structured data, but without a name.',
        details,
        step: 'Give the WebSite item a "name" (and a "url"). Google requires both for site names.',
        basis: 'required',
        sources: [SRC.siteNames],
      });
    } else if (off.length || spelling.length) {
      items.push({
        id: 'name',
        title: 'The name engines use for you',
        status: 'partial',
        summary: `Your site is called "${main}", but ${off.length ? `${plural(off.length, 'place')} on the home page ${off.length === 1 ? 'uses' : 'use'} a different name` : 'the brand is spelled differently on some pages'}.`,
        details,
        step: `Use "${main}" the same way in the WebSite and Organization names, og:site_name and the home page title. List real short forms as alternateName.`,
        basis: 'recommended',
        sources: [SRC.siteNames, SRC.organization],
      });
    } else {
      items.push({
        id: 'name',
        title: 'The name engines use for you',
        status: 'good',
        summary: `Every place on the home page agrees on "${main}".`,
        details,
        step: null,
        basis: 'recommended',
        sources: [SRC.siteNames],
      });
    }
  }

  // 2. The organization profile.
  {
    const org = entity.org;
    if (!org) {
      items.push({
        id: 'org',
        title: 'Your organization profile',
        status: 'missing',
        summary: 'No page describes your organization with structured data.',
        details: [],
        step: 'Add Organization structured data (or the closest subtype, such as ProfessionalService or OnlineStore) to the home page or about page, with name, url, logo, description and sameAs.',
        basis: 'recommended',
        sources: [SRC.organization],
      });
    } else {
      const missing = (Object.keys(PROP_TEXT) as OrgProp[]).filter((p) => !org.present.includes(p));
      const missingCore = CORE.filter((p) => missing.includes(p));
      const logo = findingsOf('org-logo').filter((f) => f.severity !== 'notice');
      const unresolved = findingsOf('jsonld-id-unresolved');
      const details = [
        `Described as ${org.types.join(', ')} on ${path(org.page, origin)}`,
        `States: ${org.present.map((p) => PROP_TEXT[p]).join(', ') || 'nothing yet'}`,
      ];
      if (missing.length) details.push(`Not stated: ${missing.map((p) => PROP_TEXT[p]).join(', ')}`);
      for (const f of logo) details.push(`Logo: ${f.message}`);
      if (unresolved.length)
        details.push(`${plural(unresolved.length, 'reference')} to items that aren't defined anywhere on the site`);
      const gaps = [
        ...missingCore.map((p) => ASK[p] ?? PROP_TEXT[p]),
        ...(logo.length && !missingCore.includes('logo') ? ['a logo Google can use'] : []),
      ];
      items.push({
        id: 'org',
        title: 'Your organization profile',
        status: gaps.length ? 'partial' : 'good',
        summary: gaps.length
          ? `Your Organization data is missing ${gaps.join(', ')}.`
          : `Your Organization data states the essentials${missing.length ? '; a few optional details could be added' : ''}.`,
        details,
        step: gaps.length
          ? `Add ${gaps.join(', ')} to the Organization item${missingCore.includes('logo') || logo.length ? ' (the logo must be at least 112×112 px and crawlable)' : ''}.`
          : null,
        basis: 'recommended',
        sources: [SRC.organization],
      });
    }
  }

  // 3. Official profiles elsewhere.
  if (entity.org) {
    const links = entity.org.sameAs;
    items.push({
      id: 'profiles',
      title: 'Your official profiles',
      status: links.length ? 'good' : 'missing',
      summary: links.length
        ? `Your Organization links ${plural(links.length, 'profile')}: ${[...new Set(links.map(platformOf))].join(', ')}.`
        : 'Your Organization data links no outside profiles, so engines have nothing to connect it to.',
      details: [
        ...links.map((u) => `${platformOf(u)}: ${u}`),
        'Whether these profiles link back to your site is not checked: x-find only reads your own site.',
      ],
      step: links.length
        ? null
        : 'Add "sameAs" with the addresses of the profiles you actually run (for example LinkedIn, GitHub, or marketplace profiles).',
      basis: 'recommended',
      sources: [SRC.organization],
    });
  }

  // 4. The people behind the site.
  {
    const ppl = entity.people;
    const thin = ppl.filter((p) => !p.hasUrl && !p.hasProfiles);
    const m = entity.org?.members;
    const details = ppl.slice(0, 8).map((p) => {
      const has = [p.hasJobTitle && 'role', p.hasUrl && 'profile page', p.hasProfiles && 'outside profiles']
        .filter(Boolean)
        .join(', ');
      return `${p.name} on ${path(p.page, origin)}${has ? `: ${has}` : ': name only'}`;
    });
    if (ppl.length > 8) details.push(`and ${ppl.length - 8} more`);
    if (m && m.referenced > m.defined)
      details.push(
        `The Organization names ${plural(m.referenced, 'person', 'people')} as members; ${m.defined} of them are described on pages x-find read.`,
      );
    items.push({
      id: 'people',
      title: 'The people behind it',
      status: !ppl.length ? 'missing' : thin.length ? 'partial' : 'good',
      summary: !ppl.length
        ? 'No page describes the people behind the site with structured data.'
        : thin.length
          ? `${plural(ppl.length, 'person', 'people')} described; ${thin.length} without a profile page or outside profiles.`
          : `${plural(ppl.length, 'person', 'people')} described, each with a profile page or outside profiles.`,
      details,
      step: !ppl.length
        ? 'Show who is behind the site on a team or about page, and describe each person with Person structured data (name, jobTitle, url, sameAs). Only real people: invented profiles are treated as deception.'
        : thin.length
          ? `Give ${thin.length === 1 ? thin[0]!.name : 'these people'} a "url" (their profile page) or "sameAs" (their outside profiles).`
          : null,
      basis: 'recommended',
      sources: [SRC.helpfulContent, SRC.profilePage],
    });
  }

  // 5. Articles: who wrote them and when (only when the site has any).
  if (entity.articles.total) {
    const a = entity.articles;
    const ok = a.withAuthor === a.total && a.withAuthorLink === a.total && a.withDate === a.total;
    items.push({
      id: 'articles',
      title: 'Who wrote your articles',
      status: ok ? 'good' : a.withAuthor ? 'partial' : 'missing',
      summary: `${plural(a.total, 'article')}: ${a.withAuthor} name an author, ${a.withAuthorLink} link the author to a profile, ${a.withDate} have a publish date.`,
      details: [],
      step: ok
        ? null
        : 'In each Article, add "author" as a Person (or Organization) with "name" and "url" to their profile page, plus "datePublished" and "dateModified".',
      basis: 'recommended',
      sources: [SRC.article, SRC.helpfulContent],
    });
  }

  // 6. About and contact pages.
  {
    const { aboutPage: about, contactPage: contact } = entity;
    items.push({
      id: 'about',
      title: 'About and contact pages',
      status: about && contact ? 'good' : about || contact ? 'partial' : 'missing',
      summary:
        about && contact
          ? 'Visitors and crawlers can find an about page and a contact page.'
          : `No ${[!about && 'about', !contact && 'contact'].filter(Boolean).join(' or ')} page found from the home page.`,
      details: [about && `About: ${path(about, origin)}`, contact && `Contact: ${path(contact, origin)}`].filter(
        (x): x is string => !!x,
      ),
      step:
        about && contact
          ? null
          : `Link ${[!about && 'an about page (who you are, what you do, since when)', !contact && 'a contact page'].filter(Boolean).join(' and ')} from the home page.`,
      basis: 'recommended',
      sources: [SRC.helpfulContent],
    });
  }

  // 7. What you offer: schema.org only, so information.
  if (entity.services)
    items.push({
      id: 'services',
      title: 'What you offer',
      status: 'good',
      summary: `${plural(entity.services, 'service')} described with structured data.`,
      details: [],
      step: null,
      basis: 'info',
      sources: ['https://schema.org/Service'],
    });

  // 8. What x-find can't see.
  items.push({
    id: 'elsewhere',
    title: 'What the rest of the web says',
    status: 'not-measured',
    summary:
      'Not measured. Mentions on other sites, reviews, Wikipedia or Wikidata entries, and whether AI answers mention you all shape how engines see you, and x-find does not read them.',
    details: [],
    step: null,
    basis: 'info',
    sources: [SRC.siteNames],
  });

  // Most important first: naming and the organization are what everything else hangs on; required before recommended.
  const order = ['name', 'org', 'profiles', 'people', 'about', 'articles'];
  const steps = items
    .filter((i) => i.step && i.status !== 'good')
    .sort(
      (a, b) =>
        (a.basis === 'required' ? 0 : 1) - (b.basis === 'required' ? 0 : 1) ||
        order.indexOf(a.id) - order.indexOf(b.id),
    )
    .map((i) => ({ id: i.id, title: i.title, step: i.step!, basis: i.basis, sources: i.sources }));
  return { measured: true, items, steps };
}
