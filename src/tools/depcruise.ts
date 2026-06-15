// ---------------------------------------------------------------------------
// npm-goodjob — dependency-cruiser runner
// Validates architecture rules and detects circular dependencies.
// Auto-generates a TypeScript-aware config when tsconfig.json is present.
// ---------------------------------------------------------------------------

import { existsSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.ts';
import {
  registerTool,
  isBinaryAvailable,
  isNpxAvailable,
  isPackageInstalled,
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
    // Binary available locally, or npx can download the npm package
    return (
      isBinaryAvailable('depcruise', cwd) ||
      isBinaryAvailable('dependency-cruiser', cwd) ||
      isPackageInstalled('dependency-cruiser', cwd) ||
      isNpxAvailable()
    );
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();

    if (!this.isAvailable(options.projectPath)) {
      return skippedResult(
        'dependency-cruiser',
        'dependency-cruiser',
        'dependency-cruiser is not available — install it or ensure npx works',
      );
    }

    // When binary is available locally, prefer depcruise (local binary name).
    // When using npx, always use dependency-cruiser (npm package name).
    const binLocal = isBinaryAvailable('depcruise', options.projectPath)
      ? 'depcruise'
      : 'dependency-cruiser';
    const binaryFound = isBinaryAvailable('depcruise', options.projectPath) ||
      isBinaryAvailable('dependency-cruiser', options.projectPath);

    const useNpx = !binaryFound && isNpxAvailable();
    const toolName = useNpx ? 'dependency-cruiser' : binLocal;

    // Check if the project has its own depcruise config
    const hasConfig = [
      '.dependency-cruiser.js',
      '.dependency-cruiser.cjs',
      '.dependency-cruiser.mjs',
      '.dependency-cruiser.json',
    ].some((f) => existsSync(resolve(options.projectPath, f)));

    const hasTsConfig = existsSync(resolve(options.projectPath, 'tsconfig.json'));
    const tempConfigPath = resolve(options.projectPath, '.goodjob-depcruise.mjs');
    let generatedTempConfig = false;

    const projectSrc = resolve(options.projectPath, 'src');
    const srcDirs: string[] = [];
    if (existsSync(projectSrc)) {
      srcDirs.push('src');
    } else {
      try {
        const pkgPath = resolve(options.projectPath, 'package.json');
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          const workspaces: string[] = Array.isArray(pkg.workspaces)
            ? pkg.workspaces as string[]
            : typeof pkg.workspaces === 'object' && pkg.workspaces !== null
                ? Object.values(pkg.workspaces).flat() as string[]
                : [];
          for (const ws of workspaces) {
            if (ws.includes('*')) {
              const baseDir = ws.replace(/\/?\*+$/, '');
              const basePath = resolve(options.projectPath, baseDir);
              if (existsSync(basePath)) {
                for (const entry of readdirSync(basePath, { withFileTypes: true })) {
                  if (entry.isDirectory() && existsSync(resolve(basePath, entry.name, 'src'))) {
                    srcDirs.push(join(baseDir, entry.name, 'src'));
                  }
                }
              }
            } else if (existsSync(resolve(options.projectPath, ws, 'src'))) {
              srcDirs.push(join(ws, 'src'));
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }

    const args: string[] = srcDirs.length > 0 ? [...srcDirs] : ['.'];

    if (!hasConfig) {
      if (hasTsConfig) {
        writeFileSync(tempConfigPath, generateDepcruiseTsConfig(), 'utf-8');
        generatedTempConfig = true;
        args.push('--config', '.goodjob-depcruise.mjs');
      } else {
        args.push('--no-config');
      }
    }
    args.push('--output-type', 'err-long');

    const result = useNpx
      ? await runNpxToolCommand(toolName, args, options)
      : await runToolCommand(toolName, args, options);

    // Clean up temp config
    if (generatedTempConfig) {
      try { rmSync(tempConfigPath, { force: true }); } catch { /* ok */ }
    }

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
      const version = useNpx ? 'via npx' : getBinaryVersion(binLocal, options.projectPath);
      return buildResult('dependency-cruiser', 'dependency-cruiser', version, [], Date.now() - start);
    }

    // Check for hard errors first (non-zero exit with actual errors in output)
    const errorLines = result.stderr
      .split('\n')
      .filter((l) => l.includes('ERROR') || l.includes('Error'))
      .join('\n');
    if (errorLines && !combined.includes('no dependency violations found')) {
      const hasModule0 = combined.includes('0 modules');
      if (!hasModule0) {
        const version = useNpx ? 'via npx' : getBinaryVersion(binLocal, options.projectPath);
        return {
          tool: 'dependency-cruiser',
          label: 'dependency-cruiser',
          version,
          status: 'error',
          durationMs: Date.now() - start,
          issues: [],
          errorMessage: errorLines.slice(0, 500),
        };
      }
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

    const version = useNpx ? 'via npx' : getBinaryVersion(binLocal, options.projectPath);
    return buildResult('dependency-cruiser', 'dependency-cruiser', version, issues, Date.now() - start);
  },
};

registerTool(depcruiseRunner);

function generateDepcruiseTsConfig(): string {
  return `// Auto-generated by npm-goodjob for TypeScript support
export default {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular dependencies cause maintenance issues",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-duplicate-dep-types",
      comment: "A dependency should only appear in one section of package.json",
      severity: "warn",
      from: {},
      to: { dependencyTypes: ["npm-dev", "npm-optional", "npm-peer"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    exclude: {
      path: ["node_modules", "dist", "build", ".angular", ".next", "coverage"],
    },
  },
};
`;}
