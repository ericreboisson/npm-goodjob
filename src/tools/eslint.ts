// ---------------------------------------------------------------------------
// npm-goodjob — ESLint runner
// Runs ESLint on the whole project and maps results to unified issues.
// Falls back to a bundled default config when the project has none.
// When TypeScript is detected (tsconfig.json), installs TS-aware parser
// and plugins so .ts / .tsx files are linted too.
// ---------------------------------------------------------------------------

import { existsSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
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

const IGNORE_PATTERNS = [
  '.angular/**',
  '.cache/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  '.goodjob-*/**',
];

interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2;
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

function hasAnyConfig(cwd: string): boolean {
  const legacy = [
    '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs',
    '.eslintrc.yaml', '.eslintrc.yml',
  ];
  const flat = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'];
  return [...legacy, ...flat].some((f) => existsSync(resolve(cwd, f)));
}

function hasTypeScript(cwd: string): boolean {
  return existsSync(resolve(cwd, 'tsconfig.json'));
}

/** Install @typescript-eslint/parser + plugin into a tmp sub-dir so the
 *  generated flat config can require them. Returns the sub-dir path, or
 *  null if install failed. */
function ensureTSSupport(cwd: string): string | null {
  const depsDir = resolve(cwd, '.goodjob-tseslint');
  try {
    if (!existsSync(depsDir)) mkdirSync(depsDir, { recursive: true });
    if (!existsSync(resolve(depsDir, 'package.json'))) {
      writeFileSync(resolve(depsDir, 'package.json'), '{"private":true,"name":"gj-tseslint"}', 'utf-8');
    }
    execSync(
      'npm install --no-audit --no-fund @typescript-eslint/parser@latest @typescript-eslint/eslint-plugin@latest 2>&1',
      { cwd: depsDir, stdio: 'pipe', timeout: 120_000, encoding: 'utf-8' },
    );
    if (!existsSync(resolve(depsDir, 'node_modules/@typescript-eslint/parser/dist/index.js')) &&
        !existsSync(resolve(depsDir, 'node_modules/@typescript-eslint/parser/dist/index.cjs'))) {
      rmSync(depsDir, { recursive: true, force: true });
      return null;
    }
    return depsDir;
  } catch {
    try { rmSync(depsDir, { recursive: true, force: true }); } catch { /* ok */ }
    return null;
  }
}

function generateFlatConfig(tsDepsDir: string | null): string {
  // Ignore .goodjob-* temp configs from other parallel tools, or
  // ESLint 10.x auto-discovers them and crashes with ENOENT on cleanup.
  const globalIgnore = `{ ignores: [".goodjob-*"] }`;

  const jsBlock = `{
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ignores: [".goodjob-eslintrc.mjs"],
    rules: {
      semi: ["error", "always"],
      "no-unused-vars": "warn",
      "no-console": "warn",
      eqeqeq: ["error", "smart"],
      "no-trailing-spaces": "warn",
      "comma-dangle": ["warn", "always-multiline"],
      indent: ["warn", 2],
      quotes: ["warn", "single"],
      "no-undef": "error",
      "prefer-const": "warn",
      "no-var": "warn",
    },
  }`;

  if (!tsDepsDir) {
    return `export default [${globalIgnore},\n  ${jsBlock}];\n`;
  }

  const escapedDir = tsDepsDir.replace(/\\/g, '\\\\/');
  return `import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, "${escapedDir}/package.json"));

let tsParser, tsPlugin;
try {
  tsParser = req("@typescript-eslint/parser");
  tsPlugin = req("@typescript-eslint/eslint-plugin");
} catch { /* TS deps not ready */ }

export default [
  ${globalIgnore},
  ${jsBlock},
  ...(tsParser && tsPlugin ? [{
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [".goodjob-eslintrc.mjs"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", project: true },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      semi: ["error", "always"],
      "@typescript-eslint/no-unused-vars": "warn",
      "no-console": "warn",
      eqeqeq: ["error", "smart"],
      "no-trailing-spaces": "warn",
      "comma-dangle": ["warn", "always-multiline"],
      indent: ["warn", 2],
      quotes: ["warn", "single"],
      "prefer-const": "warn",
      "no-var": "warn",
    },
  }] : []),
];
`;
}

function getEslintMajorVersion(cwd: string): number | null {
  try {
    const out = execSync('eslint --version', { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = out.trim().match(/^v?(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
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
      return skippedResult('eslint', 'ESLint', 'eslint is not available — install it or ensure npx works');
    }

    const useNpx = !isBinaryAvailable('eslint', options.projectPath) && isNpxAvailable();
    const tempConfigPath = resolve(options.projectPath, '.goodjob-eslintrc.mjs');
    let tsDepsDir: string | null = null;
    let cmdArgs: string[];

    if (hasAnyConfig(options.projectPath)) {
      cmdArgs = ['.', '--format', 'json', '--no-color'];
    } else {
      const eslintVersion = useNpx ? null : getEslintMajorVersion(options.projectPath);
      if (eslintVersion !== null && eslintVersion < 9) {
        return skippedResult(
          'eslint', 'ESLint',
          `No ESLint configuration found and eslint v${eslintVersion} does not support auto-generated flat config — install eslint v9+ or create an eslint config file`,
        );
      }
      if (hasTypeScript(options.projectPath)) {
        tsDepsDir = ensureTSSupport(options.projectPath);
      }
      writeFileSync(tempConfigPath, generateFlatConfig(tsDepsDir), 'utf-8');
      cmdArgs = ['.', '--config', '.goodjob-eslintrc.mjs', '--format', 'json', '--no-color'];
    }

    for (const p of IGNORE_PATTERNS) {
      cmdArgs.push('--ignore-pattern', p);
    }

    const result = useNpx
      ? await runNpxToolCommand('eslint', cmdArgs, options)
      : await runToolCommand('eslint', cmdArgs, options);

    try { rmSync(tempConfigPath, { force: true }); } catch { /* ok */ }
    if (tsDepsDir) {
      try { rmSync(tsDepsDir, { recursive: true, force: true }); } catch { /* ok */ }
    }

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
    const stderr = result.stderr.trim();

    if (!stdout || stdout === '[]') {
      if (stderr && result.exitCode && result.exitCode !== 0) {
        const version = useNpx ? 'via npx' : getBinaryVersion('eslint', options.projectPath);
        const firstLine = stderr.split('\n')[0] || '';
        return {
          tool: 'eslint',
          label: 'ESLint',
          version,
          status: 'error',
          durationMs: Date.now() - start,
          issues: [],
          errorMessage: `ESLint error: ${firstLine}`,
        };
      }
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
            ? isSecurity ? 'critical' : 'medium'
            : isSecurity ? 'high' : 'low',
          message: msg.ruleId ? `${msg.ruleId}: ${msg.message}` : msg.message,
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
