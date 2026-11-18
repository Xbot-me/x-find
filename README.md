# x-find

**Can search engines and AI answer engines find, read, trust and cite your site? x-find checks, and tells you exactly what to fix.**

- **SEO**: crawling, indexing, canonicals, titles, links, sitemaps, robots.txt, structured data.
- **AEO** (answer engines: Google AI Overviews, ChatGPT search, Perplexity, Claude): can their crawlers get in, is the content in the HTML, is the page eligible to be quoted.
- **GEO** (being known as an entity): Organization and WebSite markup, logo, profiles, consistent brand name.

Every rule links to the official document it comes from ([check catalogue](docs/checks.md)). No AI, no account, no tracking. Runs in CI, on your laptop, or inside a Cloudflare Worker (the core has no Node dependencies).

## Quick start

```bash
# A live site
npx x-find check https://example.com

# Your build output, before you deploy (Astro, Next export, Hugo, Eleventy, Vite…)
npx x-find check ./dist --site https://example.com
```

```
x-find 0.1.0 · live · https://example.com · 46 pages

Readiness  SEO 96   AEO 100   GEO 66

WARNINGS (3)
  ▲ Organization logo missing or too small org-logo · GEO · 1
      /  Organization has no logo.
      Fix: Set Organization.logo to a crawlable image of at least 112×112 px …
      Source: https://developers.google.com/search/docs/appearance/structured-data/organization
```

## In CI (GitHub Actions)

```yaml
- run: npm run build
- run: npx x-find check ./dist --site https://example.com --json x-find-report.json
```

On GitHub Actions x-find writes a Markdown summary to the job page and annotates errors. Exit code `1` fails the build on errors (change with `--fail-on warning|notice|never`).

**Daily check of the live site with "what changed":**

```yaml
on:
  schedule: [{ cron: '0 6 * * *' }]
jobs:
  x-find:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/cache/restore@v4
        with: { path: baseline.json, key: x-find-baseline-${{ github.run_id }}, restore-keys: x-find-baseline- }
      - run: npx x-find check https://example.com --baseline baseline.json --json baseline.json --fail-on-regression
      - uses: actions/cache/save@v4
        if: always()
        with: { path: baseline.json, key: x-find-baseline-${{ github.run_id }} }
```

## Local dashboard (daily checks on your computer)

```bash
npx x-find sites add https://example.com --hour 6   # check daily after 06:00 local time
npx x-find serve                                    # dashboard at http://127.0.0.1:4747
npx x-find run                                      # check every site now (for cron)
```

`x-find serve` keeps a history of every check in `~/.x-find/x-find.db` (SQLite, built into Node; set `X_FIND_HOME` to move it), shows readiness over time, the to-do list with fixes, what changed since the previous check, and which search and AI crawlers can reach the site. Checks run daily while the server is on; a day missed because the computer was off runs at the next start. A check that fails (no network) is recorded and retried an hour later.

**Keep it running without a terminal (macOS).** `x-find serve` stops when its terminal closes, and so do the daily checks. Install it as a background service instead: it starts when you log in and restarts if it stops.

```bash
# Run from a fixed install (a global install or a clone of this repo), not the npx cache.
x-find service install     # stop any x-find serve running in a terminal first
x-find service status
x-find service uninstall
```

It is a launchd LaunchAgent (`~/Library/LaunchAgents/dev.xfind.serve.plist`) and logs to `~/.x-find/serve.log`. The dashboard's sidebar says whether it runs in the background or in a terminal. On Linux, `x-find service install` prints the matching systemd user unit instead.

The dashboard listens on 127.0.0.1 only. It refuses requests addressed to other host names (DNS rebinding) and writes without its own request header (CSRF).

**Remote access (Cloudflare Tunnel, ngrok, a proxy).** Requests that come through a tunnel or proxy are recognised by their forwarding headers, even when the tunnel rewrites the Host header to look local. They are refused unless you set a password; with one, they get a sign-in page (session cookie, 5 wrong tries lock an address out for 15 minutes):

```bash
npx x-find password new    # random password in ~/.x-find/dashboard-password, readable only by you
npx x-find serve
```

`X_FIND_PASSWORD` (12+ characters) overrides the stored one. `x-find password remove` turns remote access off again.

For a team, putting the tunnel's hostname behind Cloudflare Access (email login) is stronger still.

### This week: what to do next

Numbers don't bring visitors; doing the right few things does. The dashboard opens with **This week**: at most three actions, most important first, each with why (the evidence and the official document), numbered steps you can hand to a developer, who should do it, and how x-find will know it's done. `x-find week` prints the same in a terminal.

- **Order:** problems that stop search engines first, then pages that can't be reached by links from the home page, then pages to ask Google to index (the ones with the most content; never privacy or terms pages), then Search Console opportunities, then smaller fixes.
- **Stage:** where the site stands, from its own numbers: 0 getting into Google, 1 new in Google (people only find it by name), 2 showing up for other searches, 3 close to page one, 4 growing.
- **Done:** actions x-find can verify close themselves after the next check or Search Console sync; if a problem comes back, so does the action, with the reason. Advice from search numbers closes when you mark it done. "Not relevant" hides an action for good.

### Google Search Console

```bash
npx x-find gsc connect --key ~/Downloads/service-account.json
npx x-find gsc sync
```

With a service-account key (the dashboard's Connections page lists the six setup steps, about 10 minutes), every daily check also pulls:

- clicks, impressions, average position and click rate per day (16 months the first time, then the last 10 days again, since Google revises recent days);
- top searches with position change, countries, devices, for the last 28 days against the 28 before;
- indexing from URL Inspection for the pages you want in search: sitemap pages and crawled pages that aren't noindex or canonicalised elsewhere (up to 100 a day; Google allows 2,000), with a link to each page in Search Console, where "Request indexing" is;
- the submitted sitemaps and their status in Search Console;
- opportunities from fixed rules over your own numbers: searches at positions 8–20, top-10 searches with a click rate under half the site's top-10 average, and pages that lost 30% or more of their clicks.

The dashboard then opens with **how many of those pages are in Google**, above the readiness scores, because a high readiness score doesn't mean Google has indexed the pages. Missing pages are grouped by Google's own state ("Discovered – currently not indexed", "URL is unknown to Google", …) with what it means and what to do, each linking to Google's document. Next to each page, x-find shows only what it can measure: no internal links, not reachable from the home page, not in the sitemap, little text, Google chose another canonical, Google's fetch failed. It also shows site-wide facts: no sitemap submitted, sitemap errors, and how new the site is in Search Console. When nothing measurable explains a missing page, it says so instead of guessing.

The key is copied to `~/.x-find/` and readable only by you. Access is read-only (`webmasters.readonly`). Google reports countries, not cities.

Bing and site-analytics connectors are next; until they're connected, the dashboard says what's missing instead of showing numbers.

## Options

| Option                          |                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--site <url>`                  | Public URL (folder mode)                                                                          |
| `--config <file>`               | Default: `x-find.config.{mjs,js,json}`                                                            |
| `--staging`                     | Preview build that is `noindex` on purpose: don't fail for it                                     |
| `--json / --md / --html <file>` | Reports: JSON (stable schema), Markdown (PR comments), self-contained HTML (share with your team) |
| `--baseline <file>`             | Compare with an earlier `--json` report: new · fixed · still open                                 |
| `--fail-on <level>`             | `error` (default), `warning`, `notice`, `never`                                                   |
| `--fail-on-regression`          | With `--baseline`: fail if a score dropped or new errors appeared                                 |
| `--min-score <n>`               | Fail if any category scores below n                                                               |
| `--max-pages`, `--concurrency`  | Live crawl limits (500, 4)                                                                        |
| `--no-crawler-test`             | Skip requests with each AI/search crawler's user agent                                            |

`x-find init --preset full` writes a commented config. `x-find checks` lists every check with its source.

## Config

```js
// x-find.config.mjs
export default {
  site: 'https://example.com',
  trailingSlash: 'always', // 'always' | 'never' | 'ignore'
  brand: { name: 'Example Studio' }, // flags "Example Studios", "example studio"…
  ignore: ['/admin/**'],
  checks: { 'title-length': 'off', 'jsonld-review-markup': 'error' },
  rules: [/* your own checks, same shape as built-in ones */],
};
```

Overrides are printed in every report, so a score can't be quietly inflated.

## Scores

Three readiness scores (SEO, AEO, GEO), 0–100, computed only from the checks:

- Weights: error 10, warning 3. Notices are shown but never scored.
- A passing check earns its full weight. A failing check loses half its weight at once, and the rest in proportion to how much of the site fails.
- SEO is capped at 20 when the home page is `noindex` or blocked for Googlebot.
- 100 means nothing failed (scores round down).

They measure whether the site is ready to be found, **not** rankings or traffic. Checks that need a live server (status codes, redirects, crawler access) are listed as _not measured_ in folder mode, never as passed.

### What the scores can and can't tell you

Being readable by an AI crawler is not the same as being cited by an AI engine. AEO and GEO scores cover the first only.

| Question                                                      | x-find                                         |
| ------------------------------------------------------------- | ---------------------------------------------- |
| Can search and AI crawlers reach your pages?                  | Checked (robots.txt, firewall responses)       |
| Can they read the content without running scripts?            | Checked                                        |
| Is it clear who you are: name, logo, official profiles?       | Partly checked                                 |
| Are your pages in Google, and do people click them?           | Measured from Search Console, when connected   |
| Do ChatGPT, Perplexity or Google's AI answers cite your site? | **Not measured**: x-find doesn't query engines |
| Does your brand come up when people ask AI about your field?  | **Not measured**                               |

### Required, recommended, or for your information

Severity sets what a finding costs. Separately, every finding says what it means:

- **Required**: the cited source says the thing is invalid, ignored, over a limit, broken, or makes the page ineligible.
- **Recommended**: the source recommends it; nothing breaks if you don't.
- **For your information**: a policy choice or plain information.
- **Estimate**: the check infers rather than reads the answer (word counts, near-duplicate text, spelling variants,
  crawler tests from your own machine), so it can be wrong.

Each check has a version, and every report prints a **rules ID** built from them. Two reports with the same rules ID were
scored by the same rules; when it changes, a score change may come from x-find rather than your site. See
[docs/checks.md](docs/checks.md) for the label of every check.

## What it deliberately doesn't do

- Keyword density, readability grades, "SEO writing scores": no official basis.
- Treat title/description length as errors: Google sets no limit, so they're notices.
- Require `llms.txt`: Google says AI Overviews need no special files. x-find reports it as optional and validates it if present.
- Performance and accessibility audits: use Lighthouse.

It covers Lighthouse's ten SEO audits and the site-wide cross-checks of crawlers like SEOnaut and Screaming Frog, and differs on purpose: every rule cites its source, scores cover search only, and the core runs anywhere, including a Cloudflare Worker.

## Library

```ts
import { resolveConfig, runChecks, formatMarkdown } from 'x-find';
import { loadFolder, crawlLive } from 'x-find/node';

const config = resolveConfig({ site: 'https://example.com' });
const site = await loadFolder('./dist', { site: config.site, trailingSlash: config.trailingSlash });
const report = runChecks(site, config);
```

## Licence

MIT. The robots.txt tests are ported from [google/robotstxt](https://github.com/google/robotstxt) (Apache-2.0), see [NOTICE](NOTICE).
