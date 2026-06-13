import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  isBinaryAvailable,
  runToolCommand,
  buildResult,
  skippedResult,
  getBinaryVersion,
  ensureLockfile,
} from './base.js';

interface NpmSignatureEntry {
  name: string;
  version: string;
  type: 'missing' | 'invalid';
  url?: string;
  integrity?: string;
  signature?: string;
  keyid?: string;
}

interface NpmSignaturesJson {
  invalid?: NpmSignatureEntry[];
  missing?: NpmSignatureEntry[];
  valid?: { name: string; version: string }[];
}

export const npmSignaturesRunner: ToolRunner = {
  name: 'npm-signatures',
  label: 'npm audit signatures',

  isAvailable(cwd: string): boolean {
    return isBinaryAvailable('npm', cwd) &&
      existsSync(resolve(cwd, 'package-lock.json'));
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();
    const projectPath = options.projectPath;

    if (!existsSync(resolve(projectPath, 'package-lock.json'))) {
      if (!ensureLockfile(projectPath)) {
        return skippedResult(
          'npm-signatures', 'npm audit signatures',
          'No lockfile found and could not generate one',
        );
      }
    }

    if (!existsSync(resolve(projectPath, 'node_modules'))) {
      return skippedResult(
        'npm-signatures', 'npm audit signatures',
        'node_modules not found — signatures are verified against installed packages',
      );
    }

    const result = await runToolCommand('npm', ['audit', 'signatures', '--json'], options);

    if (!result) {
      return {
        tool: 'npm-signatures',
        label: 'npm audit signatures',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run npm audit signatures',
      };
    }

    if (result.exitCode !== 0 && !result.stdout.trim()) {
      return {
        tool: 'npm-signatures',
        label: 'npm audit signatures',
        version: getBinaryVersion('npm', options.projectPath),
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: (result.stderr || 'Non-zero exit code').slice(0, 500),
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      return buildResult('npm-signatures', 'npm audit signatures', getBinaryVersion('npm', options.projectPath), [], Date.now() - start);
    }

    let parsed: NpmSignaturesJson;
    try {
      parsed = JSON.parse(stdout) as NpmSignaturesJson;
    } catch {
      return buildResult('npm-signatures', 'npm audit signatures', 'N/A', [], Date.now() - start);
    }

    const issues: Issue[] = [];
    const npmVersion = getBinaryVersion('npm', options.projectPath);

    for (const entry of parsed.invalid ?? []) {
      issues.push({
        level: 'error',
        tool: 'npm-signatures',
        category: 'security' as const,
        severity: 'critical' as const,
        message: `${entry.name}@${entry.version}: invalid signature`,
        detail: `Registry: ${entry.url ?? 'unknown'} · Key ID: ${entry.keyid ?? 'N/A'}`,
        package: entry.name,
        version: entry.version,
      });
    }

    for (const entry of parsed.missing ?? []) {
      issues.push({
        level: 'warning',
        tool: 'npm-signatures',
        category: 'security' as const,
        severity: 'high' as const,
        message: `${entry.name}@${entry.version}: missing signature`,
        detail: `No registry signature found · integrity: ${entry.integrity ?? 'N/A'}`,
        package: entry.name,
        version: entry.version,
      });
    }

    if (issues.length === 0) {
      const valid = parsed.valid ?? [];
      issues.push({
        level: 'info',
        tool: 'npm-signatures',
        category: 'security' as const,
        severity: 'low' as const,
        message: `All ${valid.length} packages have valid signatures`,
        detail: 'Every installed package has a verified registry signature.',
      });
    }

    return buildResult('npm-signatures', 'npm audit signatures', npmVersion, issues, Date.now() - start);
  },
};

registerTool(npmSignaturesRunner);
