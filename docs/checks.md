# x-find: check catalogue (v0.1)

Run `x-find checks` for the list built into your installed version.

Every check lists the document it comes from. **Scope:** `page` runs per HTML page, `site` once over the whole site,
`live` only in live mode (needs HTTP). Severities are defaults; a project can change them in config.

**Basis** says what a finding means, apart from how much it costs (severity drives the score):

- **required**: the cited source says the thing is invalid, ignored, over a limit, broken, or makes the page ineligible.
- **recommended**: the source recommends it; nothing breaks if you don't. When a source doesn't clearly state a
  requirement, the check is marked recommended.
- **info**: a policy choice or plain information.
- **(estimate)**: the check infers rather than reads the answer (word counts, near-duplicates, spelling variants,
  user-agent tests from your own machine), so it can be wrong.

Each check also has a version. Reports print a rules ID built from them: two reports with the same rules ID were scored by
the same rules. The classification lives in `packages/x-find/src/core/checks/labels.ts`.

Sources (short names used below):

| Key        | Document                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-title    | Google, Influencing title links: https://developers.google.com/search/docs/appearance/title-link                                                                                                                                                                            |
| G-snippet  | Google, Meta descriptions and snippets: https://developers.google.com/search/docs/appearance/snippet                                                                                                                                                                        |
| G-canon    | Google, Consolidate duplicate URLs: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls                                                                                                                                                  |
| G-rmeta    | Google, Robots meta tag and X-Robots-Tag: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag                                                                                                                                                       |
| G-rtxt     | Google, How Google interprets robots.txt: https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt                                                                                                                                                     |
| RFC9309    | Robots Exclusion Protocol: https://www.rfc-editor.org/rfc/rfc9309                                                                                                                                                                                                           |
| G-smap     | Google, Build and submit a sitemap: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap                                                                                                                                                      |
| G-links    | Google, Crawlable links: https://developers.google.com/search/docs/crawling-indexing/links-crawlable                                                                                                                                                                        |
| G-sd       | Google, Structured data general guidelines: https://developers.google.com/search/docs/appearance/structured-data/sd-policies                                                                                                                                                |
| G-org      | Google, Organization structured data: https://developers.google.com/search/docs/appearance/structured-data/organization                                                                                                                                                     |
| G-ai       | Google, AI features and your website: https://developers.google.com/search/docs/appearance/ai-features                                                                                                                                                                      |
| G-hreflang | Google, Localized versions: https://developers.google.com/search/docs/specialty/international/localized-versions                                                                                                                                                            |
| G-mobile   | Google, Mobile-first indexing: https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing                                                                                                                                        |
| G-http     | Google, HTTP status codes and network errors: https://developers.google.com/search/docs/crawling-indexing/http-network-errors                                                                                                                                               |
| G-js       | Google, JavaScript SEO basics: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics                                                                                                                                                 |
| G-img      | Google, Image SEO: https://developers.google.com/search/docs/appearance/google-images                                                                                                                                                                                       |
| G-spam     | Google, Spam policies: https://developers.google.com/search/docs/essentials/spam-policies                                                                                                                                                                                   |
| G-gsc-api  | Search Console API, searchanalytics.query (FAQ rich results ended 2026-05-07): https://developers.google.com/webmaster-tools/v1/searchanalytics/query                                                                                                                       |
| CLS        | web.dev, Optimize CLS (image dimensions): https://web.dev/articles/optimize-cls                                                                                                                                                                                             |
| WCAG       | WCAG 2.2, 3.1.1 Language of Page: https://www.w3.org/TR/WCAG22/#language-of-page                                                                                                                                                                                            |
| LLMS       | llms.txt proposal: https://llmstxt.org/                                                                                                                                                                                                                                     |
| BOTS       | Crawler docs: OpenAI https://developers.openai.com/api/docs/bots · Anthropic https://support.claude.com/en/articles/8896518 · Perplexity https://docs.perplexity.ai/guides/bots · Google https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers |

## SEO

| ID                          | Scope     | Severity | Basis                  | Rule                                                                                                        | Source                           |
| --------------------------- | --------- | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `title-missing`             | page      | error    | recommended            | No `<title>` or it is empty                                                                                 | G-title                          |
| `title-multiple`            | page      | warning  | recommended            | More than one `<title>`                                                                                     | G-title                          |
| `title-duplicate`           | site      | warning  | recommended            | Same title on more than one indexable page                                                                  | G-title                          |
| `title-length`              | page      | notice   | info (estimate)        | Longer than `thresholds.titleMaxChars` (default 60). Google sets no limit; long titles are truncated        | G-title                          |
| `description-missing`       | page      | warning  | recommended            | No meta description or it is empty                                                                          | G-snippet                        |
| `description-multiple`      | page      | warning  | recommended            | More than one meta description                                                                              | G-snippet                        |
| `description-duplicate`     | site      | warning  | recommended            | Same description on more than one indexable page                                                            | G-snippet                        |
| `description-length`        | page      | notice   | info (estimate)        | Longer than `thresholds.descriptionMaxChars` (default 160). Google sets no limit                            | G-snippet                        |
| `canonical-missing`         | page      | warning  | recommended            | Indexable page with no canonical                                                                            | G-canon                          |
| `canonical-multiple`        | page      | error    | required               | More than one canonical, or different targets                                                               | G-canon                          |
| `canonical-relative`        | page      | warning  | recommended            | Canonical is a relative URL                                                                                 | G-canon                          |
| `canonical-not-in-head`     | page      | error    | required               | Canonical ends up in `<body>` after HTML parsing (Google ignores it there)                                  | G-canon                          |
| `canonical-fragment`        | page      | error    | required               | Canonical contains `#`                                                                                      | G-canon                          |
| `canonical-target-bad`      | site/live | error    | required               | Canonical points to a page that is missing, redirects, errors or is `noindex`                               | G-canon                          |
| `canonical-http-on-https`   | page      | error    | recommended            | HTTPS page declares an HTTP canonical                                                                       | G-canon                          |
| `canonical-header-mismatch` | live      | error    | recommended            | `Link: rel=canonical` header and HTML canonical differ                                                      | G-canon                          |
| `robots-meta-noindex`       | page      | notice   | info                   | Page is `noindex` (escalates to `sitemap-noindex` if listed)                                                | G-rmeta                          |
| `robots-meta-invalid`       | page      | notice   | recommended            | Unknown or unparseable robots directive, or an ignored one (`noarchive`, `nocache`)                         | G-rmeta                          |
| `robots-noindex-blocked`    | site      | error    | required               | Page meant to be `noindex` is also disallowed in robots.txt, so the `noindex` is never seen                 | G-rmeta                          |
| `meta-in-body`              | page      | warning  | required               | `<meta>`/`<link>` tags that the parser moved into `<body>` (often caused by an invalid element in `<head>`) | G-canon                          |
| `viewport-missing`          | page      | warning  | recommended            | No `<meta name=viewport>`                                                                                   | G-mobile                         |
| `h1-missing`                | page      | notice   | recommended            | No `<h1>`                                                                                                   | G-title (used as a title source) |
| `link-not-crawlable`        | page      | warning  | required               | `<a>` without `href`, or `href="javascript:…"`                                                              | G-links                          |
| `link-empty-text`           | page      | warning  | recommended            | Link with no text and no image `alt`                                                                        | G-links                          |
| `link-generic-text`         | page      | notice   | recommended (estimate) | Anchor text like "click here", "read more" (list configurable)                                              | G-links                          |
| `link-broken-internal`      | site      | error    | required               | Internal link to a page that doesn't exist (folder) or returns 4xx/5xx (live)                               | G-http                           |
| `link-internal-http`        | page      | warning  | recommended            | Internal link uses `http://` on an HTTPS site                                                               | G-canon                          |
| `link-localhost`            | page      | error    | required               | Link to `localhost` / `127.0.0.1`                                                                           | G-links                          |
| `page-orphan`               | site      | warning  | recommended            | Indexable page with no internal link to it                                                                  | G-links                          |
| `img-alt-missing`           | page      | warning  | recommended            | `<img>` without `alt` (`alt=""` is fine for decoration)                                                     | G-img                            |
| `img-dimensions-missing`    | page      | notice   | recommended            | `<img>` without `width` and `height` (layout shift)                                                         | CLS                              |
| `html-lang-missing`         | page      | notice   | recommended            | No `lang` on `<html>`, or not a valid language tag                                                          | WCAG                             |
| `content-thin`              | page      | notice   | recommended (estimate) | Fewer than `thresholds.thinContentWords` words of visible text                                              | G-spam (thin content)            |
| `content-duplicate`         | site      | warning  | recommended            | Two indexable pages with identical main text                                                                | G-canon                          |
| `content-near-duplicate`    | site      | notice   | recommended (estimate) | Two pages above `thresholds.similarity` shingle overlap                                                     | G-spam (doorway)                 |
| `http-status`               | live      | error    | required               | Page returns 4xx/5xx                                                                                        | G-http                           |
| `redirect-chain`            | live      | warning  | recommended            | More than one redirect hop, or a temporary redirect for a permanent move                                    | G-http                           |
| `hreflang-invalid`          | page      | warning  | required               | Invalid language/region code, relative URL, or missing self-reference                                       | G-hreflang                       |
| `hreflang-not-reciprocal`   | site      | warning  | required               | A → B without B → A                                                                                         | G-hreflang                       |

### robots.txt and sitemap

| ID                            | Scope | Severity | Basis       | Rule                                                                                 | Source  |
| ----------------------------- | ----- | -------- | ----------- | ------------------------------------------------------------------------------------ | ------- |
| `robotstxt-missing`           | site  | notice   | info        | No robots.txt (crawling is unrestricted; the file is where the sitemap is announced) | G-rtxt  |
| `robotstxt-too-large`         | site  | error    | required    | Over 500 KiB (content after it is ignored)                                           | G-rtxt  |
| `robotstxt-invalid-line`      | site  | warning  | required    | Line that is not `field: value`, or a rule outside a group                           | RFC9309 |
| `robotstxt-unsupported-field` | site  | notice   | info        | `crawl-delay` etc.: Google ignores it (some other crawlers use it)                   | G-rtxt  |
| `robotstxt-sitemap-relative`  | site  | error    | required    | `Sitemap:` line is not an absolute URL                                               | G-rtxt  |
| `robotstxt-status`            | live  | error    | required    | robots.txt returns 5xx (Google stops crawling the site)                              | G-rtxt  |
| `sitemap-missing`             | site  | warning  | recommended | No sitemap found (robots.txt or common locations)                                    | G-smap  |
| `sitemap-invalid`             | site  | error    | required    | Not valid XML, not UTF-8, or not a urlset/sitemapindex                               | G-smap  |
| `sitemap-too-large`           | site  | error    | required    | Over 50,000 URLs or 50 MB uncompressed                                               | G-smap  |
| `sitemap-url-relative`        | site  | error    | required    | `<loc>` not an absolute URL                                                          | G-smap  |
| `sitemap-url-other-host`      | site  | warning  | required    | `<loc>` on another host                                                              | G-smap  |
| `sitemap-noindex`             | site  | error    | recommended | Listed page is `noindex`                                                             | G-smap  |
| `sitemap-non-canonical`       | site  | warning  | recommended | Listed URL canonicalises to a different URL                                          | G-canon |
| `sitemap-blocked`             | site  | error    | recommended | Listed URL is disallowed in robots.txt                                               | G-smap  |
| `sitemap-missing-page`        | site  | warning  | recommended | Indexable, canonical page not in any sitemap                                         | G-smap  |
| `sitemap-url-not-found`       | site  | error    | recommended | Listed URL doesn't exist (folder) or returns non-200 (live)                          | G-smap  |
| `sitemap-lastmod-invalid`     | site  | warning  | required    | `lastmod` not W3C datetime, or in the future                                         | G-smap  |

### Structured data

| ID                          | Scope | Severity | Basis    | Rule                                                                                          | Source    |
| --------------------------- | ----- | -------- | -------- | --------------------------------------------------------------------------------------------- | --------- |
| `jsonld-invalid`            | page  | error    | required | JSON-LD block doesn't parse                                                                   | G-sd      |
| `jsonld-missing-type`       | page  | error    | required | Item without `@context` (top level) or `@type`                                                | G-sd      |
| `jsonld-review-markup`      | page  | notice   | info     | `Review`/`AggregateRating` present: must come from real users and be visible on the page      | G-sd      |
| `jsonld-faq-no-rich-result` | page  | notice   | info     | `FAQPage` present: Google ended FAQ rich results on 2026-05-07; keep only if it helps clarity | G-gsc-api |

## AEO (answer engines)

| ID                       | Scope | Severity | Basis                  | Rule                                                                                                                                                                                | Source        |
| ------------------------ | ----- | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `ai-search-bot-blocked`  | site  | error    | required               | robots.txt disallows an AI **search** crawler (OAI-SearchBot, Claude-SearchBot, PerplexityBot) or Googlebot/Bingbot from indexable pages                                            | BOTS          |
| `ai-training-bot-policy` | site  | notice   | info                   | Reports which **training** crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot…) are allowed or blocked. Blocking them does not affect search or citations; it's the owner's choice | BOTS          |
| `crawler-ua-blocked`     | live  | error    | required (estimate)    | Home page or robots.txt returns 401/403/429 or a challenge page to a known crawler's user agent                                                                                     | BOTS          |
| `snippet-restricted`     | page  | warning  | required               | `nosnippet` or `max-snippet:0`: the page isn't snippet-eligible, so it can't be a supporting link in Google AI features. Other `max-snippet` values are reported as a notice        | G-ai, G-rmeta |
| `content-needs-js`       | page  | warning  | recommended (estimate) | Very little text in the HTML but large scripts: content may only exist after JavaScript runs                                                                                        | G-js          |
| `llmstxt-missing`        | site  | notice   | info                   | No `/llms.txt`. Google says it is not needed for AI Overviews; some AI tools read it                                                                                                | LLMS, G-ai    |
| `llmstxt-invalid`        | site  | warning  | recommended            | Present but no H1, or malformed link lists                                                                                                                                          | LLMS          |
| `llmstxt-bad-link`       | site  | warning  | recommended            | `llms.txt` links to a missing, redirected or `noindex` page                                                                                                                         | LLMS          |

## GEO (entity)

| ID                     | Scope | Severity | Basis                  | Rule                                                                                           | Source |
| ---------------------- | ----- | -------- | ---------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| `org-missing`          | site  | warning  | recommended            | No `Organization` (or subtype) on the home page                                                | G-org  |
| `org-logo`             | site  | warning  | recommended            | Organization `logo` missing, not found, or smaller than 112×112 px                             | G-org  |
| `org-sameas`           | site  | notice   | recommended            | No `sameAs` profile links                                                                      | G-org  |
| `jsonld-id-unresolved` | site  | warning  | recommended            | `@id` reference that no item on the site defines                                               | G-sd   |
| `brand-spelling`       | site  | warning  | recommended (estimate) | Text or structured data spells the brand differently from `brand.name` (case, spacing, plural) | config |
| `article-meta`         | page  | notice   | recommended            | `Article`/`BlogPosting`/`TechArticle` without `author` or `datePublished`                      | G-sd   |

## Added after comparing with other tools (Lighthouse, SEOmator, SEOnaut)

| ID                         | Category | Scope | Severity | Basis       | Rule                                                                                                                        | Source          |
| -------------------------- | -------- | ----- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `soft-404`                 | SEO      | live  | error    | required    | A made-up URL on the site returns 200 instead of 404                                                                        | G-http          |
| `host-redirect`            | SEO      | live  | warning  | recommended | `http://` doesn't permanently redirect to `https://`, or the www/non-www twin doesn't permanently redirect to the main host | G-canon         |
| `trailing-slash-duplicate` | SEO      | live  | warning  | recommended | Both `/page` and `/page/` return 200, or one redirects to the other with a temporary 302/303/307                            | G-canon, G-http |
| `url-structure`            | SEO      | page  | notice   | recommended | URL path has underscores, uppercase letters, spaces or double slashes                                                       | G-url           |
| `charset-missing`          | SEO      | page  | warning  | recommended | No `<meta charset>` in the first 1024 bytes and no charset in `Content-Type`                                                | HTML            |
| `favicon-missing`          | SEO      | site  | notice   | recommended | Home page declares no favicon                                                                                               | G-favicon       |
| `og-missing`               | SEO      | page  | notice   | recommended | No `og:title` or `og:image` (link previews in chats and social)                                                             | OGP             |
| `site-name`                | GEO      | site  | notice   | recommended | Home page has no `WebSite` structured data with `name` (Google site names)                                                  | G-sitename      |
| `robotstxt-content-signal` | AEO      | site  | warning  | recommended | `Content-Signal` line with an unknown key or value, or `ai-train=yes` while training crawlers are disallowed                | CSIG            |
| `ai-optout-directives`     | AEO      | page  | notice   | info        | Reports `noai`/`noimageai` robots directives (a policy choice; no major engine documents support)                           | G-rmeta         |

Extra sources: G-url https://developers.google.com/search/docs/crawling-indexing/url-structure ·
G-favicon https://developers.google.com/search/docs/appearance/favicon-in-search ·
G-sitename https://developers.google.com/search/docs/appearance/site-names · OGP https://ogp.me/ ·
HTML https://html.spec.whatwg.org/multipage/semantics.html#charset · CSIG https://contentsignals.org/

Lighthouse SEO audit mapping: `is-crawlable` → `robots-meta-noindex`, `ai-search-bot-blocked`; `document-title` →
`title-missing`; `meta-description` → `description-missing`; `http-status-code` → `http-status`; `link-text` →
`link-generic-text`; `crawlable-anchors` → `link-not-crawlable`; `robots-txt` → `robotstxt-*`; `image-alt` →
`img-alt-missing`; `hreflang` → `hreflang-invalid`; `canonical` → `canonical-*`; `structured-data` → `jsonld-*`.

## Deliberately not included

- Keyword density, "SEO writing score", readability grades: no official basis.
- "Answer in the first 100 words", "use question headings", "add statistics": opinions or research findings (e.g. the
  GEO paper, KDD 2024) that don't make checkable rules. A project can add them as custom rules.
- Meta keywords, `changefreq`/`priority` values: Google ignores them.
- Multiple `<h1>`: no Google document treats it as a problem.
