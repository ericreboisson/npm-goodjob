// ---------------------------------------------------------------------------
// npm-goodjob — Package.json & project linter
// Built-in validation of package.json fields and common project config files
// with smart recommendations based on detected project type.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult, PkgLintConfig } from '../types.js';
import {
  registerTool,
  buildResult,
  readPackageJson,
} from './base.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PkgJson {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  author?: string | { name?: string };
  private?: boolean;
  main?: string;
  module?: string;
  browser?: string;
  bin?: string | Record<string, string>;
  exports?: Record<string, unknown>;
  types?: string;
  typings?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  keywords?: string[];
  repository?: string | { url?: string };
  homepage?: string;
  bugs?: string | { url?: string };
  [key: string]: unknown;
}

function lintScripts(pkg: PkgJson, issues: Issue[]): void {
  const scripts = pkg.scripts ?? {};
  const minExpected = ['build', 'test'];
  for (const s of minExpected) {
    if (!scripts[s]) {
      issues.push({
        level: 'info',
        tool: 'pkg-lint',
        category: 'configuration',
        severity: 'low',
        message: `Missing "${s}" script in package.json`,
        detail: s === 'build'
          ? 'A build script is needed for production deployment'
          : 'A test script should be defined even if empty (e.g. "echo \\"no tests"")',
      });
    }
  }
}

function lintEngines(pkg: PkgJson, issues: Issue[]): void {
  const engines = pkg.engines ?? {};
  if (!engines.node) {
    issues.push({
      level: 'warning',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'medium',
      message: 'Missing "engines.node" in package.json',
      detail: 'Specify the minimum Node.js version, e.g. ">=18". This helps CI/CD and other developers.',
    });
  } else {
    const ver = engines.node.replace(/[^0-9.]/g, '');
    const major = parseInt(ver.split('.')[0], 10);
    if (major < 18) {
      issues.push({
        level: 'warning',
        tool: 'pkg-lint',
        category: 'configuration',
        severity: 'high',
        message: `"engines.node" is ${engines.node} — Node 18+ recommended`,
        detail: 'Node 16 is EOL since Sep 2023. Consider upgrading to Node 18 LTS or newer.',
      });
    }
  }
}

function lintFilesExist(projectPath: string, pkg: PkgJson, issues: Issue[]): void {
  // Files referenced in package.json fields should exist
  const checkField = (field: string, value: string | undefined) => {
    if (!value) return;
    const abs = resolve(projectPath, value);
    if (!existsSync(abs)) {
      issues.push({
        level: 'warning',
        tool: 'pkg-lint',
        category: 'configuration',
        severity: 'medium',
        message: `"${field}" points to "${value}" but the file does not exist`,
        file: value,
      });
    }
  };

  checkField('main', pkg.main);
  checkField('module', pkg.module);
  checkField('browser', pkg.browser);
  checkField('types', pkg.types);
  checkField('typings', pkg.typings);

  // bin can be string or { name: path }
  if (typeof pkg.bin === 'string') {
    checkField('bin', pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === 'object') {
    for (const [k, v] of Object.entries(pkg.bin)) {
      if (typeof v === 'string') {
        const abs = resolve(projectPath, v);
        if (!existsSync(abs)) {
          issues.push({
            level: 'warning',
            tool: 'pkg-lint',
            category: 'configuration',
            severity: 'medium',
            message: `bin entry "${k}" points to "${v}" but the file does not exist`,
            file: v,
          });
        }
      }
    }
  }
}

function lintConfigFiles(projectPath: string, pkg: PkgJson, issues: Issue[]): void {
  const checks: Array<{ file: string; msg: string; level: 'info' | 'warning'; sev: 'low' | 'medium'; required: boolean }> = [
    { file: 'README.md', msg: 'Missing README.md — document your project', level: 'info', sev: 'low', required: false },
    { file: 'LICENSE', msg: 'Missing LICENSE file — specify how others can use your code', level: 'warning', sev: 'medium', required: false },
    { file: '.gitignore', msg: 'Missing .gitignore — version control exclusion list recommended', level: 'info', sev: 'low', required: false },
  ];

  // If package is public, LICENSE is more important
  if (pkg.private !== true) {
    checks.find(c => c.file === 'LICENSE')!.required = true;
  }

  // For TypeScript projects
  const hasTS = existsSync(resolve(projectPath, 'tsconfig.json'));
  if (hasTS) {
    checks.push({
      file: 'tsconfig.json',
      msg: 'Missing tsconfig.json',
      level: 'warning', sev: 'medium', required: true,
    });
  }
  if (hasTS && pkg.types && !pkg.types) {
    // types already checked above
  }

  for (const c of checks) {
    if (!existsSync(resolve(projectPath, c.file))) {
      issues.push({
        level: c.level,
        tool: 'pkg-lint',
        category: 'configuration',
        severity: c.sev,
        message: c.msg,
        file: c.file,
      });
    }
  }
}

function lintPackageJsonMetadata(pkg: PkgJson, issues: Issue[]): void {
  // Required fields
  if (!pkg.name) {
    issues.push({
      level: 'warning',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'medium',
      message: 'Missing "name" in package.json',
    });
  }
  if (!pkg.version) {
    issues.push({
      level: 'warning',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'medium',
      message: 'Missing "version" in package.json',
    });
  }
  if (!pkg.description) {
    issues.push({
      level: 'info',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'low',
      message: 'Missing "description" in package.json',
      detail: 'The description field helps others discover your package on npm',
    });
  }

  // License
  if (!pkg.license) {
    issues.push({
      level: 'info',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'low',
      message: 'Missing "license" in package.json',
      detail: 'SPDX identifier recommended, e.g. "MIT"',
    });
  }

  // Author
  if (!pkg.author) {
    issues.push({
      level: 'info',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'low',
      message: 'Missing "author" in package.json',
    });
  }

  // Repository info
  if (!pkg.repository && pkg.private !== true) {
    issues.push({
      level: 'info',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'low',
      message: 'Missing "repository" in package.json — useful for contributors',
    });
  }

  // Keywords
  if (!pkg.keywords || pkg.keywords.length === 0) {
    issues.push({
      level: 'info',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'low',
      message: 'Missing "keywords" in package.json — helps discoverability on npm',
    });
  }

  // Private packages should not publish accidentally
  if (!pkg.private) {
    issues.push({
      level: 'info',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'low',
      message: 'Package is not marked as "private": true',
      detail: 'Add "private": true for internal projects to prevent accidental npm publish',
    });
  }
}

function lintConfigSanity(pkg: PkgJson, issues: Issue[]): void {
  // Check for config inconsistencies
  if (pkg.types && pkg.typings && pkg.types !== pkg.typings) {
    issues.push({
      level: 'warning',
      tool: 'pkg-lint',
      category: 'configuration',
      severity: 'low',
      message: `"types" (${pkg.types}) and "typings" (${pkg.typings}) differ — use only "types"`,
    });
  }

  // Script sanity
  const scripts = pkg.scripts ?? {};
  for (const [name, cmd] of Object.entries(scripts)) {
    if (cmd.includes('&&') && !cmd.includes('npm-run-all') && !cmd.includes('concurrently')) {
      issues.push({
        level: 'info',
        tool: 'pkg-lint',
        category: 'quality',
        severity: 'low',
        message: `Script "${name}" uses "&&" — consider npm-run-all or concurrently for cross-platform compatibility`,
        detail: `Script: ${cmd}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config-based custom field validation
// ---------------------------------------------------------------------------

/** Resolve a dot-separated field path on an object, e.g. "publishConfig.access" */
function resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function lintCustomConfig(pkg: PkgJson, config: PkgLintConfig | undefined, issues: Issue[]): void {
  if (!config) return;

  // Custom required fields
  if (config.requireFields) {
    for (const field of config.requireFields) {
      const value = resolveFieldPath(pkg as unknown as Record<string, unknown>, field);
      if (value === undefined || value === null || value === '') {
        issues.push({
          level: 'warning',
          tool: 'pkg-lint',
          category: 'configuration',
          severity: 'medium',
          message: `Required custom field "${field}" is missing or empty in package.json`,
          detail: `Add "${field}" to meet project policy requirements.`,
        });
      }
    }
  }

  // Field pattern validation
  if (config.fieldPatterns) {
    for (const [field, pattern] of Object.entries(config.fieldPatterns)) {
      const value = resolveFieldPath(pkg as unknown as Record<string, unknown>, field);
      if (value === undefined || value === null) {
        issues.push({
          level: 'info',
          tool: 'pkg-lint',
          category: 'configuration',
          severity: 'low',
          message: `Field "${field}" is missing — cannot validate pattern "${pattern}"`,
        });
        continue;
      }
      const strVal = String(value);
      try {
        const regex = new RegExp(pattern);
        if (!regex.test(strVal)) {
          issues.push({
            level: 'warning',
            tool: 'pkg-lint',
            category: 'configuration',
            severity: 'medium',
            message: `Field "${field}" value "${strVal}" does not match required pattern "${pattern}"`,
            detail: `Expected pattern: ${pattern}`,
          });
        }
      } catch {
        issues.push({
          level: 'warning',
          tool: 'pkg-lint',
          category: 'configuration',
          severity: 'low',
          message: `Invalid regex pattern "${pattern}" for field "${field}" — check your .goodjobrc`,
        });
      }
    }
  }
}

export const pkgLintRunner: ToolRunner = {
  name: 'pkg-lint',
  label: 'Package lint',
  builtIn: true,

  isAvailable(cwd: string): boolean {
    return existsSync(resolve(cwd, 'package.json'));
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();
    const issues: Issue[] = [];
    const p = options.projectPath;

    const pkg = readPackageJson(p) as PkgJson;

    lintPackageJsonMetadata(pkg, issues);
    lintScripts(pkg, issues);
    lintEngines(pkg, issues);
    lintFilesExist(p, pkg, issues);
    lintConfigFiles(p, pkg, issues);
    lintConfigSanity(pkg, issues);
    lintCustomConfig(pkg, options.config?.pkgLint, issues);

    return buildResult('pkg-lint', 'Package lint', 'built-in', issues, Date.now() - start);
  },
};

registerTool(pkgLintRunner);
