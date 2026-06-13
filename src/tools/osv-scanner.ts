// ---------------------------------------------------------------------------
// npm-goodjob — OSV-Scanner runner
// Scans lockfiles / manifest files against the OSV.dev vulnerability database.
// Uses the `osv-scanner` CLI binary when available, otherwise skips.
// ---------------------------------------------------------------------------

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
} from './base.js';

/** Simplified OSV-Scanner --json output types */
interface OsvResult {
  results?: OsvPackageResult[];
}

interface OsvPackageResult {
  package?: { name: string; version?: string; ecosystem?: string };
  vulnerabilities?: OsvVuln[];
}

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
}

export const osvScannerRunner: ToolRunner = {
  name: 'osv-scanner',
  label: 'OSV-Scanner',

  isAvailable(cwd: string): boolean {
    // OSV-Scanner is a Go binary — check PATH and node_modules/.bin
    return (
      isBinaryAvailable('osv-scanner', cwd) ||
      existsSync(resolve(cwd, 'node_modules', '.bin', 'osv-scanner'))
    );
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();

    if (!this.isAvailable(options.projectPath)) {
      return skippedResult(
        'osv-scanner',
        'OSV-Scanner',
        'osv-scanner is not installed — see https://github.com/google/osv-scanner',
      );
    }

    // Find lockfiles / manifests
    const targets: string[] = [];
    const candidates = [
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'composer.lock',
      'Gemfile.lock',
      'go.sum',
    ];

    for (const file of candidates) {
      const fp = resolve(options.projectPath, file);
      if (existsSync(fp)) targets.push(file);
    }

    if (targets.length === 0) {
      return skippedResult(
        'osv-scanner',
        'OSV-Scanner',
        'No supported lockfiles found (package-lock.json, yarn.lock, pnpm-lock.yaml, etc.)',
      );
    }

    const args = ['--json', ...targets];
    const result = await runToolCommand('osv-scanner', args, options);

    if (!result) {
      return {
        tool: 'osv-scanner',
        label: 'OSV-Scanner',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run osv-scanner',
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      const version = getBinaryVersion('osv-scanner', options.projectPath);
      return buildResult('osv-scanner', 'OSV-Scanner', version, [], Date.now() - start);
    }

    let parsed: OsvResult;
    try {
      parsed = JSON.parse(stdout) as OsvResult;
    } catch {
      return {
        tool: 'osv-scanner',
        label: 'OSV-Scanner',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to parse OSV-Scanner JSON output',
      };
    }

    const issues: Issue[] = [];
    const pkgResults = parsed.results ?? [];

    for (const pkgRes of pkgResults) {
      const pkgName = pkgRes.package?.name ?? 'unknown';
      const vulns = pkgRes.vulnerabilities ?? [];

      for (const vuln of vulns) {
        const sev = vuln.database_specific?.severity;
        const severityLabel = sev ? mapSeverity(sev) : 'medium';
        const aliases = vuln.aliases?.join(', ') ?? '';

        issues.push({
          level: severityLabel === 'critical' || severityLabel === 'high'
            ? 'error'
            : 'warning',
          tool: 'osv-scanner',
          category: 'security',
          severity: severityLabel,
          message: vuln.summary
            ? `${pkgName}: ${vuln.summary}`
            : `${pkgName}: ${vuln.id}`,
          detail: vuln.details
            ? vuln.details.slice(0, 500)
            : `${vuln.id}${aliases ? ` (aliases: ${aliases})` : ''}`,
          package: pkgName,
          cve: findCve(vuln.aliases),
          advisory: vuln.id,
        });
      }
    }

    const version = getBinaryVersion('osv-scanner', options.projectPath);
    return buildResult('osv-scanner', 'OSV-Scanner', version, issues, Date.now() - start);
  },
};

registerTool(osvScannerRunner);

function mapSeverity(s: string): 'critical' | 'high' | 'medium' | 'low' {
  const lower = s.toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'moderate' || lower === 'medium') return 'medium';
  return 'low';
}

function findCve(aliases?: string[]): string | undefined {
  return aliases?.find((a) => a.startsWith('CVE-'));
}
