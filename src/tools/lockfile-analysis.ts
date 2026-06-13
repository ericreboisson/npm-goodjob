// ---------------------------------------------------------------------------
// npm-goodjob — Lockfile analysis
// Parses package-lock.json directly (built-in, zero external deps).
// Reports: total/transitive counts, duplicate packages, staleness.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolRunner, ToolResult, ToolOptions, Issue } from '../types.js';
import { registerTool, buildResult, skippedResult } from './base.js';

interface LockfilePackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface LockfileData {
  name?: string;
  lockfileVersion?: number;
  packages?: Record<string, LockfilePackage>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Extract package name from a lockfile packages key like "node_modules/foo" or "node_modules/@scope/bar" */
function pkgNameFromPath(key: string): string {
  // Strip "node_modules/" prefix
  const parts = key.replace(/^node_modules\//, '').split('/node_modules/');
  // The package name is the first meaningful part
  const lastSegment = parts[parts.length - 1] ?? '';
  // Handle scoped packages: @scope/name
  if (lastSegment.startsWith('@')) {
    return lastSegment;
  }
  return lastSegment;
}

/** Determine nesting depth from a lockfile packages key */
function getDepth(key: string): number {
  // Count occurrences of "/node_modules/"
  const matches = key.match(/\/node_modules\//g);
  return (matches ? matches.length : 0) + (key.startsWith('node_modules/') ? 1 : 0);
}

async function analyzeLockfile(options: ToolOptions): Promise<ToolResult> {
  const start = Date.now();
  const lockPath = resolve(options.projectPath, 'package-lock.json');
  const yarnPath = resolve(options.projectPath, 'yarn.lock');
  const pnpmPath = resolve(options.projectPath, 'pnpm-lock.yaml');

  if (!existsSync(lockPath)) {
    // Check for yarn/pnpm
    const using = existsSync(yarnPath) ? 'yarn' : existsSync(pnpmPath) ? 'pnpm' : null;
    if (using) {
      return buildResult('lockfile-analysis', 'Lockfile Analysis', 'built-in', [
        {
          level: 'warning',
          tool: 'lockfile-analysis',
          category: 'configuration',
          severity: 'medium',
          message: `${using}.lock detected instead of package-lock.json`,
          detail: `Only npm's package-lock.json is currently supported. ${using === 'yarn' ? 'Consider using npm for consistent lockfile analysis.' : 'Consider using npm for consistent lockfile analysis.'}`,
        },
      ], Date.now() - start);
    }
    return skippedResult('lockfile-analysis', 'Lockfile Analysis', 'No lockfile found (package-lock.json missing)');
  }

  let data: LockfileData;
  try {
    const raw = readFileSync(lockPath, 'utf-8');
    data = JSON.parse(raw) as LockfileData;
  } catch (err) {
    return buildResult('lockfile-analysis', 'Lockfile Analysis', 'built-in', [], Date.now() - start,
      `Failed to parse package-lock.json: ${err instanceof Error ? err.message : 'Invalid JSON'}`);
  }

  const packages = data.packages ?? {};
  const pkgKeys = Object.keys(packages).filter((k) => k !== ''); // exclude root
  const totalDeps = pkgKeys.length;

  // Count top-level vs nested
  let topLevel = 0;
  let nested = 0;
  for (const key of pkgKeys) {
    const depth = getDepth(key);
    if (depth === 1) topLevel++;
    else nested++;
  }

  // Find duplicates: same package name, different resolved versions
  const versionMap = new Map<string, Map<string, { version: string; key: string }[]>>();
  const errors: Issue[] = [];

  for (const key of pkgKeys) {
    const pkg = packages[key];
    if (!pkg) continue;
    const name = pkgNameFromPath(key);
    const version = pkg.version ?? 'unknown';

    if (!versionMap.has(name)) {
      versionMap.set(name, new Map());
    }
    const verMap = versionMap.get(name)!;
    if (!verMap.has(version)) {
      verMap.set(version, []);
    }
    verMap.get(version)!.push({ version, key });
  }

  const duplicatePackages: Array<{ name: string; versions: string[] }> = [];
  for (const [name, verMap] of versionMap) {
    if (verMap.size > 1) {
      const versions = Array.from(verMap.keys()).sort();
      duplicatePackages.push({ name, versions });

      let severity: 'medium' | 'high' = 'medium';
      if (versions.length > 3) severity = 'high';

      errors.push({
        level: 'warning',
        tool: 'lockfile-analysis',
        category: 'duplicate',
        severity,
        message: `${name} has ${versions.length} different versions in the lockfile`,
        package: name,
        version: versions.join(', '),
        detail: `Versions: ${versions.join(', ')}. This increases bundle size and may cause unexpected behavior.`,
      });
    }
  }

  // Create info issue with summary
  const summaryParts = [];
  if (duplicatePackages.length > 0) {
    summaryParts.push(
      `${duplicatePackages.length} duplicate package(s) found`,
    );
  } else {
    summaryParts.push('no duplicates found');
  }

  errors.unshift({
    level: 'info',
    tool: 'lockfile-analysis',
    category: 'duplicate',
    severity: 'low',
    message: `Lockfile: ${totalDeps} total · ${topLevel} top-level · ${nested} nested · ${versionMap.size} unique`,
    detail: `${summaryParts.join(', ')}. ${duplicatePackages.map(d => `${d.name} (${d.versions.join(', ')})`).join('; ')}`,
  });

  return buildResult('lockfile-analysis', 'Lockfile Analysis', 'built-in', errors, Date.now() - start);
}

export const lockfileAnalysisRunner: ToolRunner = {
  name: 'lockfile-analysis',
  label: 'Lockfile Analysis',
  isAvailable(_cwd: string): boolean {
    return true; // built-in, always available
  },
  async run(options: ToolOptions): Promise<ToolResult> {
    return analyzeLockfile(options);
  },
};

registerTool(lockfileAnalysisRunner);
