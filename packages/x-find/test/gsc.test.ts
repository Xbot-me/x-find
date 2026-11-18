import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countryName } from '../src/connectors/countries.js';
import {
  explainGoogleError,
  GoogleApiError,
  GoogleAuth,
  inspectLink,
  matchProperty,
  parseServiceAccountKey,
  SearchConsole,
  signJwt,
} from '../src/connectors/google.js';
import { searchView, syncSearchConsole } from '../src/server/gsc.js';
import { Store } from '../src/server/store.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const KEY = {
  type: 'service_account',
  client_email: 'x-find@demo.iam.gserviceaccount.com',
  private_key: privateKey,
  private_key_id: 'k1',
};
const b64json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>;

describe('service account auth', () => {
  it('signs an RS256 JWT that verifies with the public key and has the right claims', async () => {
    const jwt = await signJwt(parseServiceAccountKey(KEY), 'scope-a', 1_800_000_000);
    const [h, c, sig] = jwt.split('.');
    expect(b64json(h!)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'k1' });
    expect(b64json(c!)).toEqual({
      iss: KEY.client_email,
      scope: 'scope-a',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig!, 'base64url'))).toBe(true);
  });

  it('rejects files that are not service account keys, with a reason', () => {
    expect(() => parseServiceAccountKey({ type: 'authorized_user' })).toThrow(/service account key/);
    expect(() => parseServiceAccountKey({ client_email: 'a@b.c' })).toThrow(/private_key/);
  });

  it('reuses the access token until shortly before it expires', async () => {
    let calls = 0;
    let now = 1_000_000;
    const fake = (async (_url: string, init: RequestInit) => {
      calls++;
      const body = new URLSearchParams(String(init.body));
      expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      return Response.json({ access_token: `t${calls}`, expires_in: 3600 });
    }) as unknown as typeof fetch;
    const auth = new GoogleAuth(parseServiceAccountKey(KEY), undefined, fake, () => now);
    expect(await auth.token()).toBe('t1');
    now += 30 * 60_000;
    expect(await auth.token()).toBe('t1');
    now += 30 * 60_000;
    expect(await auth.token()).toBe('t2');
  });
});

describe('helpers', () => {
  it('matches a URL-prefix property first, then the closest domain property', () => {
    const props = [
      'sc-domain:example.com',
      'https://shop.example.com/',
      'sc-domain:shop.example.com',
      'https://other.com/',
    ];
    expect(matchProperty(props, 'https://shop.example.com')).toBe('https://shop.example.com/');
    expect(matchProperty(props, 'https://blog.shop.example.com')).toBe('sc-domain:shop.example.com');
    expect(matchProperty(props, 'https://www.example.com')).toBe('sc-domain:example.com');
    expect(matchProperty(props, 'https://nope.org')).toBeNull();
  });

  it('builds the URL Inspection link and country names', () => {
    expect(inspectLink('sc-domain:a.com', 'https://a.com/x/')).toBe(
      'https://search.google.com/search-console/inspect?resource_id=sc-domain%3Aa.com&id=https%3A%2F%2Fa.com%2Fx%2F',
    );
    expect(countryName('usa')).toBe('United States');
    expect(countryName('bgd')).toBe('Bangladesh');
    expect(countryName('zzz')).toBe('Unknown');
    expect(countryName('abc')).toBe('ABC');
  });

  it('explains Google errors as steps', () => {
    expect(
      explainGoogleError(new GoogleApiError(403, 'User does not have sufficient permission for site'), 'sa@x'),
    ).toMatch(/Users and permissions/);
    expect(
      explainGoogleError(new GoogleApiError(403, 'Google Search Console API has not been used in project 1'), 'sa@x'),
    ).toMatch(/APIs & Services/);
  });
});

/** A fake Search Console: daily rows for the requested range and fixed breakdowns. */
function fakeGoogle(opts: { properties: string[]; sitemapsFail?: boolean }) {
  const calls: string[] = [];
  const day = (d: string) => Number(d.slice(8, 10));
  const impl = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push(`${init.method ?? 'GET'} ${url.pathname}`);
    if (url.host === 'oauth2.googleapis.com') return Response.json({ access_token: 'tok', expires_in: 3600 });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    if (url.pathname === '/webmasters/v3/sites')
      return Response.json({
        siteEntry: opts.properties.map((siteUrl) => ({ siteUrl, permissionLevel: 'siteRestrictedUser' })),
      });
    if (url.pathname.endsWith('/searchAnalytics/query')) {
      const req = JSON.parse(String(init.body)) as { startDate: string; endDate: string; dimensions: string[] };
      const dims = req.dimensions.join(',');
      if (dims === 'date') {
        const rows = [];
        for (
          let d = new Date(`${req.startDate}T00:00:00Z`);
          d <= new Date(`${req.endDate}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 1)
        ) {
          const date = d.toISOString().slice(0, 10);
          rows.push({ keys: [date], clicks: 2, impressions: 100 + day(date), ctr: 0.02, position: 12 });
        }
        return Response.json({ rows });
      }
      const recent = req.endDate >= '2026-11-10';
      if (dims === 'query,page')
        return Response.json({
          rows: [
            {
              keys: ['character rigging service', 'https://a.com/rigging/'],
              clicks: 3,
              impressions: 400,
              ctr: 0.0075,
              position: recent ? 11.2 : 14,
            },
            { keys: ['a studio', 'https://a.com/'], clicks: 40, impressions: 90, ctr: 0.44, position: 1 },
            {
              keys: ['likeness study', 'https://a.com/work/likeness/'],
              clicks: 1,
              impressions: 500,
              ctr: 0.002,
              position: 6,
            },
          ],
        });
      if (dims === 'page')
        return Response.json({
          rows: recent
            ? [{ keys: ['https://a.com/'], clicks: 40, impressions: 90, ctr: 0.44, position: 1 }]
            : [
                { keys: ['https://a.com/'], clicks: 41, impressions: 95, ctr: 0.43, position: 1 },
                { keys: ['https://a.com/old/'], clicks: 25, impressions: 300, ctr: 0.08, position: 4 },
              ],
        });
      if (dims === 'country')
        return Response.json({
          rows: [
            { keys: ['usa'], clicks: 20, impressions: 600, ctr: 0.03, position: 9 },
            { keys: ['bgd'], clicks: 5, impressions: 120, ctr: 0.04, position: 7 },
          ],
        });
      if (dims === 'device')
        return Response.json({ rows: [{ keys: ['MOBILE'], clicks: 30, impressions: 700, ctr: 0.04, position: 8 }] });
    }
    if (url.pathname.endsWith('/sitemaps') && opts.sitemapsFail) return new Response('boom', { status: 500 });
    if (url.pathname.endsWith('/sitemaps'))
      return Response.json({
        sitemap: [
          {
            path: 'https://a.com/sitemap.xml',
            lastSubmitted: '2026-11-01T00:00:00Z',
            isPending: false,
            errors: '0',
            warnings: '1',
            contents: [{ type: 'web', submitted: '2', indexed: '0' }],
          },
        ],
      });
    if (url.pathname === '/v1/urlInspection/index:inspect') {
      const { inspectionUrl } = JSON.parse(String(init.body)) as { inspectionUrl: string };
      const indexed = !inspectionUrl.includes('new');
      return Response.json({
        inspectionResult: {
          indexStatusResult: indexed
            ? { verdict: 'PASS', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-11-10T10:00:00Z' }
            : { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' },
        },
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function setup(properties = ['sc-domain:a.com'], sitemapsFail = false) {
  const store = new Store(':memory:');
  const site = store.addSite('https://a.com', 'A');
  const runId = store.startRun(site.id, 'cli');
  store.finishRun(
    runId,
    {
      schemaVersion: 1,
      tool: { name: 'x-find', version: '0' },
      generatedAt: '',
      mode: 'live',
      site: 'https://a.com',
      pagesChecked: 2,
      staging: false,
      findings: [],
      checks: [],
      scores: [],
      overrides: [],
      formula: '',
    },
    { crawlerAccess: [], urls: ['https://a.com/', 'https://a.com/new-page/'] },
  );
  const google = fakeGoogle({ properties, sitemapsFail });
  const client = new SearchConsole(new GoogleAuth(parseServiceAccountKey(KEY), undefined, google.impl), google.impl);
  return { store, site, client, google };
}

describe('Search Console sync', () => {
  it('pulls daily totals, searches, countries, devices and indexing, and builds the view', async () => {
    const { store, site, client } = setup();
    const r = await syncSearchConsole(store, site, client, { now: new Date('2026-11-15T08:00:00Z') });
    expect(r).toMatchObject({ property: 'sc-domain:a.com', queries: 3, inspected: 2 });
    expect(r.days).toBeGreaterThan(400); // 16 months the first time

    const v = searchView(store, site.id, true, client.email);
    if (!v.hasData) throw new Error('no data');
    expect(v.range.cur).toEqual(['2026-10-18', '2026-11-14']);
    expect(v.totals.cur.clicks).toBe(56);
    expect(v.queries[0]).toMatchObject({ query: 'a studio', clicks: 40 });
    expect(v.queries.find((q) => q.query === 'character rigging service')).toMatchObject({
      position: 11.2,
      prevPosition: 14,
    });
    expect(v.countries.map((c) => c.name)).toEqual(['United States', 'Bangladesh']);
    expect(v.devices).toEqual([{ device: 'mobile', clicks: 30, impressions: 700 }]);
    expect(v.opportunities.closeToPageOne.map((o) => o.query)).toEqual(['character rigging service']);
    expect(v.opportunities.lowCtr.map((o) => o.query)).toEqual(['likeness study']);
    expect(v.opportunities.losing).toEqual([{ page: 'https://a.com/old/', clicks: 0, prevClicks: 25 }]);
    expect(v.indexing).toMatchObject({ meant: 2, inspected: 2, indexed: 1, missing: 1 });
    const group = v.indexing.groups[0]!;
    expect(group.state).toBe('Discovered - currently not indexed');
    expect(group.pages[0]).toMatchObject({ url: 'https://a.com/new-page/' });
    expect(group.pages[0]!.inspectUrl).toMatch(/^https:\/\/search\.google\.com\/search-console\/inspect\?/);
    // The sitemap list was read and one is submitted, so no "not submitted" reason.
    expect(v.indexing.site.map((r) => r.id)).not.toContain('sitemap-not-submitted');
    expect(store.db.prepare(`SELECT path, warnings, submitted FROM gsc_sitemaps`).all()).toEqual([
      { path: 'https://a.com/sitemap.xml', warnings: 1, submitted: 2 },
    ]);
  });

  it('second sync only re-pulls recent days and skips URLs already inspected today', async () => {
    const { store, site, client, google } = setup();
    await syncSearchConsole(store, site, client, { now: new Date('2026-11-15T08:00:00Z') });
    google.calls.length = 0;
    const r = await syncSearchConsole(store, site, client, { now: new Date('2026-11-15T20:00:00Z') });
    expect(r.days).toBeLessThan(15);
    expect(r.inspected).toBe(0);
    expect(google.calls.filter((c) => c.includes('index:inspect'))).toHaveLength(0);
  });

  it('keeps the rest of the sync when the sitemap list fails, and does not claim none was submitted', async () => {
    const { store, site, client } = setup(['sc-domain:a.com'], true);
    const r = await syncSearchConsole(store, site, client, { now: new Date('2026-11-15T08:00:00Z') });
    expect(r.inspected).toBe(2);
    const v = searchView(store, site.id, true, client.email);
    if (!v.hasData) throw new Error('no data');
    expect(v.indexing.site.map((x) => x.id)).not.toContain('sitemap-not-submitted');
  });

  it('records an explained failure when the account sees no matching property', async () => {
    const { store, site, client } = setup(['https://other.com/']);
    await expect(syncSearchConsole(store, site, client)).rejects.toThrow(/none covers https:\/\/a\.com/);
    const v = searchView(store, site.id, true, client.email);
    expect(v.hasData).toBe(false);
    expect(v.lastSync).toMatchObject({ status: 'failed' });
  });
});

describe('gsc connect', () => {
  it('stores the key with owner-only permissions', async () => {
    const { installKey } = await import('../src/server/gsc.js');
    const { statSync } = await import('node:fs');
    const home = mkdtempSync(path.join(tmpdir(), 'x-find-gsc-'));
    const file = path.join(home, 'download.json');
    writeFileSync(file, JSON.stringify(KEY));
    const r = await installKey(path.join(home, '.x-find'), file);
    expect(r.email).toBe(KEY.client_email);
    expect(statSync(r.path).mode & 0o777).toBe(0o600);
  });
});
