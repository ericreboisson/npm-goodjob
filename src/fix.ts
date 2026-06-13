// ---------------------------------------------------------------------------
// npm-goodjob — Auto-fix engine
// Runs npm audit fix, npm update for outdated deps, and reports results.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FixResult {
  /** audit fix results */
  auditFix: { status: string; summary: string };
  /** packages that were updated via npm update */
  updated: string[];
  /** packages that were removed via npm audit fix --force */
  removed: string[];
  /** errors encountered */
  errors: string[];
}

/**
 * Run auto-fix on a project.
 * 1. npm audit fix — fix known vulnerabilities (safe fixes only)
 * 2. npm update — update all outdated deps within semver range
 */
export function runFix(projectPath: string): FixResult {
  const result: FixResult = {
    auditFix: { status: 'skipped', summary: '' },
    updated: [],
    removed: [],
    errors: [],
  };

  const hasPackageJson = existsSync(resolve(projectPath, 'package.json'));
  if (!hasPackageJson) {
    result.errors.push('No package.json found');
    return result;
  }

  // 1. npm audit fix (safe fixes only — install semver-compatible updates)
  try {
    const auditOut = execSync('npm audit fix', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    result.auditFix.status = 'success';
    // Extract summary from last line (e.g. "fixed 3 of 5 vulnerabilities")
    const lines = auditOut.trim().split('\n');
    result.auditFix.summary = lines.filter((l) => l.startsWith('fixed') || l.startsWith('up to date')).pop() ?? 'No changes';

    // Parse changed packages from npm output
    for (const line of lines) {
      if (line.startsWith('added ') || line.startsWith('removed ') || line.startsWith('changed ') || line.startsWith('updated ')) {
        // Track removals (--force only, but we note them)
        if (line.startsWith('removed ')) {
          const match = line.match(/removed (\d+)/);
          if (match) result.removed.push(`${match[1]} package(s) removed`);
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    // npm audit fix exits non-zero when vulnerabilities remain after fix
    if (msg.includes('npm audit fix')) {
      result.auditFix.status = 'partial';
      // Extract summary from error output
      const lines = msg.split('\n');
      result.auditFix.summary = lines.filter((l) => l.startsWith('fixed')).pop() ?? 'Some issues remain';
    } else {
      result.auditFix.status = 'error';
      result.auditFix.summary = msg;
      result.errors.push(msg);
    }
  }

  // 2. npm update (outdated deps within semver)
  try {
    execSync('npm update', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    // Compare package-lock before/after to count changes
    result.updated.push('npm update completed');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`npm update: ${msg}`);
  }

  return result;
}

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

  // Errors
  for (const err of result.errors) {
    lines.push(`  \x1b[31m✗\x1b[0m Error: ${err}`);
  }

  lines.push('  ──────────────────────────────────────────\n');
  return lines.join('\n');
}
