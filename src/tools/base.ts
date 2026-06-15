// ---------------------------------------------------------------------------
// npm-goodjob — Tool runner registry and base utilities
// ---------------------------------------------------------------------------

import { execFile, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ToolRunner, ToolResult, ToolOptions, Issue } from '../types.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, ToolRunner>();

export function registerTool(runner: ToolRunner): void {
  registry.set(runner.name, runner);
}

export function getTool(name: string): ToolRunner | undefined {
  return registry.get(name);
}

export function getAllTools(): ToolRunner[] {
  return [...registry.values()];
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

const DEBUG_PREFIX = '\x1b[2m[npm-goodjob:debug]\x1b[0m';
const VERBOSE_PREFIX = '\x1b[2m[npm-goodjob:verbose]\x1b[0m';

/**
 * Print debug log to stderr when verbose mode is enabled.
 * Prefixes with [npm-goodjob:debug] for easy filtering.
 */
export function debugLog(verbose: boolean, ...args: unknown[]): void {
  if (!verbose) return;
  process.stderr.write(`${DEBUG_PREFIX} ${args.map(a => String(a)).join(' ')}\n`);
}

/**
 * Print raw command output to stderr when verbose mode is enabled.
 */
export function verboseLog(verbose: boolean, ...args: unknown[]): void {
  if (!verbose) return;
  process.stderr.write(`${VERBOSE_PREFIX} ${args.map(a => String(a)).join(' ')}\n`);
}

// ---------------------------------------------------------------------------
// Package metadata helpers
// ---------------------------------------------------------------------------

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  private?: boolean;
  type?: string;
  workspaces?: string[] | { packages: string[] };
  engines?: { node?: string; npm?: string; [key: string]: unknown };
  main?: string;
  exports?: Record<string, unknown> | string;
  [key: string]: unknown;
}

/** Cache keyed by resolved project path so monorepo audits don't reuse stale data. */
const _pkgCache = new Map<string, PackageJson>();

export function readPackageJson(projectPath: string): PackageJson {
  const cached = _pkgCache.get(projectPath);
  if (cached) return cached;
  const p = resolve(projectPath, 'package.json');
  const pkg = existsSync(p)
    ? (JSON.parse(readFileSync(p, 'utf-8')) as PackageJson)
    : {};
  _pkgCache.set(projectPath, pkg);
  return pkg;
}

/** Clear the package.json cache — useful when auditing multiple projects. */
export function clearPackageJsonCache(): void {
  _pkgCache.clear();
}

/**
 * Get the installed version of a package from node_modules.
 */
export function getInstalledPackageVersion(packageName: string, projectPath: string): string | undefined {
  const pkgPath = resolve(projectPath, 'node_modules', packageName, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version;
  } catch {
    // Try scoped package path: @scope/name -> node_modules/@scope/name/package.json
    if (packageName.startsWith('@')) {
      const [scope, name] = packageName.split('/');
      const scopedPath = resolve(projectPath, 'node_modules', scope, name ?? '', 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(scopedPath, 'utf-8')) as { version?: string };
        return pkg.version;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Binary / module availability checks
// ---------------------------------------------------------------------------

/**
 * Check if a command-line tool is available via PATH or node_modules/.bin
 * Supports Windows (uses `where` instead of `which`, handles .cmd/.ps1 extensions).
 */
export function isBinaryAvailable(name: string, cwd: string): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    execSync(`${cmd} "${name}"`, { stdio: 'ignore' });
    return true;
  } catch {
    // not in PATH — check node_modules/.bin
    const binDir = resolve(cwd, 'node_modules', '.bin');
    if (process.platform === 'win32') {
      return (
        existsSync(resolve(binDir, `${name}.cmd`)) ||
        existsSync(resolve(binDir, `${name}.ps1`)) ||
        existsSync(resolve(binDir, `${name}.exe`)) ||
        existsSync(resolve(binDir, name))
      );
    }
    return existsSync(resolve(binDir, name));
  }
}

/**
 * Resolve the full path to a binary.
 * On Windows, node_modules/.bin shims have .cmd / .ps1 extensions that
 * execFile cannot resolve without the extension or the full path.
 * On Unix, returns the bare name (shell resolves via PATH).
 */
export function resolveBinaryPath(name: string, cwd: string): string {
  if (process.platform !== 'win32') return name;
  try {
    execSync(`where "${name}"`, { stdio: 'ignore' });
    return name;
  } catch {
    const binDir = resolve(cwd, 'node_modules', '.bin');
    for (const ext of ['.cmd', '.ps1', '.exe', '']) {
      const full = resolve(binDir, ext ? `${name}${ext}` : name);
      if (existsSync(full)) return full;
    }
    return name;
  }
}

/**
 * Check if an npm package is installed (in node_modules).
 */
export function isPackageInstalled(name: string, cwd: string): boolean {
  const pkgPath = resolve(cwd, 'node_modules', name, 'package.json');
  if (existsSync(pkgPath)) return true;
  // scoped package
  if (name.startsWith('@')) {
    const [scope, n] = name.split('/');
    return existsSync(resolve(cwd, 'node_modules', scope, n ?? '', 'package.json'));
  }
  return false;
}

/**
 * Check if npx is available on this system.
 */
export function isNpxAvailable(): boolean {
  try {
    execSync('npx --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to get the version string of a binary.
 */
export function getBinaryVersion(name: string, cwd: string): string {
  try {
    const resolved = process.platform === 'win32' ? resolveBinaryPath(name, cwd) : name;
    // execSync runs via shell; quoted path ensures spaces in path work
    const out = execSync(`"${resolved}" --version`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim().split('\n')[0] || 'N/A';
  } catch {
    return 'N/A';
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  /** Exit code of the child process. undefined when unavailable. */
  exitCode?: number;
}

/**
 * Safely run a child process. Returns null on catastrophic failure
 * (e.g. binary not found, OS error).
 */
export async function runToolCommand(
  bin: string,
  args: string[],
  options: ToolOptions,
): Promise<CommandResult | null> {
  const resolvedBin = resolveBinaryPath(bin, options.projectPath);
  const isWin = process.platform === 'win32';
  const cmdLabel = isWin ? `cmd /c ${resolvedBin}` : resolvedBin;
  debugLog(options.verbose, `exec: ${cmdLabel} ${args.join(' ')}`);
  debugLog(options.verbose, `cwd: ${options.projectPath}`);

  // On Windows, .cmd / .bat files (like npm.cmd) need shell:true so that
  // Node.js spawns them via cmd.exe instead of trying to exec them directly.
  const execOpts = {
    cwd: options.projectPath,
    encoding: 'utf-8' as const,
    maxBuffer: 10 * 1024 * 1024,
    shell: isWin,
  };

  try {
    const { stdout, stderr } = await execFileAsync(resolvedBin, args, execOpts);
    const trimmed = stdout.trim();
    debugLog(options.verbose, `[tool-exec] exit 0 — stdout ${trimmed.length} chars`);
    if (stderr) verboseLog(options.verbose, `stderr:`, stderr.slice(0, 2000));
    return { stdout: trimmed, stderr, exitCode: 0 };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'stdout' in err) {
      const e = err as { stdout: string; stderr: string; code?: string | number };
      const outTrimmed = (e.stdout ?? '').trim();
      debugLog(options.verbose, `[tool-exec] exit ${e.code ?? 1} — stdout ${outTrimmed.length} chars`);
      if (e.stderr) verboseLog(options.verbose, `stderr:`, e.stderr.slice(0, 2000));
      return { stdout: outTrimmed, stderr: e.stderr ?? '', exitCode: Number(e.code ?? 1) };
    }
    const errMsg = (err instanceof Error) ? `${err.name}: ${err.message}` : String(err);
    debugLog(options.verbose, `[tool-exec] catastrophic — ${errMsg}`);
    return null;
  }
}

/**
 * Run a tool via npx --yes with verbose logging.
 */
export async function runNpxToolCommand(
  tool: string,
  args: string[],
  options: ToolOptions,
): Promise<CommandResult | null> {
  return runToolCommand('npx', ['--yes', tool, ...args], options);
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

export function skippedResult(tool: string, label: string, reason: string): ToolResult {
  return {
    tool,
    label,
    version: 'N/A',
    status: 'skipped',
    durationMs: 0,
    issues: [],
    skipReason: reason,
  };
}

export function buildResult(
  tool: string,
  label: string,
  version: string,
  issues: Issue[],
  durationMs: number,
  errorMessage?: string,
): ToolResult {
  return {
    tool,
    label,
    version,
    status: errorMessage ? 'error' : 'success',
    durationMs,
    issues,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/**
 * Ensure a package-lock.json exists in the project directory.
 * If missing, tries to generate one via `npm install --package-lock-only`.
 * Retries with `--legacy-peer-deps` for older projects (e.g. Angular < 18).
 * Returns true if lockfile exists after the attempt.
 */
export function ensureLockfile(projectPath: string): boolean {
  const lockfilePath = resolve(projectPath, 'package-lock.json');
  if (existsSync(lockfilePath)) return true;
  if (!existsSync(resolve(projectPath, 'package.json'))) return false;

  const baseArgs = [
    'install', '--package-lock-only',
    '--ignore-scripts', '--no-audit', '--no-fund',
  ];
  try {
    execSync(`npm ${baseArgs.join(' ')}`, { cwd: projectPath, stdio: 'pipe', timeout: 60_000, encoding: 'utf-8' });
    return existsSync(lockfilePath);
  } catch {
    try {
      execSync(`npm ${baseArgs.join(' ')} --legacy-peer-deps`, { cwd: projectPath, stdio: 'pipe', timeout: 120_000, encoding: 'utf-8' });
      return existsSync(lockfilePath);
    } catch {
      return false;
    }
  }
}

export function errorResult(
  tool: string,
  label: string,
  message: string,
  durationMs: number,
): ToolResult {
  return {
    tool,
    label,
    version: 'N/A',
    status: 'error',
    durationMs,
    issues: [],
    errorMessage: message,
  };
}
