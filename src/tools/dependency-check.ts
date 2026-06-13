// ---------------------------------------------------------------------------
// npm-goodjob — Dependency sanity checker
// Validates package.json consistency without external tools:
//  - peers are also in deps or devDeps
//  - no dependency listed in both deps and devDeps
//  - no "*" or "" version ranges
//  - engines.node is set
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
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

    // 5. Check for deprecated dependency fields
    if ('bundledDependencies' in pkg && !('bundledDependencies' in pkg === false)) {
      // this is fine, just noting it
    }

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
