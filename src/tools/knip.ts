// ---------------------------------------------------------------------------
// npm-goodjob — knip runner
// knip detects unused files, dependencies, and exports.
// Runs via npx --yes if not locally installed.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  isBinaryAvailable,
  isNpxAvailable,
  buildResult,
  skippedResult,
  runToolCommand,
  runNpxToolCommand,
  getBinaryVersion,
} from './base.js';

// ---------------------------------------------------------------------------
// knip JSON output types (subset we need)
// ---------------------------------------------------------------------------

interface KnipIssue {
  message: string;
  file?: string;
  severity?: 'error' | 'warning';
  position?: {
    line?: number;
    col?: number;
  };
  symbol?: string;
  symbolType?: string;
}

interface KnipOutput {
  files: string[];
  issues: {
    dependencies?: KnipIssue[];
    exports?: KnipIssue[];
    types?: KnipIssue[];
    files?: KnipIssue[];
    duplication?: KnipIssue[];
    unresolved?: KnipIssue[];
    [key: string]: KnipIssue[] | undefined;
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export const knipRunner: ToolRunner = {
  name: 'knip',
  label: 'knip',

  isAvailable(cwd: string): boolean {
    // knip needs a tsconfig or config to work; check existence of at least a
    // standard config file where it can auto-detect settings.
    const hasTsConfig = existsSync(resolve(cwd, 'tsconfig.json'));
    const hasConfig =
      existsSync(resolve(cwd, 'knip.json')) ||
      existsSync(resolve(cwd, '.knip.json')) ||
      existsSync(resolve(cwd, 'knip.ts'));
    if (!hasTsConfig && !hasConfig) return false;
    return isBinaryAvailable('knip', cwd) || isNpxAvailable();
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();
    const local = isBinaryAvailable('knip', options.projectPath);

    if (!local && !isNpxAvailable()) {
      return skippedResult(
        'knip',
        'knip',
        'knip is not available — install it or ensure npx works',
      );
    }

    const result = local
      ? await runToolCommand('knip', ['--reporter', 'json', '--no-exit-code', '--include-libs'], options)
      : await runNpxToolCommand('knip', ['--reporter', 'json', '--no-exit-code', '--include-libs'], options);

    if (!result) {
      return {
        tool: 'knip',
        label: 'knip',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run knip',
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      return buildResult('knip', 'knip', getBinaryVersion('knip', options.projectPath), [], Date.now() - start);
    }

    let parsed: KnipOutput;
    try {
      parsed = JSON.parse(stdout) as KnipOutput;
    } catch {
      return buildResult('knip', 'knip', getBinaryVersion('knip', options.projectPath), [], Date.now() - start);
    }

    const issues = buildKnipIssues(parsed);
    const version = getBinaryVersion('knip', options.projectPath);
    return buildResult('knip', 'knip', version, issues, Date.now() - start);
  },
};

registerTool(knipRunner);

// ---------------------------------------------------------------------------
// Issue builder
// ---------------------------------------------------------------------------

function buildKnipIssues(output: KnipOutput): Issue[] {
  const issues: Issue[] = [];

  // Unused / duplicate dependencies
  const deps = output.issues?.dependencies ?? [];
  for (const dep of deps) {
    const sev = dep.severity === 'error' ? 'high' : 'medium';
    issues.push({
      level: dep.severity === 'error' ? 'warning' : 'info',
      tool: 'knip',
      category: 'unused-dependency',
      severity: sev,
      message: dep.message,
      ...(dep.file ? { file: dep.file } : {}),
      ...(dep.symbol ? { package: dep.symbol } : {}),
    });
  }

  // Unused exports (functions, components, etc.)
  const exports_ = output.issues?.exports ?? [];
  for (const exp of exports_) {
    issues.push({
      level: 'info',
      tool: 'knip',
      category: 'dead-code',
      severity: 'low',
      message: exp.message,
      ...(exp.file ? { file: exp.file } : {}),
      ...(exp.position?.line ? { line: exp.position.line } : {}),
    });
  }

  // Unused type exports
  const types = output.issues?.types ?? [];
  for (const typ of types) {
    issues.push({
      level: 'info',
      tool: 'knip',
      category: 'dead-code',
      severity: 'low',
      message: typ.message,
      ...(typ.file ? { file: typ.file } : {}),
      ...(typ.position?.line ? { line: typ.position.line } : {}),
    });
  }

  // Unused files
  const files = output.issues?.files ?? [];
  for (const f of files) {
    issues.push({
      level: 'info',
      tool: 'knip',
      category: 'dead-code',
      severity: 'low',
      message: f.message,
      ...(f.file ? { file: f.file } : {}),
    });
  }

  // Duplicate exports
  const dup = output.issues?.duplication ?? [];
  for (const d of dup) {
    issues.push({
      level: 'info',
      tool: 'knip',
      category: 'quality',
      severity: 'low',
      message: d.message,
      ...(d.file ? { file: d.file } : {}),
    });
  }

  // Unresolved imports
  const unresolved = output.issues?.unresolved ?? [];
  for (const u of unresolved) {
    issues.push({
      level: 'warning',
      tool: 'knip',
      category: 'missing-dependency',
      severity: 'medium',
      message: u.message,
      ...(u.file ? { file: u.file } : {}),
      ...(u.position?.line ? { line: u.position.line } : {}),
    });
  }

  return issues;
}
