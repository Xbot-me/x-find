/**
 * x-find core: runtime-neutral (no Node APIs). Build a SiteModel (src/node does this for folders and live sites, a
 * Worker can do it from its own fetches), then run the checks.
 */
export { buildIndex, canonicalHref } from './analyze.js';
export { builtInChecks } from './checks/index.js';
export { declaredLogoUrls } from './checks/geo.js';
export { ConfigError, configSchema, defineConfig, resolveConfig } from './config.js';
export type { UserConfig } from './config.js';
export { CRAWLERS } from './crawlers.js';
export type { Crawler, CrawlerPurpose } from './crawlers.js';
export { diffReports } from './diff.js';
export { entityFacts, ORG_PROPS } from './entity.js';
export type { EntityFacts, OrgProp } from './entity.js';
export type { ReportDiff } from './diff.js';
export { parsePage } from './html/parse.js';
export { pageFacts } from './pagefacts.js';
export type { PageFact } from './pagefacts.js';
export { imageSize } from './imagesize.js';
export { formatHtml } from './report/html.js';
export { formatMarkdown } from './report/markdown.js';
export { formatText } from './report/text.js';
export { isAllowed, matchRobots, parseRobotsTxt } from './robots/parse.js';
export { parseSitemap } from './sitemap/parse.js';
export { BASIS_TEXT, CHECK_LABELS } from './checks/labels.js';
export { findingLabel, fingerprint, rulesId, runChecks, SCORE_FORMULA } from './run.js';
export type { RunResult } from './run.js';
export { SRC } from './sources.js';
export * from './types.js';
export { VERSION } from './version.js';
