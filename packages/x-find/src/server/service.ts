/**
 * `x-find service install | status | uninstall`: run the dashboard and the daily schedule as a macOS background
 * service (launchd LaunchAgent), so it starts at login and restarts after a crash instead of stopping when a terminal
 * closes. https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';

export const LABEL = 'dev.xfind.serve';

export interface ServiceSpec {
  /** Absolute path of the node binary. */
  node: string;
  /** Absolute path of x-find's cli.js. */
  cli: string;
  /** x-find's data folder; the log goes there too. */
  home: string;
  port: number;
  /** Set when X_FIND_HOME is used, so the service reads the same data. */
  xfindHome?: string | undefined;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The LaunchAgent property list: start at login, restart if it exits, log to the data folder. */
export function plist(spec: ServiceSpec): string {
  const args = [spec.node, spec.cli, 'serve', '--port', String(spec.port)];
  const log = path.join(spec.home, 'serve.log');
  const env = spec.xfindHome
    ? `
  <key>EnvironmentVariables</key>
  <dict>
    <key>X_FIND_HOME</key>
    <string>${xml(spec.xfindHome)}</string>
  </dict>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>${env}
</dict>
</plist>
`;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Exec = (cmd: string, args: string[]) => ExecResult;

export const realExec: Exec = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** What launchd says about the service, read from `launchctl print`. */
export interface LaunchdState {
  loaded: boolean;
  running: boolean;
  pid: number | null;
  lastExitCode: string | null;
}

export function parseLaunchctlPrint(r: ExecResult): LaunchdState {
  if (r.code !== 0) return { loaded: false, running: false, pid: null, lastExitCode: null };
  const state = /^\s*state = (\S+)/m.exec(r.stdout)?.[1] ?? null;
  const pid = /^\s*pid = (\d+)/m.exec(r.stdout)?.[1];
  const exit = /^\s*last exit code = (.+)$/m.exec(r.stdout)?.[1]?.trim() ?? null;
  return { loaded: true, running: state === 'running', pid: pid ? Number(pid) : null, lastExitCode: exit };
}

/** True when something accepts connections on 127.0.0.1:port. */
export function portInUse(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export interface ServiceEnv {
  platform: NodeJS.Platform;
  uid: number;
  /** ~/Library/LaunchAgents */
  agentsDir: string;
  exec: Exec;
  spec: ServiceSpec;
  out: (line: string) => void;
  portInUse: (port: number) => Promise<boolean>;
  /** Waits between health checks after starting (tests pass 0). */
  waitMs: number;
}

export function defaultServiceEnv(spec: ServiceSpec, out: (line: string) => void): ServiceEnv {
  return {
    platform: process.platform,
    uid: process.getuid?.() ?? 0,
    agentsDir: path.join(homedir(), 'Library', 'LaunchAgents'),
    exec: realExec,
    spec,
    out,
    portInUse,
    waitMs: 500,
  };
}

/** True when the current process was started by this LaunchAgent. */
export function runningAsService(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['XPC_SERVICE_NAME'] === LABEL;
}

export async function serviceCommand(action: string | undefined, env: ServiceEnv): Promise<number> {
  const { out, exec, spec } = env;
  if (env.platform !== 'darwin') {
    out('The background service is for macOS (launchd). On Linux, run `x-find serve` from a systemd user unit:');
    out(`  ExecStart=${spec.node} ${spec.cli} serve --port ${spec.port}`);
    out('  Restart=always   (in [Service]; WantedBy=default.target in [Install])');
    return 1;
  }
  const file = path.join(env.agentsDir, `${LABEL}.plist`);
  const target = `gui/${env.uid}/${LABEL}`;
  const state = () => parseLaunchctlPrint(exec('launchctl', ['print', target]));
  const url = `http://127.0.0.1:${spec.port}`;

  if (action === 'install') {
    if (/[\\/]_npx[\\/]/.test(spec.cli))
      throw new Error(
        'x-find is running from the npx cache, which can be cleaned at any time. Install it first (npm i -g x-find), then run x-find service install.',
      );
    const before = state();
    if (!before.loaded && (await env.portInUse(spec.port)))
      throw new Error(
        `Something is already using port ${spec.port}, probably x-find serve in a terminal. Stop it (Ctrl+C in that terminal), then run x-find service install again.`,
      );
    mkdirSync(env.agentsDir, { recursive: true });
    mkdirSync(spec.home, { recursive: true });
    if (before.loaded) exec('launchctl', ['bootout', target]);
    writeFileSync(file, plist(spec), { mode: 0o644 });
    const r = exec('launchctl', ['bootstrap', `gui/${env.uid}`, file]);
    if (r.code !== 0) throw new Error(`launchctl could not start the service: ${(r.stderr || r.stdout).trim()}`);
    let up = false;
    for (let i = 0; i < 20 && !up; i++) {
      if (env.waitMs) await new Promise((res) => setTimeout(res, env.waitMs));
      up = await env.portInUse(spec.port);
    }
    if (process.env['X_FIND_PASSWORD'])
      out(
        'Note: X_FIND_PASSWORD is set in this shell, but the service does not see it. Save a password with x-find password new for remote access.',
      );
    if (!up) {
      out(`Installed, but the dashboard did not answer on ${url} yet. See ${path.join(spec.home, 'serve.log')}.`);
      return 1;
    }
    out(`x-find now runs in the background: ${url}`);
    out('It starts when you log in and restarts if it stops. Daily checks keep running without a terminal.');
    out(`Log: ${path.join(spec.home, 'serve.log')} · Stop and remove: x-find service uninstall`);
    return 0;
  }

  if (action === 'uninstall') {
    const s = state();
    const installed = existsSync(file);
    if (s.loaded) exec('launchctl', ['bootout', target]);
    if (installed) unlinkSync(file);
    out(
      s.loaded || installed
        ? 'Background service stopped and removed. Run x-find serve to use the dashboard in a terminal.'
        : 'The background service is not installed.',
    );
    return 0;
  }

  if (!action || action === 'status') {
    const installed = existsSync(file);
    const s = state();
    const answering = await env.portInUse(spec.port);
    if (!installed && !s.loaded) {
      out(
        `Not installed. ${answering ? `Something answers on ${url} (probably x-find serve in a terminal).` : 'Nothing answers on that port.'}`,
      );
      out('Install: x-find service install');
      return 1;
    }
    const configured = installed
      ? /<string>--port<\/string>\s*<string>(\d+)<\/string>/.exec(readFileSync(file, 'utf8'))
      : null;
    out(`Installed: ${file}`);
    out(
      s.running
        ? `Running (pid ${s.pid})${configured ? ` on port ${configured[1]}` : ''}.`
        : `Not running${s.lastExitCode ? ` (last exit: ${s.lastExitCode})` : ''}. See ${path.join(spec.home, 'serve.log')}.`,
    );
    out(answering ? `Dashboard answers: ${url}` : `Dashboard does not answer on ${url}.`);
    return s.running && answering ? 0 : 1;
  }

  throw new Error(`unknown action "${action}" (use install, status or uninstall)`);
}
