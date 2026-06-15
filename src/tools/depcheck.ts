// ---------------------------------------------------------------------------
// npm-goodjob — depcheck runner
// Depcheck detects unused dependencies and missing dependencies.
// Supports running via npx --yes if not locally installed.
// ---------------------------------------------------------------------------

import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  isPackageInstalled,
  isBinaryAvailable,
  isNpxAvailable,
  buildResult,
  skippedResult,
  runToolCommand,
  runNpxToolCommand,
  getBinaryVersion,
} from './base.js';

// Depcheck types (subset we need)
interface DepcheckResult {
  dependencies: string[];
  devDependencies: string[];
  missing: Record<string, string[]>;
  using: Record<string, string[]>;
  invalidFiles: Record<string, string>;
  invalidDirs: Record<string, string>;
}

const DEFAULT_IGNORE_MATCHES = [
  '@angular/compiler-cli',
  '@angular-devkit/*',
  'typescript',
  'ts-node',
  'tslib',
];

export const depcheckRunner: ToolRunner = {
  name: 'depcheck',
  label: 'depcheck',

  isAvailable(cwd: string): boolean {
    return (
      isPackageInstalled('depcheck', cwd) ||
      isBinaryAvailable('depcheck', cwd) ||
      isNpxAvailable()
    );
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();

    const useNpx =
      !isBinaryAvailable('depcheck', options.projectPath) &&
      !isPackageInstalled('depcheck', options.projectPath) &&
      isNpxAvailable();

    // Programmatic API (faster) only when locally installed
    if (!useNpx && isPackageInstalled('depcheck', options.projectPath)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import('depcheck') as any;
        const depcheckFn: (path: string, opts?: Record<string, unknown>) => Promise<DepcheckResult> =
          mod.default ?? mod;
        const result = await depcheckFn(options.projectPath, {
          ignoreBinPackage: false,
          skipMissing: false,
          ignoreMatches: DEFAULT_IGNORE_MATCHES,
        });

        const issues = buildDepcheckIssues(result);
        const version = getBinaryVersion('depcheck', options.projectPath);
        return buildResult('depcheck', 'depcheck', version, issues, Date.now() - start);
      } catch (err: unknown) {
        // Fall through to CLI mode below
      }
    }

    // CLI mode (direct or via npx)
    if (!isBinaryAvailable('depcheck', options.projectPath) && !useNpx) {
      return skippedResult(
        'depcheck',
        'depcheck',
        'depcheck is not available — install it or ensure npx works',
      );
    }

    const cliArgs = ['--json'];
    cliArgs.push('--ignores', DEFAULT_IGNORE_MATCHES.join(','));

    const result = useNpx
      ? await runNpxToolCommand('depcheck', cliArgs, options)
      : await runToolCommand('depcheck', cliArgs, options);

    if (!result) {
      return {
        tool: 'depcheck',
        label: 'depcheck',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run depcheck',
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      const version = getBinaryVersion('depcheck', options.projectPath);
      return buildResult('depcheck', 'depcheck', version, [], Date.now() - start);
    }

    let parsed: DepcheckResult;
    try {
      parsed = JSON.parse(stdout) as DepcheckResult;
    } catch {
      const version = getBinaryVersion('depcheck', options.projectPath);
      return buildResult('depcheck', 'depcheck', version, [], Date.now() - start);
    }

    const issues = buildDepcheckIssues(parsed);
    const version = getBinaryVersion('depcheck', options.projectPath);
    return buildResult('depcheck', 'depcheck', version, issues, Date.now() - start);
  },
};

registerTool(depcheckRunner);

function buildDepcheckIssues(result: DepcheckResult): Issue[] {
  const issues: Issue[] = [];

  for (const dep of result.dependencies) {
    issues.push({
      level: 'warning',
      tool: 'depcheck',
      category: 'unused-dependency',
      severity: 'low',
      message: `Unused dependency: ${dep}`,
      detail: `"${dep}" is listed in dependencies but never imported/required`,
      package: dep,
    });
  }

  for (const dep of result.devDependencies) {
    issues.push({
      level: 'info',
      tool: 'depcheck',
      category: 'unused-dependency',
      severity: 'low',
      message: `Unused devDependency: ${dep}`,
      package: dep,
    });
  }

  if (result.missing && typeof result.missing === 'object') {
    for (const [dep, files] of Object.entries(result.missing)) {
      issues.push({
        level: 'error',
        tool: 'depcheck',
        category: 'missing-dependency',
        severity: 'high',
        message: `Missing dependency: ${dep}`,
        detail: `Used in: ${(files as string[]).join(', ')}`,
        package: dep,
      });
    }
  }

  return issues;
}
