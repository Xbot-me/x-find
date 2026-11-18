/**
 * Google Search Console client. Runtime-neutral (fetch + WebCrypto only), so it runs in Node now and in a Cloudflare
 * Worker later.
 *
 * Auth: a service account key. A JWT signed with RS256 is exchanged at oauth2.googleapis.com/token for an access
 * token (https://developers.google.com/identity/protocols/oauth2/service-account). Scope: webmasters.readonly.
 * APIs: searchAnalytics.query (https://developers.google.com/webmaster-tools/v1/searchanalytics/query),
 * urlInspection.index.inspect (https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect),
 * sitemaps.list (https://developers.google.com/webmaster-tools/v1/sitemaps/list), sites.list. Quotas: https://developers.google.com/webmaster-tools/limits.
 */

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://searchconsole.googleapis.com';

export interface ServiceAccountKey {
  type?: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

/** Checks that a parsed JSON file looks like a service-account key and says what is wrong if not. */
export function parseServiceAccountKey(value: unknown): ServiceAccountKey {
  if (!value || typeof value !== 'object') throw new Error('The key file is not JSON.');
  const k = value as Record<string, unknown>;
  if (k['type'] !== undefined && k['type'] !== 'service_account')
    throw new Error(
      `This is a "${String(k['type'])}" credential; x-find needs a service account key (type "service_account").`,
    );
  if (typeof k['client_email'] !== 'string' || !k['client_email'].includes('@'))
    throw new Error('The key file has no client_email.');
  if (typeof k['private_key'] !== 'string' || !k['private_key'].includes('PRIVATE KEY'))
    throw new Error('The key file has no private_key.');
  return {
    client_email: k['client_email'],
    private_key: k['private_key'],
    ...(typeof k['private_key_id'] === 'string' ? { private_key_id: k['private_key_id'] } : {}),
  };
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const toArrayBuffer = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** The signed JWT assertion for the token request. Exported for tests. */
export async function signJwt(key: ServiceAccountKey, scope: string, nowSeconds: number): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) };
  const claims = { iss: key.client_email, scope, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 };
  const input = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(pemToDer(key.private_key)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

async function googleError(res: Response): Promise<GoogleApiError> {
  let message = `HTTP ${res.status}`;
  let reason: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: { message?: string; status?: string } | string;
      error_description?: string;
    };
    if (typeof body.error === 'object' && body.error?.message) {
      message = body.error.message;
      reason = body.error.status;
    } else if (typeof body.error === 'string') {
      message = body.error_description ?? body.error;
      reason = body.error;
    }
  } catch {
    /* not JSON */
  }
  return new GoogleApiError(res.status, message, reason);
}

export class GoogleAuth {
  private cached: { token: string; expires: number } | null = null;

  constructor(
    private key: ServiceAccountKey,
    private scope = GSC_SCOPE,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = () => Date.now(),
  ) {}

  get email(): string {
    return this.key.client_email;
  }

  async token(): Promise<string> {
    if (this.cached && this.cached.expires - 60_000 > this.now()) return this.cached.token;
    const assertion = await signJwt(this.key, this.scope, Math.floor(this.now() / 1000));
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) throw await googleError(res);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    this.cached = { token: body.access_token, expires: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}

export type Dimension = 'date' | 'query' | 'page' | 'country' | 'device' | 'searchAppearance';

export interface AnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface InspectionResult {
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  robotsTxtState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
}

export interface SitemapStatus {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  errors: number;
  warnings: number;
  /** URLs listed in the sitemap, as Google counted them. */
  submitted: number | null;
}

export class SearchConsole {
  constructor(
    private auth: GoogleAuth,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  /** The service account's email: what the owner adds as a user in Search Console. */
  get email(): string {
    return this.auth.email;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(API + path, {
      method,
      headers: { authorization: `Bearer ${await this.auth.token()}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw await googleError(res);
    return (await res.json()) as T;
  }

  /** Properties the service account can read. */
  async listSites(): Promise<{ siteUrl: string; permissionLevel: string }[]> {
    const r = await this.call<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(
      'GET',
      '/webmasters/v3/sites',
    );
    return (r.siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
  }

  /** searchAnalytics.query with paging (25,000 rows per request), up to `maxRows`. */
  async query(
    property: string,
    req: { startDate: string; endDate: string; dimensions: Dimension[]; type?: string; dataState?: 'final' | 'all' },
    maxRows = 50_000,
  ): Promise<AnalyticsRow[]> {
    const rows: AnalyticsRow[] = [];
    const rowLimit = 25_000;
    for (let startRow = 0; startRow < maxRows; startRow += rowLimit) {
      const r = await this.call<{ rows?: AnalyticsRow[] }>(
        'POST',
        `/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
        { ...req, rowLimit: Math.min(rowLimit, maxRows - startRow), startRow },
      );
      const page = r.rows ?? [];
      rows.push(...page);
      if (page.length < rowLimit) break;
    }
    return rows;
  }

  /** sitemaps.list: the sitemaps submitted for the property (https://developers.google.com/webmaster-tools/v1/sitemaps). */
  async listSitemaps(property: string): Promise<SitemapStatus[]> {
    const r = await this.call<{ sitemap?: Record<string, unknown>[] }>(
      'GET',
      `/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps`,
    );
    const n = (v: unknown) => (v === undefined || v === null ? null : Number(v));
    return (r.sitemap ?? []).map((m) => ({
      path: String(m['path']),
      lastSubmitted: (m['lastSubmitted'] as string | undefined) ?? null,
      lastDownloaded: (m['lastDownloaded'] as string | undefined) ?? null,
      isPending: m['isPending'] === true,
      errors: n(m['errors']) ?? 0,
      warnings: n(m['warnings']) ?? 0,
      // contents[].indexed is deprecated by Google, so only the submitted count is kept.
      submitted: Array.isArray(m['contents'])
        ? (m['contents'] as { submitted?: unknown }[]).reduce((t, c) => t + (n(c.submitted) ?? 0), 0)
        : null,
    }));
  }

  async inspect(property: string, url: string): Promise<InspectionResult> {
    const r = await this.call<{ inspectionResult?: { indexStatusResult?: Record<string, unknown> } }>(
      'POST',
      '/v1/urlInspection/index:inspect',
      { inspectionUrl: url, siteUrl: property, languageCode: 'en-US' },
    );
    const s = r.inspectionResult?.indexStatusResult ?? {};
    const str = (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : null);
    return {
      verdict: str('verdict'),
      coverageState: str('coverageState'),
      indexingState: str('indexingState'),
      pageFetchState: str('pageFetchState'),
      robotsTxtState: str('robotsTxtState'),
      googleCanonical: str('googleCanonical'),
      userCanonical: str('userCanonical'),
      lastCrawlTime: str('lastCrawlTime'),
    };
  }
}

/**
 * The Search Console property that covers a site: the URL-prefix property for its origin if the account has one,
 * otherwise a domain property (sc-domain:) for its host or a parent domain.
 */
export function matchProperty(properties: string[], origin: string): string | null {
  const o = new URL(origin);
  const prefix = properties.find((p) => p === `${o.origin}/`);
  if (prefix) return prefix;
  const host = o.hostname.replace(/^www\./, '');
  const domains = properties
    .filter((p) => p.startsWith('sc-domain:'))
    .map((p) => ({ p, d: p.slice('sc-domain:'.length) }))
    .filter(({ d }) => host === d || host.endsWith(`.${d}`) || o.hostname === d || o.hostname.endsWith(`.${d}`))
    .sort((a, b) => b.d.length - a.d.length);
  return domains[0]?.p ?? null;
}

/** A link that opens this URL in Search Console's URL Inspection tool, where "Request indexing" is. */
export function inspectLink(property: string, url: string): string {
  return `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(property)}&id=${encodeURIComponent(url)}`;
}

/** Explains common Google errors in terms of what the owner should do. */
export function explainGoogleError(e: unknown, email: string): string {
  if (!(e instanceof GoogleApiError)) return (e as Error).message ?? String(e);
  if (e.status === 403 && /permission/i.test(e.message))
    return `Search Console says ${email} has no access to this property. Add that email as a user (Restricted is enough) in Search Console → Settings → Users and permissions.`;
  if (e.status === 403 && /has not been used|disabled/i.test(e.message))
    return 'The Google Search Console API is not enabled for this Google Cloud project. Enable it under APIs & Services → Library → "Google Search Console API".';
  if (e.reason === 'invalid_grant')
    return `Google rejected the key (${e.message}). The key may have been deleted or the computer clock is wrong; create a new key and connect again.`;
  if (e.status === 429) return 'Google rate limit reached; x-find will try again on the next sync.';
  return `Google returned ${e.status}: ${e.message}`;
}
