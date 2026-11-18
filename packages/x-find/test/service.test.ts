import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LABEL, parseLaunchctlPrint, plist, runningAsService, serviceCommand } from '../src/server/service.js';
import type { ExecResult, ServiceEnv } from '../src/server/service.js';

const spec = (dir: string) => ({
  node: '/usr/local/bin/node',
  cli: '/opt/x-find/dist/node/cli.js',
  home: path.join(dir, 'home'),
  port: 4747,
});

/** A fake launchctl: tracks whether the agent is loaded, and records every call. */
function fakeEnv(opts: { portBusy?: boolean; bootstrapFails?: boolean; platform?: NodeJS.Platform } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'x-find-service-'));
  const calls: string[] = [];
  const lines: string[] = [];
  let loaded = false;
  const exec = (cmd: string, args: string[]): ExecResult => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (args[0] === 'print')
      return loaded
        ? {
            code: 0,
            stdout: `${LABEL} = {\n\tstate = running\n\tpid = 4242\n\tlast exit code = (never exited)\n}`,
            stderr: '',
          }
        : { code: 113, stdout: '', stderr: 'Could not find service' };
    if (args[0] === 'bootstrap') {
      if (opts.bootstrapFails) return { code: 5, stdout: '', stderr: 'Bootstrap failed: 5: Input/output error' };
      loaded = true;
    }
    if (args[0] === 'bootout') loaded = false;
    return { code: 0, stdout: '', stderr: '' };
  };
  const env: ServiceEnv = {
    platform: opts.platform ?? 'darwin',
    uid: 501,
    agentsDir: path.join(dir, 'LaunchAgents'),
    exec,
    spec: spec(dir),
    out: (l) => lines.push(l),
    portInUse: async () => (opts.portBusy ? true : loaded),
    waitMs: 0,
  };
  return { env, calls, lines, file: path.join(dir, 'LaunchAgents', `${LABEL}.plist`) };
}

describe('launchd property list', () => {
  it('starts at login, restarts if it stops, logs to the data folder, and escapes paths', () => {
    const xml = plist({ ...spec('/tmp/a&b'), xfindHome: '/tmp/a&b/home' });
    expect(xml).toContain(`<string>${LABEL}</string>`);
    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(xml).toContain('<string>/usr/local/bin/node</string>');
    expect(xml).toContain('<string>serve</string>');
    expect(xml).toContain('/tmp/a&amp;b/home/serve.log');
    expect(xml).toMatch(/<key>X_FIND_HOME<\/key>\s*<string>\/tmp\/a&amp;b\/home<\/string>/);
    expect(xml).not.toContain('X_FIND_PASSWORD');
  });

  it('reads launchctl print output', () => {
    expect(
      parseLaunchctlPrint({ code: 0, stdout: '\tstate = running\n\tpid = 12\n\tlast exit code = 0\n', stderr: '' }),
    ).toEqual({ loaded: true, running: true, pid: 12, lastExitCode: '0' });
    expect(parseLaunchctlPrint({ code: 113, stdout: '', stderr: 'x' })).toMatchObject({ loaded: false });
  });

  it('knows when this process was started by the service', () => {
    expect(runningAsService({ XPC_SERVICE_NAME: LABEL })).toBe(true);
    expect(runningAsService({ XPC_SERVICE_NAME: 'com.apple.Terminal' })).toBe(false);
  });
});

describe('x-find service', () => {
  it('installs, reports status, and uninstalls', async () => {
    const { env, calls, lines, file } = fakeEnv();
    expect(await serviceCommand('install', env)).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o644);
    expect(readFileSync(file, 'utf8')).toContain('<string>4747</string>');
    expect(calls).toContain(`launchctl bootstrap gui/501 ${file}`);
    expect(lines.join('\n')).toMatch(/runs in the background: http:\/\/127\.0\.0\.1:4747/);

    lines.length = 0;
    expect(await serviceCommand('status', env)).toBe(0);
    expect(lines.join('\n')).toMatch(/Running \(pid 4242\) on port 4747/);

    lines.length = 0;
    expect(await serviceCommand('uninstall', env)).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(calls).toContain(`launchctl bootout gui/501/${LABEL}`);
    expect(await serviceCommand('status', env)).toBe(1);
  });

  it('reinstalling replaces the running service instead of failing on the busy port', async () => {
    const { env, calls } = fakeEnv();
    await serviceCommand('install', env);
    calls.length = 0;
    expect(await serviceCommand('install', env)).toBe(0);
    expect(calls.filter((c) => c.includes('bootout'))).toHaveLength(1);
  });

  it('refuses to install while x-find serve already holds the port in a terminal', async () => {
    const { env, file } = fakeEnv({ portBusy: true });
    await expect(serviceCommand('install', env)).rejects.toThrow(/already using port 4747.*Ctrl\+C/);
    expect(existsSync(file)).toBe(false);
  });

  it('refuses to install from the npx cache, which can be deleted', async () => {
    const { env } = fakeEnv();
    env.spec.cli = '/Users/me/.npm/_npx/abc/node_modules/x-find/dist/node/cli.js';
    await expect(serviceCommand('install', env)).rejects.toThrow(/npx cache/);
  });

  it('explains a launchctl failure', async () => {
    const { env } = fakeEnv({ bootstrapFails: true });
    await expect(serviceCommand('install', env)).rejects.toThrow(/could not start the service: Bootstrap failed/);
  });

  it('gives systemd instructions instead of failing silently on Linux', async () => {
    const { env, lines, calls } = fakeEnv({ platform: 'linux' });
    expect(await serviceCommand('install', env)).toBe(1);
    expect(lines.join('\n')).toMatch(/systemd user unit/);
    expect(calls).toEqual([]);
  });
});
