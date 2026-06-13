// ---------------------------------------------------------------------------
// npm-goodjob — dependency-cruiser runner
// Validates architecture rules and detects circular dependencies.
// We run the text output (or --validate mode) and report violations.
// ---------------------------------------------------------------------------

import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  isBinaryAvailable,
  isNpxAvailable,
  runToolCommand,
  runNpxToolCommand,
  buildResult,
  skippedResult,
  getBinaryVersion,
} from './base.js';

export const depcruiseRunner: ToolRunner = {
  name: 'dependency-cruiser',
  label: 'dependency-cruiser',

  isAvailable(cwd: string): boolean {
    return (
      isBinaryAvailable('depcruise', cwd) ||
      isBinaryAvailable('dependency-cruiser', cwd) ||
      isNpxAvailable()
    );
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();

    const bin = isBinaryAvailable('depcruise', options.projectPath)
      ? 'depcruise'
      : 'dependency-cruiser';

    if (!this.isAvailable(options.projectPath)) {
      return skippedResult(
        'dependency-cruiser',
        'dependency-cruiser',
        'dependency-cruiser is not available — install it or ensure npx works',
      );
    }

    const useNpx =
      !isBinaryAvailable('depcruise', options.projectPath) &&
      !isBinaryAvailable('dependency-cruiser', options.projectPath) &&
      isNpxAvailable();

    const toolName = useNpx ? 'dependency-cruiser' : bin;
    const args = ['src', '--output-type', 'err-long', '--ignore-known', '--prefix', 'src'];

    const result = useNpx
      ? await runNpxToolCommand(toolName, args, options)
      : await runToolCommand(toolName, args, options);

    if (!result) {
      return {
        tool: 'dependency-cruiser',
        label: 'dependency-cruiser',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run dependency-cruiser',
      };
    }

    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const combined = `${stdout}\n${stderr}`.trim();

    if (!combined) {
      const version = useNpx ? 'via npx' : getBinaryVersion(bin, options.projectPath);
      return buildResult('dependency-cruiser', 'dependency-cruiser', version, [], Date.now() - start);
    }

    const issues: Issue[] = [];

    // Parse lines for violations and circular deps
    const lines = combined.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Circular dependency pattern: "  circular: ..."
      if (trimmed.includes('circular') || /↩|↻/.test(trimmed)) {
        issues.push({
          level: 'error',
          tool: 'dependency-cruiser',
          category: 'architecture',
          severity: 'medium',
          message: `Circular dependency: ${trimmed.replace(/^❌|^⚠|^✖/g, '').trim()}`,
          detail: 'Circular dependencies can cause maintenance issues and unexpected runtime behaviour',
        });
        continue;
      }

      // Severity-tagged lines: "error ...", "warn ...", "info ..."
      if (trimmed.startsWith('error') || trimmed.includes('✖')) {
        issues.push({
          level: 'error',
          tool: 'dependency-cruiser',
          category: 'architecture',
          severity: 'medium',
          message: trimmed.replace(/^error\s+/i, '').trim(),
        });
      } else if (trimmed.startsWith('warn') || trimmed.includes('⚠')) {
        issues.push({
          level: 'warning',
          tool: 'dependency-cruiser',
          category: 'architecture',
          severity: 'low',
          message: trimmed.replace(/^warn\s+/i, '').trim(),
        });
      }
    }

    const version = useNpx ? 'via npx' : getBinaryVersion(bin, options.projectPath);
    return buildResult('dependency-cruiser', 'dependency-cruiser', version, issues, Date.now() - start);
  },
};

registerTool(depcruiseRunner);
