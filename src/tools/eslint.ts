// ---------------------------------------------------------------------------
// npm-goodjob — ESLint runner
// Runs ESLint on the whole project and maps results to unified issues.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2; // 1 = warning, 2 = error
  message: string;
  line: number;
  column: number;
  filePath?: string;
}

interface LintResult {
  filePath: string;
  messages: LintMessage[];
  errorCount: number;
  warningCount: number;
}

/** Severity mapping — ESLint rules tagged as security-related */
const SECURITY_RULES = new Set([
  'no-eval',
  'no-implied-eval',
  'no-new-func',
  'no-script-url',
  'no-sync',
  'no-unsanitized/method',
  'no-unsanitized/property',
  'security/detect-object-injection',
  'security/detect-non-literal-fs-filename',
  'security/detect-non-literal-regexp',
  'security/detect-pseudoRandomBytes',
  'security/detect-possible-timing-attacks',
  'security/detect-child-process',
  'security/detect-disable-mustache-escape',
  'security/detect-eval-with-expression',
  'security/detect-no-csrf-before-method-override',
  'security/detect-non-literal-require',
  'security/detect-unsafe-regex',
  'security/detect-buffer-noassert',
]);

function isSecurityRule(ruleId: string | null): boolean {
  return ruleId !== null && SECURITY_RULES.has(ruleId);
}

export const eslintRunner: ToolRunner = {
  name: 'eslint',
  label: 'ESLint',

  isAvailable(cwd: string): boolean {
    return isBinaryAvailable('eslint', cwd) || isNpxAvailable();
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();

    if (!this.isAvailable(options.projectPath)) {
      return skippedResult(
        'eslint',
        'ESLint',
        'eslint is not available — install it or ensure npx works',
      );
    }

    // Detect config files
    const configFiles = [
      '.eslintrc',
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.yaml',
      '.eslintrc.yml',
      'eslint.config.js',
      'eslint.config.mjs',
    ];

    const hasConfig = configFiles.some((f) =>
      existsSync(resolve(options.projectPath, f)),
    );

    if (!hasConfig) {
      return skippedResult(
        'eslint',
        'ESLint',
        'No ESLint configuration found (.eslintrc* or eslint.config.*)',
      );
    }

    const useNpx = !isBinaryAvailable('eslint', options.projectPath) && isNpxAvailable();
    const cmdArgs = ['.', '--format', 'json', '--no-color'];

    const result = useNpx
      ? await runNpxToolCommand('eslint', cmdArgs, options)
      : await runToolCommand('eslint', cmdArgs, options);

    if (!result) {
      return {
        tool: 'eslint',
        label: 'ESLint',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run ESLint',
      };
    }

    const stdout = result.stdout.trim();

    if (!stdout || stdout === '[]') {
      const version = useNpx ? 'via npx' : getBinaryVersion('eslint', options.projectPath);
      return buildResult('eslint', 'ESLint', version, [], Date.now() - start);
    }

    let lintResults: LintResult[];
    try {
      const parsed = JSON.parse(stdout);
      lintResults = Array.isArray(parsed) ? parsed : (parsed as { results: LintResult[] }).results;
    } catch {
      return {
        tool: 'eslint',
        label: 'ESLint',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to parse ESLint JSON output',
      };
    }

    const issues: Issue[] = [];

    for (const fileResult of lintResults) {
      const relPath = fileResult.filePath;

      for (const msg of fileResult.messages) {
        const isSecurity = isSecurityRule(msg.ruleId);
        const isError = msg.severity === 2;

        issues.push({
          level: isError ? 'error' : 'warning',
          tool: 'eslint',
          category: isSecurity ? 'security' : 'quality',
          severity: isError
            ? isSecurity
              ? 'critical'
              : 'medium'
            : isSecurity
              ? 'high'
              : 'low',
          message: msg.ruleId
                ? `${msg.ruleId}: ${msg.message}`
                : msg.message,
          file: relPath,
          line: msg.line,
          column: msg.column,
        });
      }
    }

    const version = useNpx ? 'via npx' : getBinaryVersion('eslint', options.projectPath);
    return buildResult('eslint', 'ESLint', version, issues, Date.now() - start);
  },
};

registerTool(eslintRunner);
