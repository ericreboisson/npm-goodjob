// ---------------------------------------------------------------------------
// npm-goodjob — Auto-fix engine
// Runs npm audit fix, npm update for outdated deps, and reports results.
// Extended with specific fixers for pkg-lint, dependency-check, lockfile, config.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FixResult {
  /** audit fix results */
  auditFix: { status: string; summary: string };
  /** packages that were updated via npm update */
  updated: string[];
  /** packages that were removed via npm audit fix --force */
  removed: string[];
  /** pkg-lint / dependency-check field fixes applied */
  pkgFixes: string[];
  /** lockfile fixes applied */
  lockfileFixes: string[];
  /** config file fixes applied (tsconfig.json, etc.) */
  configFixes: string[];
  /** errors encountered */
  errors: string[];
}

/**
 * Run auto-fix on a project.
 * 1. npm audit fix — fix known vulnerabilities (safe fixes only)
 * 2. npm update — update all outdated deps within semver range
 * 3. pkg-lint fix — add missing required fields to package.json
 * 4. dependency-check fix — fix duplicate deps, missing engines.node
 * 5. lockfile fix — dedupe, regenerate missing lockfile
 */
export function runFix(projectPath: string): FixResult {
  const result: FixResult = {
    auditFix: { status: 'skipped', summary: '' },
    updated: [],
    removed: [],
    pkgFixes: [],
    lockfileFixes: [],
    configFixes: [],
    errors: [],
  };

  const hasPackageJson = existsSync(resolve(projectPath, 'package.json'));
  if (!hasPackageJson) {
    result.errors.push('No package.json found');
    return result;
  }

  // Step 1: npm audit fix (safe fixes only)
  runNpmAuditFix(projectPath, result);

  // Step 2: npm update (outdated deps within semver)
  runNpmUpdate(projectPath, result);

  // Step 3: pkg-lint / dependency-check fixes
  fixPackageJson(projectPath, result);

  // Step 4: lockfile fixes
  fixLockfile(projectPath, result);

  // Step 5: config fixes
  fixConfigFiles(projectPath, result);

  return result;
}

// ---------------------------------------------------------------------------
// Individual fixers
// ---------------------------------------------------------------------------

function runNpmAuditFix(projectPath: string, result: FixResult): void {
  try {
    const auditOut = execSync('npm audit fix', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    result.auditFix.status = 'success';
    const lines = auditOut.trim().split('\n');
    result.auditFix.summary = lines.filter((l) => l.startsWith('fixed') || l.startsWith('up to date')).pop() ?? 'No changes';

    for (const line of lines) {
      if (line.startsWith('removed ')) {
        const match = line.match(/removed (\d+)/);
        if (match) result.removed.push(`${match[1]} package(s) removed`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('npm audit fix')) {
      result.auditFix.status = 'partial';
      const lines = msg.split('\n');
      result.auditFix.summary = lines.filter((l) => l.startsWith('fixed')).pop() ?? 'Some issues remain';
    } else {
      result.auditFix.status = 'error';
      result.auditFix.summary = msg;
      result.errors.push(msg);
    }
  }
}

function runNpmUpdate(projectPath: string, result: FixResult): void {
  try {
    execSync('npm update', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    result.updated.push('npm update completed');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`npm update: ${msg}`);
  }
}

function fixPackageJson(projectPath: string, result: FixResult): void {
  const pkgPath = resolve(projectPath, 'package.json');
  if (!existsSync(pkgPath)) return;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    result.errors.push('Failed to parse package.json for fixes');
    return;
  }

  let modified = false;

  // 3a. Add engines.node if missing
  const engines = (pkg.engines ?? {}) as Record<string, string>;
  if (!engines.node) {
    engines.node = '>=20';
    pkg.engines = engines;
    modified = true;
    result.pkgFixes.push('Added "engines.node": ">=20"');
  }

  // 3b. Remove duplicate deps (same dep in both deps and devDeps → keep in deps, remove from devDeps)
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  for (const dep of Object.keys(deps)) {
    if (dep in devDeps) {
      const newDevDeps = { ...devDeps };
      const version = devDeps[dep];
      delete newDevDeps[dep];
      pkg.devDependencies = newDevDeps;
      modified = true;
      result.pkgFixes.push(`Removed "${dep}@${version}" from devDependencies (already in dependencies)`);
    }
  }

  // 3c. Add missing pkg-lint required fields if they look useful
  // (Check if there's a name or version — basic sanity)
  if (!pkg.name && !pkg.private) {
    // Can't auto-add name, but we note it
    // Skip — requires user input
  }

  // 3d. Ensure private field for monorepo root if workspaces present
  const workspaces = pkg.workspaces as string[] | undefined;
  if (workspaces && !pkg.private) {
    pkg.private = true;
    modified = true;
    result.pkgFixes.push('Set "private": true for workspace root');
  }

  if (modified) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }
}

function fixLockfile(projectPath: string, result: FixResult): void {
  const lockPath = resolve(projectPath, 'package-lock.json');
  const pkgPath = resolve(projectPath, 'package.json');

  // 4a. Regenerate missing lockfile
  if (!existsSync(lockPath) && existsSync(pkgPath)) {
    try {
      execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 60_000,
      });
      result.lockfileFixes.push('Regenerated missing package-lock.json');
    } catch {
      try {
        execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund --legacy-peer-deps', {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 120_000,
        });
        result.lockfileFixes.push('Regenerated missing package-lock.json (legacy-peer-deps)');
      } catch (err: unknown) {
        result.errors.push(`lockfile regeneration: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    return;
  }

  // 4b. Run npm dedupe if lockfile exists
  if (existsSync(lockPath)) {
    try {
      execSync('npm dedupe', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 120_000,
      });
      result.lockfileFixes.push('npm dedupe completed (deduplicated duplicate packages)');
    } catch (err: unknown) {
      // npm dedupe may exit non-zero if nothing to do on older npm versions
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('nothing to do')) {
        result.errors.push(`npm dedupe: ${msg}`);
      }
    }
  }
}

function fixConfigFiles(projectPath: string, result: FixResult): void {
  // 5a. Fix common tsconfig.json issues (JSONC trailing comma, comments → valid JSON)
  const tsconfigPath = resolve(projectPath, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    try {
      const raw = readFileSync(tsconfigPath, 'utf-8');
      // Check if it's valid JSON (not JSONC)
      try {
        JSON.parse(raw);
      } catch {
        // Try stripping comments and trailing commas
        const cleaned = raw
          .replace(/\/\/.*$/gm, '')           // strip // comments
          .replace(/\/\*[\s\S]*?\*\//g, '')   // strip /* */ comments
          .replace(/,\s*([}\]])/g, '$1')       // strip trailing commas
          .trim();
        try {
          JSON.parse(cleaned);
          // Valid after cleanup — write it back
          writeFileSync(tsconfigPath, JSON.stringify(JSON.parse(cleaned), null, 2) + '\n', 'utf-8');
          result.configFixes.push('Fixed tsconfig.json: converted JSONC to valid JSON');
        } catch {
          // Not fixable automatically
        }
      }
    } catch {
      // can't read tsconfig.json, skip
    }
  }
}

// ---------------------------------------------------------------------------
// Fix result formatting
// ---------------------------------------------------------------------------

/** Format fix results for console output */
export function formatFixOutput(result: FixResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('  ── Fix Results ──────────────────────────');

  // Audit fix
  if (result.auditFix.status === 'success') {
    lines.push(`  \x1b[32m✓\x1b[0m npm audit fix: ${result.auditFix.summary}`);
  } else if (result.auditFix.status === 'partial') {
    lines.push(`  \x1b[33m⚠\x1b[0m npm audit fix: ${result.auditFix.summary} (some remain)`);
  } else if (result.auditFix.status === 'error') {
    lines.push(`  \x1b[31m✗\x1b[0m npm audit fix: ${result.auditFix.summary}`);
  } else {
    lines.push(`  \x1b[2m–\x1b[0m npm audit fix: skipped`);
  }

  // Removals
  for (const r of result.removed) {
    lines.push(`    \x1b[31m-\x1b[0m ${r}`);
  }

  // npm update
  if (result.updated.length > 0) {
    lines.push(`  \x1b[32m✓\x1b[0m npm update: completed (deps updated within semver range)`);
  } else {
    lines.push(`  \x1b[2m–\x1b[0m npm update: all packages up to date`);
  }

  // Package.json fixes
  for (const fix of result.pkgFixes) {
    lines.push(`  \x1b[32m✓\x1b[0m package.json: ${fix}`);
  }

  // Lockfile fixes
  for (const fix of result.lockfileFixes) {
    lines.push(`  \x1b[32m✓\x1b[0m lockfile: ${fix}`);
  }

  // Config fixes
  for (const fix of result.configFixes) {
    lines.push(`  \x1b[32m✓\x1b[0m config: ${fix}`);
  }

  // Errors
  for (const err of result.errors) {
    lines.push(`  \x1b[31m✗\x1b[0m Error: ${err}`);
  }

  lines.push('  ──────────────────────────────────────────\n');
  return lines.join('\n');
}
