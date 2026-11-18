/**
 * Turns an action into a fix a non-expert can act on: one plain problem sentence, one reason, the steps, code written
 * from the site's own data (page titles, link targets, markup, host), and a brief to hand to a developer or an AI
 * assistant. Pure: everything comes from the stored check and Search Console data.
 */
import type { PageFact } from '../core/pagefacts.js';
import type { Finding } from '../core/types.js';
import type { Action } from './actions.js';

export type SceneKind = 'reach' | 'index' | 'linktext' | 'logo' | 'redirect' | 'generic';

export interface Fix {
  key: string;
  /** What the screen draws for this task. */
  scene: SceneKind;
  /** One or two words for the task trail. */
  short: string;
  headline: string;
  reason: string;
  /** Said after the fix passes. */
  gain: string;
  /** "crawl": x-find can re-check the site; "search": Google decides, x-find asks URL Inspection. */
  check: 'crawl' | 'search';
  pages: { url: string; inspectUrl?: string | undefined }[];
  steps: string[];
  code: { label: string; text: string } | null;
  why: string;
  sources: string[];
  /** Ready to paste to a developer or an AI assistant. */
  brief: string;
}

export interface FixContext {
  origin: string;
  siteName: string;
  pages: PageFact[] | null;
  findings: Finding[] | null;
  /** The home page's Server header, lower-cased (e.g. "cloudflare", "netlify"). */
  server: string | null;
}

const pathOf = (url: string, origin: string) => (url.startsWith(origin) ? url.slice(origin.length) || '/' : url);
const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A short link label from a page title: "Character art: Work | BrightLeaf Studio" → "Character art". */
export function labelFromTitle(title: string | null, url: string, siteName: string): string {
  let t = (title ?? '').trim();
  const site = siteName.trim().toLowerCase();
  for (const sep of [' | ', ' – ', ' — ', ' - ', ' · ']) {
    const parts = t.split(sep);
    if (parts.length > 1) {
      const kept = parts.filter((p) => p.trim().toLowerCase() !== site);
      t = (kept.length ? kept : parts)[0]!.trim();
    }
  }
  if (t.includes(': ')) t = t.split(': ')[0]!.trim();
  if (t) return t;
  const seg = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'Home';
  const words = seg.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where redirects are configured, from the Server header. */
function redirectHow(server: string | null): { file: string; how: string } | null {
  const s = (server ?? '').toLowerCase();
  if (s.includes('cloudflare'))
    return {
      file: '_redirects',
      how: 'Add this line to a file named _redirects in the folder your site is built from (for Astro and Vite: public/).',
    };
  if (s.includes('netlify'))
    return { file: '_redirects', how: 'Add this line to a file named _redirects in your publish folder.' };
  return null;
}

function brief(f: Omit<Fix, 'brief'>, a: Action, ctx: FixContext): string {
  return [
    `${a.title} (${ctx.origin})`,
    '',
    a.why,
    '',
    ...(f.pages.length ? ['Pages:', ...f.pages.map((p) => `- ${p.url}`), ''] : []),
    'Steps:',
    ...f.steps.map((s, i) => `${i + 1}. ${s}`),
    ...(f.code ? ['', `${f.code.label}:`, f.code.text] : []),
    '',
    `Done when: ${a.doneWhen}`,
    ...(a.sources.length ? ['', `Source: ${a.sources.join(' · ')}`] : []),
  ].join('\n');
}

export function fixFor(a: Action, ctx: FixContext): Fix {
  const { origin } = ctx;
  const facts = new Map((ctx.pages ?? []).map((p) => [p.url, p]));
  const findingsFor = (checkId: string) => (ctx.findings ?? []).filter((f) => f.checkId === checkId);
  const base = {
    key: a.key,
    check: a.source === 'search' ? ('search' as const) : ('crawl' as const),
    pages: a.pages.map((p) => ({ url: p.url, inspectUrl: p.inspectUrl })),
    why: a.why,
    sources: a.sources,
  };
  let f: Omit<Fix, 'brief'>;

  if (a.key === 'reach') {
    const n = a.pages.length;
    const links = a.pages.map(
      (p) =>
        `<a href="${escHtml(pathOf(p.url, origin))}">${escHtml(labelFromTitle(facts.get(p.url)?.title ?? null, p.url, ctx.siteName))}</a>`,
    );
    const filterLinks = (ctx.pages ?? []).some((p) => p.notIndexable === 'canonical' && p.url.includes('?'));
    f = {
      ...base,
      scene: 'reach',
      short: 'Links',
      headline: n === 1 ? 'Google can’t reach one of your pages.' : `Google can’t reach ${n} of your pages.`,
      reason: filterLinks
        ? 'Your home page links to filtered versions of them, so Google only finds them slowly.'
        : 'No link leads to them from your home page, so Google only finds them slowly.',
      gain: `Google can now reach ${n === 1 ? 'that page' : `${n} more of your pages`}.`,
      steps: [
        'Open your home page template, or your main menu.',
        `Add ${n === 1 ? 'a link to this page' : 'links to these pages'} (code below)${filterLinks ? ', instead of the filtered ?… links' : ''}.`,
        'Deploy the site, then check here.',
      ],
      code: { label: 'Links to add', text: links.join('\n') },
    };
  } else if (a.key === 'index-request') {
    const n = a.pages.length;
    f = {
      ...base,
      scene: 'index',
      short: 'Ask Google',
      headline: `Ask Google to look at your ${n === 1 ? 'most important page' : `${n} most important pages`}.`,
      reason: 'Google hasn’t visited them yet. Asking directly can speed that up.',
      gain: n === 1 ? 'Google has that page now.' : `Google has your ${n} pages now.`,
      steps: [
        'Open each page in Search Console (the link goes straight to it).',
        'Click “Request indexing” and wait for the test to finish.',
        'Google limits requests per day. If it says no, do the rest tomorrow.',
      ],
      code: null,
    };
  } else if (a.key === 'finding:link-empty-text:warning') {
    const fs = findingsFor('link-empty-text');
    const target = fs[0]?.evidence?.split('\n')[0]?.trim() || null;
    const where = fs[0]?.url ? pathOf(fs[0].url, origin) : '/';
    const label = target
      ? labelFromTitle(
          facts.get(new URL(target, origin).href)?.title ?? null,
          new URL(target, origin).href,
          ctx.siteName,
        )
      : 'Describe the page';
    f = {
      ...base,
      scene: 'linktext',
      short: 'Link text',
      headline:
        fs.length > 1
          ? `${fs.length} links on your site have no words.`
          : `A link on ${where === '/' ? 'your home page' : where} has no words.`,
      reason: 'Google can’t tell where it leads.',
      gain: 'Every link now says where it goes.',
      steps: [
        `Find the empty link${target ? ` to ${target}` : ''} on ${where === '/' ? 'the home page' : where}.`,
        'Give it words, or an aria-label if it must stay empty (a card overlay, for example).',
        'Deploy, then check here.',
      ],
      code: target
        ? {
            label: 'The link, with words',
            text: `<a href="${escHtml(target)}">${escHtml(label)}</a>\n\n<!-- or, if it must stay empty: -->\n<a href="${escHtml(target)}" aria-label="${escHtml(label)}"></a>`,
          }
        : null,
    };
  } else if (a.key === 'finding:org-logo:warning') {
    f = {
      ...base,
      scene: 'logo',
      short: 'Logo',
      headline: 'Google doesn’t know your logo.',
      reason: 'With one, Google can show it next to your name in search.',
      gain: 'Google can now show your logo.',
      steps: [
        'Export a square logo, at least 112 × 112 pixels (512 × 512 is safe), that reads on white. Save it as /logo.png.',
        'Add the logo line to the Organization markup on your home page (code below).',
        'Deploy, then check here.',
      ],
      code: { label: 'Add to your Organization markup', text: `"logo": "${origin}/logo.png"` },
    };
  } else if (a.key === 'finding:trailing-slash-duplicate:warning') {
    const fs = findingsFor('trailing-slash-duplicate');
    const from = fs[0]?.url ? pathOf(fs[0].url, origin) : null;
    const to = from ? (from.endsWith('/') ? from.slice(0, -1) || '/' : `${from}/`) : null;
    const host = redirectHow(ctx.server);
    f = {
      ...base,
      scene: 'redirect',
      short: 'Redirect',
      headline: from ? `Google may see ${from} and ${to} as two pages.` : 'Google may see two addresses for one page.',
      reason: 'One permanent redirect fixes that.',
      gain: from ? `${to} is the only address now.` : 'Each page has one address now.',
      steps: host
        ? [host.how, 'Deploy, then check here.']
        : ['In your host’s settings, add a permanent (301) redirect (code below).', 'Deploy, then check here.'],
      code: from ? { label: host ? host.file : 'Redirect', text: `${from}  ${to}  301` } : null,
    };
  } else {
    // Any other check or Search Console advice: the action's own plain text.
    const isWarning = a.tier === 4;
    f = {
      ...base,
      scene: 'generic',
      short: a.title
        .replace(/^Fix: /, '')
        .split(' ')
        .slice(0, 2)
        .join(' '),
      headline:
        a.title.replace(/^Fix: /, '').replace(/^./, (c) => c.toUpperCase()) + (a.title.endsWith('.') ? '' : '.'),
      reason: isWarning ? a.why.replace(/^Not blocking, but worth fixing\. /, '') : a.why,
      gain: 'Fixed.',
      steps: a.steps,
      code: null,
    };
  }
  return { ...f, brief: brief(f, a, ctx) };
}
