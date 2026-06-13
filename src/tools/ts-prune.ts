// ---------------------------------------------------------------------------
// npm-goodjob — ts-prune runner
// Detects unused exports in TypeScript projects (dead code).
// Supports running via npx --yes if not locally installed.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  isBinaryAvailable,
  isPackageInstalled,
  isNpxAvailable,
  runToolCommand,
  runNpxToolCommand,
  buildResult,
  skippedResult,
  getBinaryVersion,
} from './base.js';

interface TsPruneItem {
  file: string;
  line: number;
  symbol: string;
  identifier: string;
}

export const tsPruneRunner: ToolRunner = {
  name: 'ts-prune',
  label: 'ts-prune',

  isAvailable(cwd: string): boolean {
    return (
      (isBinaryAvailable('ts-prune', cwd) || isNpxAvailable()) &&
      existsSync(resolve(cwd, 'tsconfig.json'))
    );
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();
    const tsconfigPath = resolve(options.projectPath, 'tsconfig.json');

    if (!existsSync(tsconfigPath)) {
      return skippedResult(
        'ts-prune',
        'ts-prune',
        'No tsconfig.json found — ts-prune needs a TypeScript config',
      );
    }

    if (!isPackageInstalled('typescript', options.projectPath) && !isBinaryAvailable('tsc', options.projectPath)) {
      return skippedResult(
        'ts-prune',
        'ts-prune',
        'TypeScript is not installed in this project',
      );
    }

    const useNpx = !isBinaryAvailable('ts-prune', options.projectPath) && isNpxAvailable();

    const result = useNpx
      ? await runNpxToolCommand('ts-prune', ['--json'], options)
      : await runToolCommand('ts-prune', ['--json'], options);

    if (!result) {
      return {
        tool: 'ts-prune',
        label: 'ts-prune',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run ts-prune',
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout || stdout === '[]') {
      const version = useNpx ? 'via npx' : getBinaryVersion('ts-prune', options.projectPath);
      return buildResult('ts-prune', 'ts-prune', version, [], Date.now() - start);
    }

    let items: TsPruneItem[];
    try {
      const parsed = JSON.parse(stdout);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      items = stdout
        .split('\n')
        .filter((l) => l.trim().startsWith('{'))
        .map((l) => {
          try { return JSON.parse(l) as TsPruneItem; } catch { return null; }
        })
        .filter((x): x is TsPruneItem => x !== null);
    }

    const issues: Issue[] = items.map((item) => ({
      level: 'info',
      tool: 'ts-prune',
      category: 'dead-code',
      severity: 'low',
      message: `Unused export: ${item.symbol} (${item.identifier})`,
      file: item.file,
      line: item.line,
    }));

    const version = useNpx ? 'via npx' : getBinaryVersion('ts-prune', options.projectPath);
    return buildResult('ts-prune', 'ts-prune', version, issues, Date.now() - start);
  },
};

registerTool(tsPruneRunner);
