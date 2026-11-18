/**
 * Remote access guard. The dashboard is open on this computer and closed to everything else unless a password is set
 * (X_FIND_PASSWORD). "Everything else" includes requests through a tunnel or proxy (Cloudflare Tunnel, ngrok…),
 * which can rewrite the Host header to look local, so they are recognised by their forwarding headers and by the
 * socket's address, not by Host.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';

export const MIN_PASSWORD_LENGTH = 12;
const COOKIE = 'xf_session';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARDING_HEADERS = [
  'cf-ray',
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
  'forwarded',
];

/** True when the request did not come straight from this computer. */
export function isRemote(req: http.IncomingMessage): boolean {
  if (FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined)) return true;
  return !LOOPBACK.has(req.socket.remoteAddress ?? '');
}

/** Address used for rate limiting: the client behind the proxy when the proxy says so. */
export function clientIp(req: http.IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string') return cf;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/** Session value derived from the password: changing the password signs everyone out. */
export function sessionValue(password: string): string {
  return createHmac('sha256', password).update('x-find-session-v1').digest('base64url');
}

function cookie(req: http.IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hasSession(req: http.IncomingMessage, password: string): boolean {
  const v = cookie(req, COOKIE);
  return !!v && safeEqual(v, sessionValue(password));
}

export function checkPassword(given: string, password: string): boolean {
  // Compare digests so the comparison takes the same time whatever the lengths.
  const h = (s: string) => createHmac('sha256', 'x-find-login').update(s).digest('base64url');
  return safeEqual(h(given), h(password));
}

export function sessionCookie(req: http.IncomingMessage, password: string): string {
  const https =
    req.headers['x-forwarded-proto'] === 'https' || /"scheme":"https"/.test(String(req.headers['cf-visitor'] ?? ''));
  return `${COOKIE}=${sessionValue(password)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${https ? '; Secure' : ''}`;
}

/** At most `limit` failed logins per address per window. */
export class LoginLimiter {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(
    private limit = 5,
    private windowMs = 15 * 60 * 1000,
    private now: () => number = () => Date.now(),
  ) {}
  blocked(ip: string): boolean {
    const f = this.fails.get(ip);
    if (!f || f.until < this.now()) return false;
    return f.n >= this.limit;
  }
  fail(ip: string): void {
    const f = this.fails.get(ip);
    if (!f || f.until < this.now()) this.fails.set(ip, { n: 1, until: this.now() + this.windowMs });
    else f.n++;
  }
  clear(ip: string): void {
    this.fails.delete(ip);
  }
}

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>:root{color-scheme:light dark;--bg:#f4f3ef;--s:#fcfcfb;--ink:#141413;--ink2:#52514e;--line:#e4e2dc;--accent:#d9481a}
@media (prefers-color-scheme:dark){:root{--bg:#111110;--s:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--line:#2c2c29;--accent:#f06a35}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{background:var(--s);border:1px solid var(--line);border-radius:12px;padding:24px;max-width:420px;width:100%}h1{font-size:18px;margin:0 0 8px}
p{color:var(--ink2);margin:0 0 14px}input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:inherit;font:inherit}
button{margin-top:10px;width:100%;padding:9px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
code{font-size:13px}.err{color:#d03b3b}</style></head><body><main>${body}</main></body></html>`;

export function loginPage(error?: string): string {
  return page(
    'x-find · sign in',
    `<h1>x-find</h1><p>Enter the dashboard password.</p>${error ? `<p class="err">${error}</p>` : ''}
<form method="post" action="/login"><input type="password" name="password" autocomplete="current-password" aria-label="Password" required autofocus><button type="submit">Sign in</button></form>`,
  );
}

export function remoteOffPage(): string {
  return page(
    'x-find · remote access is off',
    `<h1>Remote access is off</h1><p>This dashboard was reached through a tunnel or proxy, and no password is set, so x-find refuses the request.</p>
<p>To use it remotely, create a password and restart x-find:</p><p><code>x-find password new</code></p>
<p>Or put the tunnel behind Cloudflare Access.</p>`,
  );
}

export const PASSWORD_FILE = 'dashboard-password';

/** A random password: 24 bytes, base64url (32 characters). */
export function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}
