/**
 * robots.txt parser and matcher following RFC 9309 and Google's documented behaviour
 * (https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt), checked against the test cases of
 * google/robotstxt (see test/robots-google.test.ts).
 */

export const ROBOTS_MAX_BYTES = 500 * 1024;
/** google/robotstxt keeps at most this many bytes of a line (its buffer is 2083 × 8 including the terminator). */
const MAX_LINE_BYTES = 2083 * 8 - 1;

export type RuleType = 'allow' | 'disallow';

export interface RobotsRule {
  type: RuleType;
  /** The pattern as written. */
  raw: string;
  /** Normalised pattern: non-ASCII and illegal characters percent-encoded with upper-case hex. */
  pattern: string;
  line: number;
}

export interface RobotsGroup {
  /** User-agent values as written (trimmed). */
  agents: string[];
  rules: RobotsRule[];
  /** Content-Signal lines in this group (Cloudflare content signals policy). */
  contentSignals: { value: string; line: number }[];
  firstLine: number;
}

export interface RobotsLine {
  line: number;
  text: string;
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: { url: string; line: number }[];
  /** Field names Google ignores but that are known (crawl-delay, host, content-signal, license, clean-param). */
  otherFields: { field: string; value: string; line: number }[];
  /** Lines that are not `field: value` or use an unknown field. */
  invalidLines: (RobotsLine & { reason: string })[];
  /** Typos Google accepts (`disalow`, `useragent`…). */
  acceptedTypos: (RobotsLine & { field: string })[];
  /** allow/disallow lines before any user-agent line: ignored by crawlers. */
  rulesOutsideGroup: RobotsLine[];
  bytes: number;
}

const KNOWN_OTHER = new Set([
  'crawl-delay',
  'host',
  'content-signal',
  'license',
  'clean-param',
  'request-rate',
  'visit-time',
  'noindex',
]);
const TYPOS: Record<string, 'user-agent' | 'allow' | 'disallow'> = {
  useragent: 'user-agent',
  'user agent': 'user-agent',
  dissallow: 'disallow',
  dissalow: 'disallow',
  disalow: 'disallow',
  diasllow: 'disallow',
  disallaw: 'disallow',
};

const encoder = new TextEncoder();

function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** Percent-encodes characters that must be escaped, keeps existing %XX escapes (upper-casing their hex). */
export function escapePattern(path: string): string {
  let out = '';
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]!;
    if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(path.slice(i + 1, i + 3))) {
      out += '%' + path.slice(i + 1, i + 3).toUpperCase();
      i += 2;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code > 0x7e || code <= 0x20) {
      const chars = String.fromCodePoint(code);
      if (code > 0xffff) i++;
      for (const b of encoder.encode(chars)) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      continue;
    }
    out += ch;
  }
  return out;
}

/** Only spaces and tabs count as whitespace: a stray BOM inside the file must break the line, as it does for Google. */
function trimWs(s: string): string {
  return s.replace(/^[ \t]+|[ \t]+$/g, '');
}

function stripBom(body: string): string {
  // A full BOM decodes to U+FEFF. Partial BOM bytes decode to U+FFFD; google/robotstxt skips a partial BOM too.
  if (body.startsWith('\uFEFF')) return body.slice(1);
  let i = 0;
  while (i < 2 && body[i] === '�') i++;
  return i > 0 && /^[A-Za-z#\s]/.test(body.slice(i)) ? body.slice(i) : body;
}

export function parseRobotsTxt(input: string): RobotsTxt {
  const bytes = byteLength(input);
  let body = input;
  if (bytes > ROBOTS_MAX_BYTES) {
    // Content after 500 KiB is ignored. Cut on a character boundary at or below the limit.
    const buf = encoder.encode(input).slice(0, ROBOTS_MAX_BYTES);
    body = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
  body = stripBom(body);

  const result: RobotsTxt = {
    groups: [],
    sitemaps: [],
    otherFields: [],
    invalidLines: [],
    acceptedTypos: [],
    rulesOutsideGroup: [],
    bytes,
  };

  const lines = body.split(/\r\n|\r|\n/);
  let current: RobotsGroup | null = null;
  // True while we are reading consecutive user-agent lines (they share one group).
  let inAgentRun = false;

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    let line = rawLine;
    if (byteLength(line) > MAX_LINE_BYTES) line = line.slice(0, MAX_LINE_BYTES);
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = trimWs(line);
    if (line === '') return;

    let field: string;
    let value: string;
    const colon = line.indexOf(':');
    if (colon >= 0) {
      field = trimWs(line.slice(0, colon));
      value = trimWs(line.slice(colon + 1));
    } else {
      // Google accepts a missing colon when a known key and its value are separated by whitespace.
      const m = /^(\S+(?:\s+agent)?)\s+(.+)$/i.exec(line);
      const candidate = m?.[1]?.toLowerCase();
      if (
        !m ||
        !candidate ||
        !(candidate in TYPOS || ['user-agent', 'allow', 'disallow', 'sitemap'].includes(candidate))
      ) {
        result.invalidLines.push({ line: lineNo, text: rawLine, reason: 'not a "field: value" line' });
        return;
      }
      field = m[1]!;
      value = trimWs(m[2]!);
      result.invalidLines.push({
        line: lineNo,
        text: rawLine,
        reason: 'missing ":" (Google accepts it; other crawlers may not)',
      });
    }
    let key = field.toLowerCase();
    const typo = TYPOS[key];
    if (typo) {
      result.acceptedTypos.push({ line: lineNo, text: rawLine, field });
      key = typo;
    }

    if (key === 'user-agent') {
      if (!inAgentRun || !current) {
        current = { agents: [], rules: [], contentSignals: [], firstLine: lineNo };
        result.groups.push(current);
      }
      current.agents.push(value);
      inAgentRun = true;
      return;
    }
    if (key === 'allow' || key === 'disallow') {
      if (!current) {
        result.rulesOutsideGroup.push({ line: lineNo, text: rawLine });
        return;
      }
      inAgentRun = false;
      current.rules.push({ type: key, raw: value, pattern: escapePattern(value), line: lineNo });
      return;
    }
    if (key === 'sitemap') {
      result.sitemaps.push({ url: value, line: lineNo });
      return;
    }
    // Like other non-rule lines, Content-Signal doesn't end a run of user-agent lines (Google ignores it).
    if (key === 'content-signal' && current) current.contentSignals.push({ value, line: lineNo });
    if (KNOWN_OTHER.has(key)) {
      result.otherFields.push({ field: key, value, line: lineNo });
      return;
    }
    result.invalidLines.push({ line: lineNo, text: rawLine, reason: `unknown field "${field}"` });
  });

  return result;
}

/** The product token Google compares: the user-agent value up to the first character outside [A-Za-z_-]. */
function agentToken(value: string): string {
  const v = value.trim();
  if (v.startsWith('*')) return '*';
  const m = /^[A-Za-z_-]+/.exec(v);
  return m ? m[0].toLowerCase() : '';
}

/** A crawler name we may ask about must be a plain product token, e.g. "Googlebot". */
export function isValidUserAgentToObey(ua: string): boolean {
  return /^[A-Za-z_-]+$/.test(ua);
}

/** Path + params + query of a URL, as robots rules see it. */
export function pathForMatching(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname || '/';
    return escapePattern(path + u.search);
  } catch {
    // Already a path.
    const noFragment = url.split('#')[0] ?? '';
    return escapePattern(noFragment === '' ? '/' : noFragment);
  }
}

/** Does `pattern` (with * and $) match the start of `path`? Returns true on match. */
export function patternMatches(path: string, pattern: string): boolean {
  // Classic two-pointer wildcard match with backtracking; `$` only anchors at the end of the pattern.
  const anchored = pattern.endsWith('$');
  const pat = anchored ? pattern.slice(0, -1) : pattern;
  // positions[i] = can the first i chars of pat match a prefix of path ending at some position set
  let positions = new Set<number>([0]);
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i]!;
    const next = new Set<number>();
    if (ch === '*') {
      const min = Math.min(...positions);
      for (let p = min; p <= path.length; p++) next.add(p);
    } else {
      for (const p of positions) if (p < path.length && path[p] === ch) next.add(p + 1);
    }
    if (next.size === 0) return false;
    positions = next;
  }
  return anchored ? positions.has(path.length) : true;
}

export interface MatchResult {
  allowed: boolean;
  /** The rule that decided, or null when no rule matched (allowed by default). */
  rule: RobotsRule | null;
  /** The group(s) that applied: the agent's own group(s), or the * group. */
  groupLines: number[];
}

/** Groups that apply to a crawler: its own groups merged, else the * groups merged, else none. */
export function groupsFor(robots: RobotsTxt, userAgent: string): RobotsGroup[] {
  const token = userAgent.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.some((a) => agentToken(a) === token && token !== ''));
  if (specific.length > 0) return specific;
  return robots.groups.filter((g) => g.agents.some((a) => agentToken(a) === '*'));
}

export function matchRobots(robots: RobotsTxt, userAgent: string, url: string): MatchResult {
  const groups = groupsFor(robots, userAgent);
  const path = pathForMatching(url);
  let best: { rule: RobotsRule; priority: number } | null = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (rule.pattern === '') continue; // empty rules are ignored
      const candidates = [rule.pattern];
      // Google treats "Allow: /dir/index.html" as also allowing "/dir/".
      if (rule.type === 'allow') {
        const m = /^(.*\/)index\.html?$/i.exec(rule.pattern);
        if (m) candidates.push(m[1] + '$');
      }
      for (const pattern of candidates) {
        if (!patternMatches(path, pattern)) continue;
        const priority = byteLength(rule.pattern);
        if (
          !best ||
          priority > best.priority ||
          (priority === best.priority && rule.type === 'allow' && best.rule.type === 'disallow')
        ) {
          best = { rule, priority };
        }
      }
    }
  }
  return {
    allowed: !best || best.rule.type === 'allow',
    rule: best?.rule ?? null,
    groupLines: groups.map((g) => g.firstLine),
  };
}

export function isAllowed(robots: RobotsTxt | null, userAgent: string, url: string): boolean {
  if (!robots) return true;
  return matchRobots(robots, userAgent, url).allowed;
}
