/**
 * What each built-in check's finding means, kept apart from severity (which drives the score):
 *
 * - basis
 *   - required: the cited source says the thing is invalid, ignored, over a limit, broken, or makes the page
 *     ineligible. Fixing it is not a matter of taste.
 *   - recommended: the source recommends it; nothing breaks if you don't.
 *   - info: a policy choice or plain information. Nothing to fix unless it isn't what you meant.
 *   When a source doesn't clearly state a requirement, the check is "recommended": never overstate.
 * - confidence
 *   - certain: read directly from the files or the server's responses.
 *   - likely: an estimate (word counts, near-duplicate text, spelling variants, truncation), so it can be wrong.
 * - version: bump when a check's logic changes, so two reports can be told apart (see rulesId in run.ts).
 *
 * test/labels.test.ts fails when a built-in check is missing here, so every new check must be classified.
 */
import type { Basis, Confidence } from '../types.js';

type Label = { basis: Basis; confidence: Confidence; version: number };
const R = (confidence: Confidence = 'certain'): Label => ({ basis: 'required', confidence, version: 1 });
const A = (confidence: Confidence = 'certain'): Label => ({ basis: 'recommended', confidence, version: 1 });
const I = (confidence: Confidence = 'certain'): Label => ({ basis: 'info', confidence, version: 1 });

export const CHECK_LABELS: Record<string, Label> = {
  // Page basics
  'title-missing': A(),
  'title-multiple': A(),
  'title-length': I('likely'),
  'description-missing': A(),
  'description-multiple': A(),
  'description-length': I('likely'),
  'canonical-missing': A(),
  'canonical-multiple': R(),
  'canonical-relative': A(),
  'canonical-not-in-head': R(),
  'canonical-fragment': R(),
  'canonical-http-on-https': A(),
  'robots-meta-noindex': I(),
  'robots-meta-invalid': A(),
  'meta-in-body': R(),
  'viewport-missing': A(),
  'h1-missing': A(),
  'link-not-crawlable': R(),
  'link-empty-text': A(),
  'link-generic-text': A('likely'),
  'link-internal-http': A(),
  'link-localhost': R(),
  'img-alt-missing': A(),
  'img-dimensions-missing': A(),
  'html-lang-missing': A(),
  'content-thin': A('likely'),
  'url-structure': A(),
  'charset-missing': A(),
  'og-missing': A(),
  'hreflang-invalid': R(),
  // Across the site
  'title-duplicate': A(),
  'description-duplicate': A(),
  'canonical-target-bad': R(),
  'link-broken-internal': R(),
  'page-orphan': A(),
  'content-duplicate': A(),
  'content-near-duplicate': A('likely'),
  'hreflang-not-reciprocal': R(),
  'robots-noindex-blocked': R(),
  // robots.txt and sitemaps
  'robotstxt-missing': I(),
  'robotstxt-too-large': R(),
  'robotstxt-invalid-line': R(),
  'robotstxt-unsupported-field': I(),
  'robotstxt-sitemap-relative': R(),
  'robotstxt-status': R(),
  'sitemap-missing': A(),
  'sitemap-invalid': R(),
  'sitemap-too-large': R(),
  'sitemap-url-relative': R(),
  'sitemap-url-other-host': R(),
  'sitemap-noindex': A(),
  'sitemap-non-canonical': A(),
  'sitemap-blocked': A(),
  'sitemap-missing-page': A(),
  'sitemap-url-not-found': A(),
  'sitemap-lastmod-invalid': R(),
  // Structured data
  'jsonld-invalid': R(),
  'jsonld-missing-type': R(),
  'jsonld-review-markup': I(),
  'jsonld-faq-no-rich-result': I(),
  'article-meta': A(),
  // Live server
  'http-status': R(),
  'redirect-chain': A(),
  'canonical-header-mismatch': A(),
  'soft-404': R(),
  'host-redirect': A(),
  'trailing-slash-duplicate': A(),
  // Answer engines
  'snippet-restricted': R(),
  'content-needs-js': A('likely'),
  'ai-optout-directives': I(),
  'ai-search-bot-blocked': R(),
  'ai-training-bot-policy': I(),
  'robotstxt-content-signal': A(),
  // Tested with the crawler's user-agent from this machine; a firewall that checks IPs may answer the real one differently.
  'crawler-ua-blocked': R('likely'),
  'llmstxt-missing': I(),
  'llmstxt-invalid': A(),
  'llmstxt-bad-link': A(),
  // Entity (who you are)
  'org-missing': A(),
  'org-logo': A(),
  'org-sameas': A(),
  'site-name': A(),
  'favicon-missing': A(),
  'jsonld-id-unresolved': A(),
  'brand-spelling': A('likely'),
};

/** Custom rules from a config file carry their own labels, or these. */
export const DEFAULT_LABEL: Label = { basis: 'recommended', confidence: 'certain', version: 1 };

export const BASIS_TEXT: Record<Basis, string> = {
  required: 'Required',
  recommended: 'Recommended',
  info: 'For your information',
};
