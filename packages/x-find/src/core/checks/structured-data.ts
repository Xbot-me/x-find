import { ARTICLE_TYPES, hasType, ldNodes } from '../jsonld.js';
import { SRC } from '../sources.js';
import type { Issue, PageCheck } from '../types.js';

export const structuredDataChecks: PageCheck[] = [
  {
    id: 'jsonld-invalid',
    scope: 'page',
    category: 'seo',
    severity: 'error',
    title: 'Structured data does not parse',
    fix: 'Fix the JSON syntax in the <script type="application/ld+json"> block (trailing commas and unescaped quotes are the usual cause).',
    sources: [SRC.sdPolicies],
    run(page) {
      return page.jsonld
        .filter((b) => b.error)
        .map((b, i) => ({
          message: `JSON-LD block is not valid JSON: ${b.error}`,
          evidence: b.raw.trim().slice(0, 120),
          key: String(i),
        }));
    },
  },
  {
    id: 'jsonld-missing-type',
    scope: 'page',
    category: 'seo',
    severity: 'error',
    title: 'Structured data without @context or @type',
    fix: 'Give each top-level item "@context": "https://schema.org" and an "@type".',
    sources: [SRC.sdPolicies],
    run(page) {
      const issues: Issue[] = [];
      page.jsonld.forEach((b, i) => {
        if (b.value === undefined) return;
        const items = Array.isArray(b.value) ? b.value : [b.value];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const o = item as Record<string, unknown>;
          if (!('@context' in o)) issues.push({ message: 'Top-level JSON-LD item has no @context.', key: `ctx${i}` });
          if (!('@type' in o) && !('@graph' in o))
            issues.push({ message: 'Top-level JSON-LD item has no @type.', key: `type${i}` });
        }
      });
      return issues;
    },
  },
  {
    id: 'jsonld-review-markup',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'Review or rating markup',
    fix: 'Keep Review/AggregateRating only if the reviews come from real customers and are shown on this page. Fake or self-serving ratings can lead to a manual action.',
    sources: [SRC.sdPolicies],
    run(page) {
      const nodes = ldNodes(page).filter((n) => hasType(n, 'Review', 'AggregateRating'));
      const nested = ldNodes(page).filter((n) => 'aggregateRating' in n.node || 'review' in n.node);
      return nodes.length || nested.length
        ? [{ message: `Page marks up ${nodes.length + nested.length} review/rating item(s).` }]
        : [];
    },
  },
  {
    id: 'jsonld-faq-no-rich-result',
    scope: 'page',
    category: 'seo',
    severity: 'notice',
    title: 'FAQPage markup no longer shows in Google',
    fix: 'Nothing to fix. Google ended FAQ rich results on 2026-05-07; keep the markup only if you want it for other consumers.',
    sources: [SRC.faqEnded],
    run(page) {
      return ldNodes(page).some((n) => hasType(n, 'FAQPage')) ? [{ message: 'FAQPage structured data present.' }] : [];
    },
  },
  {
    id: 'article-meta',
    scope: 'page',
    category: 'geo',
    severity: 'notice',
    title: 'Article without author or date',
    fix: 'Add author (a Person or Organization) and datePublished (and dateModified when updated) to Article markup.',
    sources: [SRC.sdPolicies],
    run(page) {
      return ldNodes(page)
        .filter((n) => hasType(n, ...ARTICLE_TYPES))
        .flatMap((n, i) => {
          const missing = ['author', 'datePublished'].filter((k) => !(k in n.node));
          return missing.length ? [{ message: `${n.types[0]} has no ${missing.join(' or ')}.`, key: String(i) }] : [];
        });
    },
  },
];
