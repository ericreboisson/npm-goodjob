// ---------------------------------------------------------------------------
// npm-goodjob — Dependency sanity checker
// Validates package.json consistency without external tools:
//  - peers are also in deps or devDeps
//  - no dependency listed in both deps and devDeps
//  - no "*" or "" version ranges
//  - engines.node is set
//  - drift between package.json and package-lock.json
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  buildResult,
  readPackageJson,
} from './base.js';

export const dependencySanityRunner: ToolRunner = {
  name: 'dependency-check',
  label: 'Dependency sanity',
  builtIn: true,

  isAvailable(cwd: string): boolean {
    return existsSync(resolve(cwd, 'package.json'));
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();
    const issues: Issue[] = [];

    const pkg = readPackageJson(options.projectPath);

    if (!pkg.name) {
      issues.push({
        level: 'warning',
        tool: 'dependency-check',
        category: 'configuration',
        severity: 'low',
        message: 'package.json missing "name" field',
      });
    }

  const deps = pkg.dependencies ?? {};
  const devDeps = pkg.devDependencies ?? {};
  const peerDeps = (pkg as Record<string, unknown>).peerDependencies as Record<string, string> | undefined ?? {};

    // 1. Duplicate across deps & devDeps
    for (const dep of Object.keys(deps)) {
      if (dep in devDeps) {
        issues.push({
          level: 'warning',
          tool: 'dependency-check',
          category: 'configuration',
          severity: 'low',
          message: `"${dep}" is listed in both dependencies and devDependencies`,
          package: dep,
        });
      }
    }

    // 2. Peer deps not in deps or devDeps
    for (const [dep, ver] of Object.entries(peerDeps)) {
      if (!(dep in deps) && !(dep in devDeps)) {
        issues.push({
          level: 'warning',
          tool: 'dependency-check',
          category: 'missing-dependency',
          severity: 'medium',
          message: `Peer dependency "${dep}@${ver}" is not listed in dependencies or devDependencies`,
          detail: 'Peer dependencies should also be listed as direct dependencies to avoid warnings at install time',
          package: dep,
          version: ver,
        });
      }
    }

    // 3. Forbidden version ranges
    for (const [dep, ver] of Object.entries({ ...deps, ...devDeps })) {
      if (ver === '*' || ver === '' || ver === 'latest' || ver === '^' || ver === '~') {
        issues.push({
          level: 'warning',
          tool: 'dependency-check',
          category: 'configuration',
          severity: 'low',
          message: `"${dep}" has a non-pinned version range: "${ver}"`,
          package: dep,
          version: ver,
        });
      }
    }

  // 4. Check engines.node
  const engines = pkg.engines as { node?: string } | undefined;
  if (!engines || !engines.node) {
      issues.push({
        level: 'info',
        tool: 'dependency-check',
        category: 'configuration',
        severity: 'low',
        message: 'Missing "engines.node" in package.json',
        detail: 'Specifying the minimum Node.js version helps developers avoid compatibility issues',
      });
    }

  // 5. Drift: package.json deps vs lockfile resolved versions
  checkLockfileDrift(options.projectPath, deps, devDeps, issues);

    return buildResult(
      'dependency-check',
      'Dependency sanity',
      'built-in',
      issues,
      Date.now() - start,
    );
  },
};

registerTool(dependencySanityRunner);

// ---------------------------------------------------------------------------
// Lockfile drift detection
// ---------------------------------------------------------------------------

interface LockEntry {
  version?: string;
}

function checkLockfileDrift(
  projectPath: string,
  deps: Record<string, string>,
  devDeps: Record<string, string>,
  issues: Issue[],
): void {
  const lockPath = resolve(projectPath, 'package-lock.json');
  if (!existsSync(lockPath)) return; // no lockfile, skip drift check

  let lockData: { packages?: Record<string, LockEntry> };
  try {
    lockData = JSON.parse(readFileSync(lockPath, 'utf-8'));
  } catch {
    return; // malformed lockfile, skip
  }

  const lockPkgs = lockData.packages ?? {};

  // Build name -> resolved version map from lockfile
  // Keys look like: "node_modules/express", "node_modules/@scope/bar"
  const resolvedMap = new Map<string, string>();
  for (const [key, entry] of Object.entries(lockPkgs)) {
    if (key === '' || !entry.version) continue;
    // Extract package name from path
    const name = key.replace(/^node_modules\//, '').split('/node_modules/').pop() ?? key;
    // Keep first occurrence (top-level wins for drift check)
    if (!resolvedMap.has(name)) {
      resolvedMap.set(name, entry.version);
    }
  }

  const allDeps = { ...deps, ...devDeps };

  for (const [dep, range] of Object.entries(allDeps)) {
    const resolved = resolvedMap.get(dep);
    if (!resolved) {
      // Dep declared in package.json but completely missing from lockfile
      // This can happen after merge conflicts, failed install, or manual edits
      issues.push({
        level: 'warning',
        tool: 'dependency-check',
        category: 'missing-dependency',
        severity: 'high',
        message: `"${dep}@${range}" declared in package.json but missing from package-lock.json`,
        detail: 'This indicates lockfile drift — run `npm install` to sync, or check for merge conflict residue.',
        package: dep,
        version: range,
      });
      continue;
    }

    // Check if the range actually matches the resolved version
    // Simple check: if range is exact (no ^/~), it must match exactly
    const cleanRange = range.replace(/^[\^~]/, '').replace(/\s.*$/, '');
    if (range[0] !== '^' && range[0] !== '~' && range[0] !== '>' && range[0] !== '<') {
      // Exact version range
      if (cleanRange !== resolved) {
        issues.push({
          level: 'warning',
          tool: 'dependency-check',
          category: 'quality',
          severity: 'medium',
          message: `"${dep}@${range}" in package.json resolves to v${resolved} in lockfile (version mismatch)`,
          detail: `Expected v${cleanRange}, got v${resolved}. Run npm install to sync.`,
          package: dep,
          version: resolved,
        });
      }
    }
  }
}
