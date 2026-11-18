import type { PageModel } from './types.js';

export interface LdNode {
  types: string[];
  node: Record<string, unknown>;
  /** true for items at the top level of a block or of its @graph. */
  top: boolean;
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : t === undefined ? [] : [t];
  // Accept full IRIs like https://schema.org/Organization.
  return list.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^https?:\/\/schema\.org\//, ''));
}

/** Every object with an @type, including nested ones, from all valid JSON-LD blocks on a page. */
export function ldNodes(page: PageModel): LdNode[] {
  const out: LdNode[] = [];
  const visit = (value: unknown, top: boolean) => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v, top);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if ('@graph' in node) visit(node['@graph'], true);
    const types = typesOf(node);
    if (types.length) out.push({ types, node, top });
    for (const [k, v] of Object.entries(node)) {
      if (k === '@graph' || k === '@context') continue;
      if (v && typeof v === 'object') visit(v, false);
    }
  };
  for (const block of page.jsonld) if (block.value !== undefined) visit(block.value, true);
  return out;
}

export function hasType(n: LdNode, ...names: string[]): boolean {
  return n.types.some((t) => names.includes(t));
}

/** Organization and its common subtypes (schema.org). */
export const ORG_TYPES = [
  'Organization',
  'Corporation',
  'LocalBusiness',
  'ProfessionalService',
  'OnlineStore',
  'OnlineBusiness',
  'NGO',
  'NewsMediaOrganization',
  'EducationalOrganization',
  'GovernmentOrganization',
  'MedicalOrganization',
  'SportsOrganization',
  'Store',
];

export const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'Report', 'ScholarlyArticle'];

export function stringOrUrl(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['url'] === 'string') return o['url'];
    if (typeof o['contentUrl'] === 'string') return o['contentUrl'];
    if (typeof o['@id'] === 'string') return o['@id'];
  }
  return null;
}
