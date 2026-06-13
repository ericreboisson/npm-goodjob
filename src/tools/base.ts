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
// Package metadata helpers
// ---------------------------------------------------------------------------

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

let _cachedPkg: PackageJson | null = null;

export function readPackageJson(projectPath: string): PackageJson {
  if (_cachedPkg) return _cachedPkg;
  const p = resolve(projectPath, 'package.json');
  _cachedPkg = existsSync(p)
    ? (JSON.parse(readFileSync(p, 'utf-8')) as PackageJson)
    : {};
  return _cachedPkg;
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
 */
export function isBinaryAvailable(name: string, cwd: string): boolean {
  try {
    execSync(`which "${name}"`, { stdio: 'ignore' });
    return true;
  } catch {
    // not in PATH — check node_modules/.bin
    const local = resolve(cwd, 'node_modules', '.bin', name);
    return existsSync(local);
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
 * Run a tool via npx --yes (auto-download if not installed).
 */
export async function runNpxToolCommand(
  tool: string,
  args: string[],
  options: ToolOptions,
): Promise<{ stdout: string; stderr: string } | null> {
  return runToolCommand('npx', ['--yes', tool, ...args], options);
}

/**
 * Try to get the version string of a binary.
 */
export function getBinaryVersion(name: string, cwd: string): string {
  try {
    const out = execSync(`${name} --version`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim().split('\n')[0] || 'N/A';
  } catch {
    return 'N/A';
  }
}

/**
 * Safely run a child process. Returns null on failure.
 */
export async function runToolCommand(
  bin: string,
  args: string[],
  options: ToolOptions,
): Promise<{ stdout: string; stderr: string } | null> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: options.projectPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    return { stdout, stderr };
  } catch (err: unknown) {
    // child_process errors have stdout/stderr even on non-zero exit
    if (err && typeof err === 'object' && 'stdout' in err) {
      const e = err as { stdout: string; stderr: string };
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
    return null;
  }
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
