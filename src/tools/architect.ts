// ---------------------------------------------------------------------------
// npm-goodjob — Architecture audit
// Framework-aware (Angular / React / Node) code quality and project structure
// checks. Runs fully offline — no external dependencies.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  buildResult,
  readPackageJson,
} from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Framework = 'angular' | 'react' | 'node';

interface TsConfigJson {
  compilerOptions?: {
    strict?: boolean;
    target?: string;
    module?: string;
    moduleResolution?: string;
    esModuleInterop?: boolean;
    skipLibCheck?: boolean;
    forceConsistentCasingInFileNames?: boolean;
    noUnusedLocals?: boolean;
    noUnusedParameters?: boolean;
    noImplicitReturns?: boolean;
    noFallthroughCasesInSwitch?: boolean;
    strictNullChecks?: boolean;
    outDir?: string;
    rootDir?: string;
    paths?: Record<string, string[]>;
    [key: string]: unknown;
  };
  include?: string[];
  exclude?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

function detectFramework(projectPath: string): Framework {
  const pkg = readPackageJson(projectPath);
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (allDeps['@angular/core']) return 'angular';
  if (allDeps['react'] || allDeps['next']) return 'react';
  return 'node';
}

/** Strip // and /* *\/ comments from JSONC text so JSON.parse can handle it */
function stripJsonComments(raw: string): string {
  let inString = false;
  let result = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1] ?? '';
    if (inString) {
      if (ch === '"' && raw[i - 1] !== '\\') inString = false;
      result += ch;
      i++;
      continue;
    }
    if (ch === '"') { inString = true; result += ch; i++; continue; }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      result += '\n';
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i += 2; // skip */
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Try stripping comments (JSONC)
    try {
      return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function readTsConfig(projectPath: string): TsConfigJson | null {
  const candidates = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json'];
  for (const f of candidates) {
    const fp = resolve(projectPath, f);
    if (existsSync(fp)) {
      const parsed = safeJsonParse(readFileSync(fp, 'utf-8'));
      if (parsed) return parsed as TsConfigJson;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// General checks (all frameworks)
// ---------------------------------------------------------------------------

function checkTypeScript(projectPath: string, issues: Issue[]): void {
  const tsconfig = readTsConfig(projectPath);
  const hasTypeScript = existsSync(resolve(projectPath, 'tsconfig.json'));

  if (!hasTypeScript) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'TypeScript not configured — strongly recommended for projects > 500 lines',
      detail: 'TypeScript catches entire classes of bugs at compile time.',
    });
    return;
  }

  if (!tsconfig) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'configuration',
      severity: 'high',
      message: 'tsconfig.json exists but could not be parsed',
    });
    return;
  }

  const co = tsconfig.compilerOptions ?? {};

  if (!co.strict) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'quality',
      severity: 'high',
      message: 'TypeScript strict mode is disabled ("strict": true missing)',
      detail: 'Strict mode enables strictNullChecks, noImplicitAny, and other critical checks.',
    });
  } else {
    // Check individual strict flags
    if (co.strictNullChecks === false) {
      issues.push({
        level: 'warning',
        tool: 'architect',
        category: 'quality',
        severity: 'medium',
        message: 'strictNullChecks is explicitly disabled — enable it to prevent null reference errors',
      });
    }
    if (co.noUnusedLocals !== true) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'quality',
        severity: 'low',
        message: 'Consider "noUnusedLocals": true in tsconfig — catches dead code early',
      });
    }
    if (co.noUnusedParameters !== true) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'quality',
        severity: 'low',
        message: 'Consider "noUnusedParameters": true in tsconfig',
      });
    }
    if (co.noImplicitReturns !== true) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'quality',
        severity: 'low',
        message: 'Consider "noImplicitReturns": true in tsconfig — ensures all code paths return a value',
      });
    }
    if (co.skipLibCheck === true) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'quality',
        severity: 'low',
        message: '"skipLibCheck": true hides type errors in .d.ts files — disable it periodically',
      });
    }
  }

  // Target level
  if (co.target && ['es5', 'es2015', 'es2016', 'es2017', 'es2018', 'es2019'].includes(co.target)) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'quality',
      severity: 'low',
      message: `TypeScript target "${co.target}" is outdated — consider "ES2022" or "ESNext"`,
      detail: 'Modern browsers and Node 18+ support ES2022 features without transpilation.',
    });
  }

  // outDir/rootDir
  if (co.outDir && co.rootDir && co.outDir === co.rootDir) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'configuration',
      severity: 'medium',
      message: 'TypeScript outDir and rootDir are the same — risk of overwriting source files',
    });
  }
}

function checkTesting(projectPath: string, issues: Issue[]): void {
  const pkg = readPackageJson(projectPath);
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const hasTest = Object.keys(allDeps).some(d =>
    d.includes('jest') || d.includes('vitest') || d.includes('mocha') ||
    d.includes('jasmine') || d.includes('karma') || d.includes('playwright') ||
    d.includes('cypress') || d.includes('web-test-runner') || d.includes('uvu'),
  );
  const scripts = pkg.scripts ?? {};
  const hasTestScript = scripts.test && scripts.test !== 'echo "Error: no test specified"';

  if (!hasTest && !hasTestScript) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'configuration',
      severity: 'medium',
      message: 'No testing framework detected — add tests for production projects',
      detail: 'Consider Jest, Vitest, or a framework-specific testing tool.',
    });
  } else if (!hasTestScript) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'Testing framework found but no "test" script in package.json',
    });
  }

  // Check for coverage config
  if (!scripts['test:coverage'] && !scripts['test:cov']) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'No test coverage script — consider adding "test:coverage" script',
    });
  }
}

function checkEnvironment(projectPath: string, issues: Issue[]): void {
  const hasDotEnv = existsSync(resolve(projectPath, '.env'));
  const hasDotEnvExample = existsSync(resolve(projectPath, '.env.example'));
  const hasDotEnvLocal = existsSync(resolve(projectPath, '.env.local'));

  if (!hasDotEnv && !hasDotEnvExample) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'No .env or .env.example file — consider adding environment configuration docs',
    });
  } else if (hasDotEnv && !hasDotEnvExample) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: '.env found but no .env.example — add one to document required env vars',
    });
  } else if (hasDotEnvLocal && !hasDotEnv) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: '.env.local found but no .env — should .env be committed?',
    });
  }
}

function checkCiCd(projectPath: string, issues: Issue[]): void {
  const dotGithub = resolve(projectPath, '.github');
  const workflows = resolve(dotGithub, 'workflows');
  const hasGithubCI = existsSync(workflows) && readdirSync(workflows).some(f => f.endsWith('.yml') || f.endsWith('.yaml'));

  if (!hasGithubCI) {
    // Check for other CI providers
    const otherCI = [
      '.gitlab-ci.yml', '.gitlab-ci.yaml',
      'Jenkinsfile',
      '.circleci/config.yml',
      'azure-pipelines.yml',
      '.drone.yml',
      '.woodpecker.yml',
    ].some(f => existsSync(resolve(projectPath, f)));

    if (!otherCI) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'configuration',
        severity: 'low',
        message: 'No CI/CD configuration detected (GitHub Actions, GitLab CI, Jenkins, etc.)',
        detail: 'CI/CD runs automated checks on every commit, catching regressions early.',
      });
    }
  }

  // Check for Dependabot / Renovate
  const dependabotConfig = resolve(projectPath, '.github', 'dependabot.yml');
  const renovateConfig = existsSync(resolve(projectPath, 'renovate.json')) ||
    existsSync(resolve(projectPath, '.renovaterc')) ||
    existsSync(resolve(projectPath, '.renovaterc.json'));

  if (!existsSync(dependabotConfig) && !renovateConfig) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'No Dependabot or Renovate config — automated dependency updates not configured',
      detail: 'Automated dependency updates help keep your project secure with minimal effort.',
    });
  }
}

function checkGitConfig(projectPath: string, issues: Issue[]): void {
  // Check if .git directory exists
  if (!existsSync(resolve(projectPath, '.git'))) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'Not a git repository — version control strongly recommended',
    });
    return;
  }

  // Check for pre-commit hooks
  const hasHusky = existsSync(resolve(projectPath, '.husky'));
  const hasSimpleGitHooks = existsSync(resolve(projectPath, '.simple-git-hooks'));

  if (!hasHusky && !hasSimpleGitHooks) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'No pre-commit hooks (husky, simple-git-hooks) — consider adding them for lint-staged',
    });
  }
}

function checkEditorConfig(projectPath: string, issues: Issue[]): void {
  if (!existsSync(resolve(projectPath, '.editorconfig'))) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'Missing .editorconfig — ensures consistent formatting across editors',
    });
  }

  if (!existsSync(resolve(projectPath, '.nvmrc')) && !existsSync(resolve(projectPath, '.node-version'))) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'Missing .nvmrc or .node-version — helps teams use the same Node version',
    });
  }
}

function checkPackageJson(projectPath: string, issues: Issue[]): void {
  const pkg = readPackageJson(projectPath);
  if (!pkg) return;

  if (!pkg.engines?.node) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'No "engines.node" in package.json — declare minimum Node version for your team',
      detail: 'Use "engines": { "node": ">=20" } to prevent accidental installs on unsupported Node versions.',
    });
    } else {
      const nvmrcPath = resolve(projectPath, '.nvmrc');
      const nodeVersionPath = resolve(projectPath, '.node-version');
      if (existsSync(nvmrcPath) || existsSync(nodeVersionPath)) {
        const nvFile = existsSync(nvmrcPath) ? nvmrcPath : nodeVersionPath;
        const nvContent = readFileSync(nvFile, 'utf-8').trim();
        const engineNode = typeof pkg.engines.node === 'string' ? pkg.engines.node : '';
        // Flag only when versions are explicitly contradictory (e.g. .nvmrc=18, engines=>=20)
        const nvMajor = nvContent.replace(/^v/, '').split('.')[0];
        const engineMajorMatch = engineNode.match(/>=\s*(\d+)/);
      if (nvMajor && engineMajorMatch && parseInt(engineMajorMatch[1], 10) > parseInt(nvMajor, 10)) {
        issues.push({
          level: 'warning',
          tool: 'architect',
          category: 'configuration',
          severity: 'medium',
          message: `engines.node requires Node >=${engineMajorMatch[1]} but .nvmrc specifies v${nvMajor}`,
          detail: `File: ${nvFile.replace(projectPath + '/', '')}. Update one to match the other.`,
        });
      }
    }
  }

  const workspaces = pkg.workspaces;
  if (workspaces && !pkg.private) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'configuration',
      severity: 'medium',
      message: 'Workspace root should have "private": true to prevent accidental npm publish',
      detail: 'Setting "private": true on the root package.json prevents publishing the entire workspace to npm.',
    });
  }

  const scripts = pkg.scripts ?? {};
  const recommended = ['build', 'start', 'lint', 'test'];
  if (workspaces) {
    return;
  }
  const missingScripts = recommended.filter(s => !scripts[s]);
  if (missingScripts.length === recommended.length) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'No common scripts found — consider adding build, start, lint, test scripts',
    });
  } else if (missingScripts.length > 2) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: `Missing recommended scripts: ${missingScripts.join(', ')}`,
    });
  }
}

function checkDocumentation(projectPath: string, issues: Issue[]): void {
  const readmePath = resolve(projectPath, 'README.md');
  if (!existsSync(readmePath)) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'Missing README.md — helps newcomers understand the project',
    });
  } else {
    const content = readFileSync(readmePath, 'utf-8').trim();
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length <= 2 || content.toLowerCase().includes('# readme') && lines.length < 5) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'quality',
        severity: 'low',
        message: 'README.md appears to be the default template — add project-specific documentation',
      });
    }
  }

  if (!existsSync(resolve(projectPath, 'LICENSE'))) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'license',
      severity: 'low',
      message: 'Missing LICENSE file — specify license terms for your project',
    });
  }

  const changelog = ['CHANGELOG.md', 'CHANGELOG', 'CHANGES.md'].some(f =>
    existsSync(resolve(projectPath, f)));
  if (!changelog) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'quality',
      severity: 'low',
      message: 'No CHANGELOG — consider documenting notable changes per version',
    });
  }
}

function checkGitignore(projectPath: string, issues: Issue[]): void {
  const gitignorePath = resolve(projectPath, '.gitignore');
  if (!existsSync(gitignorePath)) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: 'Missing .gitignore — generated files and secrets may be committed',
    });
    return;
  }

  const content = readFileSync(gitignorePath, 'utf-8');
  const commonEntries = [
    { entry: 'node_modules', label: 'node_modules/' },
    { entry: 'dist', label: 'build output directories (dist/)' },
    { entry: '.env', label: '.env files' },
    { entry: 'coverage', label: 'coverage/' },
  ];
  const missing = commonEntries.filter(({ entry }) => !content.includes(entry));
  if (missing.length > 0) {
    const labels = missing.map(m => m.label).join(', ');
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'configuration',
      severity: 'low',
      message: `.gitignore missing entries for: ${labels}`,
    });
  }
}

function checkSourceMaps(projectPath: string, issues: Issue[]): void {
  const pkg = readPackageJson(projectPath);
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  const angularJsonPath = resolve(projectPath, 'angular.json');
  if (existsSync(angularJsonPath)) {
    try {
      const angularJson = safeJsonParse(readFileSync(angularJsonPath, 'utf-8')) as Record<string, unknown>;
      if (angularJson) {
        const projects = angularJson.projects as Record<string, unknown> ?? {};
        for (const [projName, proj] of Object.entries(projects)) {
          const arch = (proj as Record<string, unknown>)?.architect as Record<string, unknown> ?? {};
          const build = arch?.build as Record<string, unknown> ?? {};
          const configs = build?.configurations as Record<string, unknown> ?? {};
          for (const cfgName of ['production', 'prod']) {
            const cfg = configs[cfgName] as Record<string, unknown> ?? {};
            const sourceMap = cfg.sourceMap;
            if (sourceMap === true || sourceMap === 'true') {
              issues.push({
                level: 'warning',
                tool: 'architect',
                category: 'security',
                severity: 'medium',
                message: `Source maps enabled in angular.json "${projName}" production config — exposes source code in production`,
                detail: 'Disable source maps in production builds to prevent source code exposure.',
              });
            } else if (sourceMap !== undefined && sourceMap !== false && sourceMap !== 'false') {
              issues.push({
                level: 'info',
                tool: 'architect',
                category: 'security',
                severity: 'low',
                message: `Source map config in angular.json "${projName}" production is not fully disabled`,
              });
            }
          }
        }
      }
    } catch {
    }
  }

  if (allDeps['react-scripts']) {
    const envFiles = ['.env', '.env.production', '.env.local'];
    let hasSourceMapDisabled = false;
    for (const ef of envFiles) {
      const efPath = resolve(projectPath, ef);
      if (existsSync(efPath)) {
        const envContent = readFileSync(efPath, 'utf-8');
        if (envContent.includes('GENERATE_SOURCEMAP=false')) {
          hasSourceMapDisabled = true;
          break;
        }
      }
    }
    if (!hasSourceMapDisabled) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'security',
        severity: 'low',
        message: 'GENERATE_SOURCEMAP not disabled in production — source maps may be deployed',
        detail: 'Add GENERATE_SOURCEMAP=false to .env.production to prevent source code exposure.',
      });
    }
  }
}

function checkDocker(projectPath: string, issues: Issue[]): void {
  const hasDockerfile = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile.dockerignore']
    .some(f => existsSync(resolve(projectPath, f)));

  const pkg = readPackageJson(projectPath);
  const hasDeployScript = pkg.scripts?.deploy || pkg.scripts?.docker || pkg.scripts?.['docker:build'];

  if (hasDockerfile || hasDeployScript) {
    const dockerfile = resolve(projectPath, 'Dockerfile');
    if (existsSync(dockerfile)) {
      const content = readFileSync(dockerfile, 'utf-8');
      const fromCount = (content.match(/^FROM /mi) || []).length;
      if (fromCount === 1) {
        issues.push({
          level: 'info',
          tool: 'architect',
          category: 'quality',
          severity: 'low',
          message: 'Dockerfile uses a single-stage build — consider multi-stage for smaller production images',
        });
      }
      if (!existsSync(resolve(projectPath, '.dockerignore'))) {
        issues.push({
          level: 'info',
          tool: 'architect',
          category: 'configuration',
          severity: 'low',
          message: 'Missing .dockerignore — large files may unnecessarily increase build context',
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module type consistency (ESM / CJS)
// ---------------------------------------------------------------------------

function checkModuleType(projectPath: string, issues: Issue[]): void {
  const srcDir = resolve(projectPath, 'src');
  if (existsSync(srcDir)) {
    let hasMjs = false;
    let hasCjs = false;
    try {
      const files = readdirSync(srcDir, { recursive: true } as { recursive?: boolean });
      for (const f of files as string[]) {
        if (f.endsWith('.mjs')) hasMjs = true;
        if (f.endsWith('.cjs')) hasCjs = true;
        if (hasMjs && hasCjs) break;
      }
    } catch {
    }

    if (hasMjs && hasCjs) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'quality',
        severity: 'low',
        message: 'Mixed .mjs and .cjs files found — verify ESM/CJS boundary is intentional',
        detail: 'Having both module types can cause confusion. Consider standardizing on one module system.',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Angular-specific checks
// ---------------------------------------------------------------------------

function checkAngular(projectPath: string, issues: Issue[]): void {
  const pkg = readPackageJson(projectPath);
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const angularVersion = allDeps['@angular/core'] ?? '';
  const major = parseInt(angularVersion.replace(/[^0-9]/g, '').charAt(0) || '0', 10);

  // Version support
  if (major > 0) {
    if (major < 15) {
      issues.push({
        level: 'warning',
        tool: 'architect',
        category: 'quality',
        severity: 'high',
        message: `Angular v${major} is outdated — upgrade to a supported version (v18+)`,
        detail: `Detected @angular/core@${angularVersion}. Angular v${major} is no longer in LTS.`,
      });
    } else if (major < 17) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'quality',
        severity: 'medium',
        message: `Angular v${major} — consider upgrading to v18+ for latest features and performance`,
        detail: `Detected @angular/core@${angularVersion}. Angular 17+ introduces significant improvements.`,
      });
    }

    if (major >= 17) {
      // Check for standalone bootstrap (Angular 17+)
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'quality',
        severity: 'low',
        message: `Angular v${major} supports standalone components — consider migrating from NgModules`,
        detail: 'Standalone components simplify your project by removing NgModule boilerplate.',
      });
    }

    // Check for zone.js
    if (!allDeps['zone.js']) {
      issues.push({
        level: 'warning',
        tool: 'architect',
        category: 'missing-dependency',
        severity: 'high',
        message: 'Angular project missing zone.js — required for change detection',
      });
    }
  }

  // Angular CLI config
  const angularJson = resolve(projectPath, 'angular.json');
  if (!existsSync(angularJson)) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'configuration',
      severity: 'medium',
      message: 'Missing angular.json — Angular CLI configuration required',
    });
  }

  // Check for server-side rendering config
  if (existsSync(resolve(projectPath, 'server.ts'))) {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'quality',
      severity: 'low',
      message: 'Angular Universal (SSR) detected — ensure SSR bundle is optimized',
    });
  }
}

// ---------------------------------------------------------------------------
// React-specific checks
// ---------------------------------------------------------------------------

function checkReact(projectPath: string, issues: Issue[]): void {
  const pkg = readPackageJson(projectPath);
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const reactVersion = allDeps['react'] ?? '';
  const major = parseInt(reactVersion.replace(/[^0-9]/g, '').charAt(0) || '0', 10);

  // Version
  if (major > 0 && major < 18) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'quality',
      severity: 'high',
      message: `React v${major} is outdated — upgrade to React 18+`,
      detail: 'React 18 introduces concurrent rendering, automatic batching, and useId.',
    });
  }

  // Check for react-dom
  if (!allDeps['react-dom']) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'missing-dependency',
      severity: 'medium',
      message: 'react-dom not found — required for web rendering',
    });
  }

  // Check TypeScript types
  if (allDeps['typescript'] && !allDeps['@types/react']) {
    issues.push({
      level: 'warning',
      tool: 'architect',
      category: 'missing-dependency',
      severity: 'medium',
      message: 'TypeScript project missing @types/react — type errors will be missed',
    });
  }

  // Check for ESLint hooks plugin
  if (allDeps['eslint']) {
    const hasHooksPlugin = allDeps['eslint-plugin-react-hooks'] || allDeps['@eslint-react/eslint-plugin'];
    if (!hasHooksPlugin) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'configuration',
        severity: 'medium',
        message: 'eslint-plugin-react-hooks not installed — recommended to catch hooks rule violations',
        detail: 'Rules of Hooks are enforced at lint time with this plugin.',
      });
    }
  }

  // Check for JSX transform (React 17+)
  const tsconfig = readTsConfig(projectPath);
  if (tsconfig?.compilerOptions?.jsx && tsconfig.compilerOptions.jsx !== 'react-jsx' &&
      tsconfig.compilerOptions.jsx !== 'react-jsxdev') {
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'quality',
      severity: 'low',
      message: `tsconfig jsx is "${tsconfig.compilerOptions.jsx}" — consider "react-jsx" for the new JSX transform`,
      detail: 'The new JSX transform does not require import React in every file.',
    });
  }

  // Next.js specific
  if (allDeps['next']) {
    const nextVersion = allDeps['next'] ?? '';
    const nextMajor = parseInt(nextVersion.replace(/[^0-9]/g, '').charAt(0) || '0', 10);
    if (nextMajor > 0 && nextMajor < 14) {
      issues.push({
        level: 'warning',
        tool: 'architect',
        category: 'quality',
        severity: 'high',
        message: `Next.js v${nextMajor} is outdated — upgrade to v14+ (App Router)`,
      });
    }

    // Check for next.config
    if (!existsSync(resolve(projectPath, 'next.config.js')) &&
        !existsSync(resolve(projectPath, 'next.config.mjs'))) {
      issues.push({
        level: 'info',
        tool: 'architect',
        category: 'configuration',
        severity: 'low',
        message: 'Missing next.config.js — consider adding configuration for images, headers, etc.',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export const architectRunner: ToolRunner = {
  name: 'architect',
  label: 'Architecture audit',

  isAvailable(_cwd: string): boolean {
    // Always available — it's a built-in tool that reads existing files
    return true;
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();
    const issues: Issue[] = [];
    const p = options.projectPath;

    if (!existsSync(resolve(p, 'package.json'))) {
      return buildResult('architect', 'Architecture audit', 'built-in', issues, Date.now() - start);
    }

    const framework = detectFramework(p);

    // General checks (all frameworks)
    issues.push({
      level: 'info',
      tool: 'architect',
      category: 'health',
      severity: 'low',
      message: `Framework detected: ${framework}`,
      file: 'package.json',
    });

    checkTypeScript(p, issues);
    checkTesting(p, issues);
    checkEnvironment(p, issues);
    checkCiCd(p, issues);
    checkGitConfig(p, issues);
    checkEditorConfig(p, issues);
    checkPackageJson(p, issues);
    checkDocumentation(p, issues);
    checkGitignore(p, issues);
    checkSourceMaps(p, issues);
    checkDocker(p, issues);
    checkModuleType(p, issues);

    // Framework-specific checks
    if (framework === 'angular') {
      checkAngular(p, issues);
    } else if (framework === 'react') {
      checkReact(p, issues);
    }

    return buildResult('architect', 'Architecture audit', 'built-in', issues, Date.now() - start);
  },
};

registerTool(architectRunner);
