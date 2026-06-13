// ---------------------------------------------------------------------------
// npm-goodjob — npm outdated checker
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  isBinaryAvailable,
  runToolCommand,
  buildResult,
  skippedResult,
  readPackageJson,
  ensureLockfile,
} from './base.js';

interface NpmOutdatedRow {
  current?: string;
  wanted: string;
  latest: string;
  location: string;
  type: 'dependencies' | 'devDependencies';
  homepage?: string;
}

/** npm outdated --json output is a Record<pkg, NpmOutdatedRow> */
type NpmOutdatedJson = Record<string, NpmOutdatedRow>;

export const npmOutdatedRunner: ToolRunner = {
  name: 'npm-outdated',
  label: 'npm outdated',

  isAvailable(cwd: string): boolean {
    return isBinaryAvailable('npm', cwd) && existsSync(resolve(cwd, 'package.json'));
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();
    const projectPath = options.projectPath;
    const pkg = readPackageJson(projectPath);

    if (!pkg.dependencies && !pkg.devDependencies) {
      return skippedResult('npm-outdated', 'npm outdated', 'No dependencies found');
    }

    // Generate lockfile if missing (required by npm outdated in newer npm versions)
    if (!existsSync(resolve(projectPath, 'package-lock.json'))) {
      ensureLockfile(projectPath);
    }

    if (!existsSync(resolve(projectPath, 'node_modules'))) {
      return skippedResult('npm-outdated', 'npm outdated', 'node_modules not found — run npm install first');
    }

    const result = await runToolCommand('npm', ['outdated', '--json', '--long'], options);

    if (!result) {
      // npm outdated exits 1 when nothing is outdated
      return buildResult('npm-outdated', 'npm outdated', 'N/A', [], Date.now() - start);
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      return buildResult('npm-outdated', 'npm outdated', 'N/A', [], Date.now() - start);
    }

    let parsed: NpmOutdatedJson;
    try {
      parsed = JSON.parse(stdout) as NpmOutdatedJson;
    } catch {
      return buildResult('npm-outdated', 'npm outdated', 'N/A', [], Date.now() - start);
    }

    const issues: Issue[] = [];
    for (const [pkgName, row] of Object.entries(parsed)) {
      if (!row.current) {
        // Package not installed — skip misleading version gap
        issues.push({
          level: 'info',
          tool: 'npm-outdated',
          category: 'outdated-dependency',
          severity: 'low',
          message: `${pkgName}: not installed — wanted ${row.wanted}, latest ${row.latest}`,
          detail: `Type: ${row.type}${row.homepage ? ` | ${row.homepage}` : ''}`,
          package: pkgName,
        });
        continue;
      }

      const majorGap = semverMajorDiff(row.current, row.latest);
      if (majorGap === null) continue;

      issues.push({
        level: majorGap >= 1 ? 'warning' : 'info',
        tool: 'npm-outdated',
        category: 'outdated-dependency',
        severity: majorGap >= 2 ? 'medium' : majorGap >= 1 ? 'low' : 'low',
        message: `${pkgName}: ${row.current} → latest ${row.latest}`,
        detail: `Wanted: ${row.wanted} | Type: ${row.type}${row.homepage ? ` | ${row.homepage}` : ''}`,
        package: pkgName,
        version: row.current,
        fixVersion: row.latest,
      });
    }

    return buildResult('npm-outdated', 'npm outdated', 'N/A', issues, Date.now() - start);
  },
};

registerTool(npmOutdatedRunner);

/** Return the major version gap between two semver strings, or null if invalid. */
function semverMajorDiff(current: string, latest: string): number | null {
  const c = parseInt(current.split('.')[0], 10);
  const l = parseInt(latest.split('.')[0], 10);
  if (isNaN(c) || isNaN(l)) return null;
  return l - c;
}
