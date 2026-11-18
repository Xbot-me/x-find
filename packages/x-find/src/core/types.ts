/**
 * Shared types. Everything in src/core is runtime-neutral: no Node APIs, so the same code runs in Node, CI and a
 * Cloudflare Worker (test/core-neutral.test.ts enforces this).
 */

export type Severity = 'error' | 'warning' | 'notice';
export type Category = 'seo' | 'aeo' | 'geo';
export type Mode = 'folder' | 'live';
/** What a finding means, apart from how much it costs: see src/core/checks/labels.ts. */
export type Basis = 'required' | 'recommended' | 'info';
/** certain: read directly from files or responses. likely: an estimate that can be wrong. */
export type Confidence = 'certain' | 'likely';

/** HTTP facts for one URL. Only present in live mode. */
export interface HttpInfo {
  status: number;
  /** Lower-cased header names. Repeated headers are joined with ", ". */
  headers: Record<string, string>;
  /** Each hop before the final URL: the URL requested and the status it answered with. */
  redirects: { url: string; status: number }[];
  finalUrl: string;
}

export interface JsonLdBlock {
  raw: string;
  /** Parsed value; undefined when `error` is set. */
  value?: unknown;
  error?: string;
}

export interface Anchor {
  /** The raw href attribute; null when the element has no href. */
  href: string | null;
  /** Absolute URL without fragment, or null when the href can't be resolved or isn't http(s). */
  url: string | null;
  text: string;
  /** Alt text of images inside the link (used as anchor text by Google). */
  imageAlt: string;
  /** aria-label or title: used as a fallback name when the link has no text. */
  label: string;
  rel: string[];
}

export interface ImageRef {
  src: string | null;
  url: string | null;
  /** null when the attribute is absent; '' is a valid decorative alt. */
  alt: string | null;
  width: string | null;
  height: string | null;
}

export interface MetaTag {
  name: string | null;
  property: string | null;
  httpEquiv: string | null;
  charset: string | null;
  content: string | null;
  inHead: boolean;
}

export interface LinkTag {
  rel: string[];
  href: string | null;
  hreflang: string | null;
  inHead: boolean;
}

export interface PageModel {
  /** Final absolute URL of the page (after redirects in live mode). */
  url: string;
  /** Where the page came from: a file path (folder mode) or the requested URL (live mode). */
  source: string;
  http?: HttpInfo;
  bytes: number;
  titles: { text: string; inHead: boolean }[];
  metas: MetaTag[];
  links: LinkTag[];
  lang: string | null;
  /** A `<meta charset>` or http-equiv content-type declaring a charset within the first 1024 bytes. */
  charsetEarly: boolean;
  headings: { level: number; text: string }[];
  anchors: Anchor[];
  images: ImageRef[];
  jsonld: JsonLdBlock[];
  /** Visible text of `<body>` (no script, style, template, noscript), whitespace-collapsed. */
  text: string;
  wordCount: number;
  /** Total bytes of inline and the count of external `<script>` elements. */
  inlineScriptBytes: number;
  externalScripts: number;
  /** Robots directives that apply to all crawlers or Googlebot, from meta tags and X-Robots-Tag, lower-cased. */
  robots: RobotsDirectives;
}

export interface RobotsDirectives {
  /** Every directive token seen, with where it came from. */
  all: { value: string; agent: string; from: 'meta' | 'header' }[];
  noindex: boolean;
  nofollow: boolean;
  nosnippet: boolean;
  maxSnippet: number | null;
}

export interface TextFile {
  url: string;
  /** Present in live mode. */
  status?: number;
  body: string | null;
  bytes: number;
}

export interface CrawlerAccess {
  crawlerId: string;
  userAgent: string;
  url: string;
  status: number | null;
  /** The response looked like a bot challenge (Cloudflare "Just a moment...", etc.). */
  challenge: boolean;
  error?: string;
}

export interface LiveFacts {
  /** A made-up URL and the status it returned. */
  soft404?: { url: string; status: number };
  /** Redirect behaviour of http:// and the www / non-www twin. */
  hostVariants: { url: string; status: number | null; location: string | null }[];
  trailingSlash?: { url: string; twin: string; status: number; twinStatus: number };
  crawlerAccess: CrawlerAccess[];
}

export interface ResourceInfo {
  url: string;
  exists: boolean;
  status?: number;
  /** Bytes of the resource when it was read (logos). */
  data?: Uint8Array;
}

export interface SiteModel {
  mode: Mode;
  /** e.g. https://example.com (no trailing slash). */
  origin: string;
  pages: PageModel[];
  robotsTxt: TextFile | null;
  llmsTxt: TextFile | null;
  sitemaps: TextFile[];
  /**
   * Answers whether an internal URL exists. Folder mode: a file maps to it. Live mode: it was fetched and returned
   * 2xx. Returns undefined when unknown (not checked).
   */
  resources: Map<string, ResourceInfo>;
  live?: LiveFacts;
  /** HTML pages that failed or redirected in live mode, keyed by requested URL. */
  failedPages: Map<string, HttpInfo>;
}

export interface Issue {
  url?: string;
  message: string;
  evidence?: string;
  /** Only to lower the default severity for a softer variant of the same rule. */
  severity?: Severity;
  /** Only for a softer variant of the same rule (e.g. max-snippet:N is information, nosnippet is required). */
  basis?: Basis;
  /** Distinguishes several issues of the same check on the same URL (e.g. the image src). */
  key?: string;
}

export interface Finding extends Required<Pick<Issue, 'message'>> {
  checkId: string;
  title: string;
  category: Category;
  severity: Severity;
  url?: string;
  evidence?: string;
  fix: string;
  sources: string[];
  fingerprint: string;
  /** Absent in reports saved before x-find 0.2: read them with findingLabel(). */
  basis?: Basis;
  confidence?: Confidence;
}

export interface CheckResult {
  /** Number of things examined (pages, URLs, or 1 for a site-wide fact). 0 = not applicable. */
  subjects: number;
  issues: Issue[];
}

interface CheckMeta {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  /** What to do about it, written for a site owner. */
  fix: string;
  /** Source document URLs. */
  sources: string[];
  /** Needs HTTP facts: reported as "not measured" in folder mode. */
  live?: boolean;
  /** Built-in checks get these from checks/labels.ts; custom rules may set them (default: recommended, certain, 1). */
  basis?: Basis;
  confidence?: Confidence;
  /** Bump when the check's logic changes. */
  version?: number;
}

export interface PageCheck extends CheckMeta {
  scope: 'page';
  /** Return false to skip a page (not counted). Default: indexable pages only when `indexableOnly` is true. */
  indexableOnly?: boolean;
  run(page: PageModel, ctx: CheckContext): Issue[];
}

export interface SiteCheck extends CheckMeta {
  scope: 'site';
  run(ctx: CheckContext): CheckResult;
}

export type Check = PageCheck | SiteCheck;

export interface Thresholds {
  titleMaxChars: number;
  descriptionMaxChars: number;
  thinContentWords: number;
  /** Shingle overlap (0–1) above which two pages are reported as near-duplicates. */
  similarity: number;
}

export interface ResolvedConfig {
  site: string;
  trailingSlash: 'always' | 'never' | 'ignore';
  cleanUrls: boolean;
  brand: { name: string | null; variants: string[] };
  thresholds: Thresholds;
  severity: Record<string, Severity | 'off'>;
  ignore: string[];
  genericLinkText: string[];
  staging: boolean;
  rules: Check[];
}

export interface CheckContext {
  site: SiteModel;
  config: ResolvedConfig;
  /** Facts computed once and shared by checks. */
  index: SiteIndex;
}

/** Non-2xx status, a noindex directive, blocked for Googlebot in robots.txt, or a canonical to another URL. */
export type NotIndexableReason = 'status' | 'noindex' | 'robots' | 'canonical';

export interface SiteIndex {
  pageByUrl: Map<string, PageModel>;
  /** Pages that are meant to be in search: not noindex, canonical to themselves (or none), not ignored. */
  indexable: PageModel[];
  isIndexable(page: PageModel): boolean;
  /** Why a page is kept out of search on purpose (or by mistake), or null when it is meant to be indexed. */
  notIndexableReason(page: PageModel): NotIndexableReason | null;
  canonicalOf(page: PageModel): string | null;
  /** Internal URLs that at least one other page links to. */
  inbound: Map<string, Set<string>>;
  /** Keyed by normalised URL; `loc` is the URL exactly as listed. */
  sitemapUrls: Map<string, { loc: string; sitemap: string; lastmod: string | null }>;
  robots: import('./robots/parse.js').RobotsTxt | null;
  /** Normalises a URL for comparison (drops fragment; trailing slash policy applied). */
  norm(url: string): string;
}

export type CheckStatus = 'passed' | 'failed' | 'not-measured' | 'not-applicable' | 'off';

export interface CheckSummary {
  id: string;
  title: string;
  category: Category;
  severity: Severity | 'off';
  status: CheckStatus;
  subjects: number;
  failed: number;
  sources: string[];
  basis?: Basis;
  confidence?: Confidence;
  version?: number;
}

export interface CategoryScore {
  category: Category;
  /** null when nothing scorable ran. */
  score: number | null;
  uncapped: number | null;
  cap: { value: number; reason: string } | null;
  /** Checks that cost the most points, worst first. */
  topLosses: { id: string; lost: number }[];
}

export interface Report {
  schemaVersion: 1;
  tool: { name: 'x-find'; version: string };
  /**
   * Short hash of every check id and version that ran. Two reports with the same rulesId were scored by the same
   * rules; when it differs, a score change may come from x-find, not the site. Absent in older reports.
   */
  rulesId?: string;
  generatedAt: string;
  mode: Mode;
  site: string;
  pagesChecked: number;
  staging: boolean;
  findings: Finding[];
  checks: CheckSummary[];
  scores: CategoryScore[];
  overrides: { id: string; severity: Severity | 'off' }[];
  formula: string;
}
