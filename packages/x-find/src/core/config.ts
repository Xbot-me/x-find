import { z } from 'zod';
import type { Check, ResolvedConfig } from './types.js';

const severity = z.enum(['error', 'warning', 'notice', 'off']);

export const configSchema = z
  .object({
    /** The site's public origin, e.g. https://example.com. Required in folder mode. */
    site: z.url({ protocol: /^https?$/ }).optional(),
    /** How the site serves directory URLs. Used to compare URLs and to spot duplicates. */
    trailingSlash: z.enum(['always', 'never', 'ignore']).default('ignore'),
    /** Folder mode: a file `about.html` is served at `/about` (true for most static hosts). */
    cleanUrls: z.boolean().default(true),
    brand: z
      .object({
        name: z.string().min(1),
        /** Other spellings that are also correct (e.g. a legal name). */
        allow: z.array(z.string()).default([]),
      })
      .optional(),
    /** Per-check severity override, e.g. { "title-length": "off" }. */
    checks: z.record(z.string(), z.union([severity, z.object({ severity })])).default({}),
    thresholds: z
      .object({
        titleMaxChars: z.number().int().positive().default(60),
        descriptionMaxChars: z.number().int().positive().default(160),
        thinContentWords: z.number().int().nonnegative().default(200),
        similarity: z.number().min(0).max(1).default(0.9),
      })
      .prefault({}),
    /** URL path globs to leave out entirely, e.g. "/admin/**". */
    ignore: z.array(z.string()).default([]),
    /** Anchor texts reported as generic. Lower-case. */
    genericLinkText: z
      .array(z.string())
      .default([
        'click here',
        'here',
        'read more',
        'more',
        'learn more',
        'link',
        'this',
        'website',
        'article',
        'this page',
      ]),
    /** A preview or staging build that is noindex on purpose. */
    staging: z.boolean().default(false),
    /** Custom checks with the same shape as built-in ones. */
    rules: z.array(z.custom<Check>((v) => typeof v === 'object' && v !== null && 'id' in v && 'run' in v)).default([]),
  })
  .strict();

export type UserConfig = z.input<typeof configSchema>;

/** Helper for typed config files: `export default defineConfig({...})`. */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

export class ConfigError extends Error {}

export function resolveConfig(input: unknown, overrides: { site?: string; staging?: boolean } = {}): ResolvedConfig {
  const parsed = configSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid x-find config:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  const site = (overrides.site ?? c.site ?? '').replace(/\/+$/, '');
  const sev: ResolvedConfig['severity'] = {};
  for (const [id, v] of Object.entries(c.checks)) sev[id] = typeof v === 'string' ? v : v.severity;
  return {
    site,
    trailingSlash: c.trailingSlash,
    cleanUrls: c.cleanUrls,
    brand: { name: c.brand?.name ?? null, variants: c.brand?.allow ?? [] },
    thresholds: c.thresholds,
    severity: sev,
    ignore: c.ignore,
    genericLinkText: c.genericLinkText.map((s) => s.toLowerCase()),
    staging: overrides.staging ?? c.staging,
    rules: c.rules,
  };
}

/** Minimal glob for URL paths: `*` matches within a segment, `**` across segments. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
