import type { Check } from '../types.js';
import { aeoPageChecks, aeoSiteChecks } from './aeo.js';
import { geoSiteChecks } from './geo.js';
import { CHECK_LABELS } from './labels.js';
import { liveChecks } from './live.js';
import { robotsSitemapChecks } from './robots-sitemap.js';
import { seoPageChecks } from './seo-page.js';
import { seoSiteChecks } from './seo-site.js';
import { structuredDataChecks } from './structured-data.js';

const all: Check[] = [
  ...seoPageChecks,
  ...seoSiteChecks,
  ...robotsSitemapChecks,
  ...structuredDataChecks,
  ...liveChecks,
  ...aeoPageChecks,
  ...aeoSiteChecks,
  ...geoSiteChecks,
];

/** Every built-in check, in report order, with its basis, confidence and version from labels.ts. */
export const builtInChecks: Check[] = all.map((c) => ({ ...c, ...CHECK_LABELS[c.id] }));
