/**
 * Known crawlers, from each operator's own documentation (2026-11). `purpose` decides how a block is reported:
 * blocking a search crawler removes the site from that engine's results and citations (an error); blocking a training
 * crawler is a content-licensing choice (reported, not scored); user-triggered fetchers act for a person and often
 * ignore robots.txt, so x-find only reports them in the live access test.
 */

export type CrawlerPurpose = 'search' | 'training' | 'user';

export interface Crawler {
  id: string;
  /** The token used in robots.txt `User-agent:` lines. */
  token: string;
  operator: string;
  purpose: CrawlerPurpose;
  /** What it affects, in a few words. */
  affects: string;
  /** A documented user-agent string; null for robots.txt-only tokens with no crawler of their own. */
  userAgent: string | null;
  /** true when the string above is copied from the operator's docs; false when the docs only give the token. */
  userAgentDocumented: boolean;
  doc: string;
}

const GOOGLE_DOC = 'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers';
const OPENAI_DOC = 'https://developers.openai.com/api/docs/bots';
const ANTHROPIC_DOC = 'https://support.claude.com/en/articles/8896518';
const PERPLEXITY_DOC = 'https://docs.perplexity.ai/guides/bots';

export const CRAWLERS: Crawler[] = [
  {
    id: 'googlebot',
    token: 'Googlebot',
    operator: 'Google',
    purpose: 'search',
    affects: 'Google Search, including AI Overviews and AI Mode',
    userAgent:
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    userAgentDocumented: true,
    doc: GOOGLE_DOC,
  },
  {
    id: 'bingbot',
    token: 'bingbot',
    operator: 'Microsoft',
    purpose: 'search',
    affects: 'Bing, Copilot, and engines that use Bing results',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    userAgentDocumented: true,
    doc: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0',
  },
  {
    id: 'oai-searchbot',
    token: 'OAI-SearchBot',
    operator: 'OpenAI',
    purpose: 'search',
    affects: 'ChatGPT search results and citations',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot',
    userAgentDocumented: true,
    doc: OPENAI_DOC,
  },
  {
    id: 'claude-searchbot',
    token: 'Claude-SearchBot',
    operator: 'Anthropic',
    purpose: 'search',
    affects: 'Claude search results and citations',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)',
    userAgentDocumented: false,
    doc: ANTHROPIC_DOC,
  },
  {
    id: 'perplexitybot',
    token: 'PerplexityBot',
    operator: 'Perplexity',
    purpose: 'search',
    affects: 'Perplexity search results and citations',
    userAgent: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    userAgentDocumented: true,
    doc: PERPLEXITY_DOC,
  },
  {
    id: 'applebot',
    token: 'Applebot',
    operator: 'Apple',
    purpose: 'search',
    affects: 'Siri and Spotlight suggestions',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    userAgentDocumented: true,
    doc: 'https://support.apple.com/en-us/119829',
  },
  {
    id: 'chatgpt-user',
    token: 'ChatGPT-User',
    operator: 'OpenAI',
    purpose: 'user',
    affects: 'Pages fetched when a ChatGPT user asks about them',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    userAgentDocumented: true,
    doc: OPENAI_DOC,
  },
  {
    id: 'claude-user',
    token: 'Claude-User',
    operator: 'Anthropic',
    purpose: 'user',
    affects: 'Pages fetched when a Claude user asks about them',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +https://www.anthropic.com)',
    userAgentDocumented: false,
    doc: ANTHROPIC_DOC,
  },
  {
    id: 'perplexity-user',
    token: 'Perplexity-User',
    operator: 'Perplexity',
    purpose: 'user',
    affects: 'Pages fetched when a Perplexity user asks about them',
    userAgent: 'Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
    userAgentDocumented: true,
    doc: PERPLEXITY_DOC,
  },
  {
    id: 'gptbot',
    token: 'GPTBot',
    operator: 'OpenAI',
    purpose: 'training',
    affects: 'Training of OpenAI models',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
    userAgentDocumented: true,
    doc: OPENAI_DOC,
  },
  {
    id: 'claudebot',
    token: 'ClaudeBot',
    operator: 'Anthropic',
    purpose: 'training',
    affects: 'Training of Anthropic models',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    userAgentDocumented: false,
    doc: ANTHROPIC_DOC,
  },
  {
    id: 'google-extended',
    token: 'Google-Extended',
    operator: 'Google',
    purpose: 'training',
    affects: 'Gemini training and grounding (not Google Search)',
    userAgent: null,
    userAgentDocumented: false,
    doc: GOOGLE_DOC,
  },
  {
    id: 'applebot-extended',
    token: 'Applebot-Extended',
    operator: 'Apple',
    purpose: 'training',
    affects: 'Training of Apple models (not Siri or Spotlight)',
    userAgent: null,
    userAgentDocumented: false,
    doc: 'https://support.apple.com/en-us/119829',
  },
  {
    id: 'ccbot',
    token: 'CCBot',
    operator: 'Common Crawl',
    purpose: 'training',
    affects: 'The Common Crawl dataset many AI models train on',
    userAgent: 'CCBot/2.0 (https://commoncrawl.org/faq/)',
    userAgentDocumented: true,
    doc: 'https://commoncrawl.org/ccbot',
  },
  {
    id: 'meta-externalagent',
    token: 'meta-externalagent',
    operator: 'Meta',
    purpose: 'training',
    affects: 'Training of Meta AI models',
    userAgent: 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
    userAgentDocumented: true,
    doc: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers',
  },
];

export const CRAWLER_DOCS = [GOOGLE_DOC, OPENAI_DOC, ANTHROPIC_DOC, PERPLEXITY_DOC];
