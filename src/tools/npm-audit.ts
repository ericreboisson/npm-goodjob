// ---------------------------------------------------------------------------
// npm-goodjob — npm audit runner
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  isBinaryAvailable,
  runToolCommand,
  buildResult,
  skippedResult,
  errorResult,
  getInstalledPackageVersion,
} from './base.js';

/** Shape of `npm audit --json` output (simplified — we only care about
 *  vulnerabilities and advisories) */
interface Advisory {
  title: string;
  url?: string;
  severity?: string;
  cwe?: string[];
  cvss?: { score: number; vectorString?: string };
  range?: string;
}

interface Vulnerability {
  name: string;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  range: string;
  via: Array<Advisory | string>;
  fixAvailable: boolean | { name: string; version: string };
}

interface NpmAuditJson {
  vulnerabilities?: Record<string, Vulnerability>;
  metadata?: {
    vulnerabilities: {
      critical: number;
      high: number;
      moderate: number;
      low: number;
      info: number;
      total: number;
    };
  };
  error?: { code: string; summary: string; detail: string };
}

function npmVersion(): string {
  try {
    return execSync('npm --version', { encoding: 'utf-8' }).trim();
  } catch {
    return 'N/A';
  }
}

export const npmAuditRunner: ToolRunner = {
  name: 'npm-audit',
  label: 'npm audit',

  isAvailable(cwd: string): boolean {
    // npm is bundled with Node — always available if Node is installed
    // But require a lockfile or package.json
    return (
      isBinaryAvailable('npm', cwd) &&
      (existsSync(resolve(cwd, 'package-lock.json')) ||
        existsSync(resolve(cwd, 'package.json')))
    );
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();
    const lockfilePath = resolve(options.projectPath, 'package-lock.json');

    if (!existsSync(lockfilePath) && !existsSync(resolve(options.projectPath, 'package.json'))) {
      return skippedResult(
        'npm-audit',
        'npm audit',
        'No package.json or package-lock.json found',
      );
    }

    // Run `npm audit --json`
    const result = await runToolCommand('npm', ['audit', '--json'], options);

    if (!result) {
      return errorResult('npm-audit', 'npm audit', 'Failed to run npm audit', Date.now() - start);
    }

    // npm audit exits with code 1 when vulnerabilities are found — that is
    // expected behaviour, not a failure.  Parse whatever came back on stdout.
    const stdout = result.stdout.trim();
    if (!stdout) {
      return buildResult('npm-audit', 'npm audit', npmVersion(), [], Date.now() - start);
    }

    let parsed: NpmAuditJson;
    try {
      parsed = JSON.parse(stdout) as NpmAuditJson;
    } catch {
      // Sometimes npm audit --json emits non-JSON on stderr
      return buildResult('npm-audit', 'npm audit', npmVersion(), [], Date.now() - start);
    }

    const issues: Issue[] = [];

    // Handle npm audit error (e.g. registry unreachable, no lockfile)
    if (parsed.error) {
      return buildResult(
        'npm-audit',
        'npm audit',
        npmVersion(),
        [
          {
            level: 'warning',
            tool: 'npm-audit',
            category: 'configuration',
            severity: 'low',
            message: parsed.error.summary,
            detail: parsed.error.detail,
          },
        ],
        Date.now() - start,
      );
    }

    // Read installed version for each vulnerable package
    const vulns = parsed.vulnerabilities ?? {};
    const installedVersions = new Map<string, string>();
    for (const pkgName of Object.keys(vulns)) {
      const v = getInstalledPackageVersion(pkgName, options.projectPath);
      if (v) installedVersions.set(pkgName, v);
    }

    // Parse vulnerabilities
    for (const [pkgName, vuln] of Object.entries(vulns)) {
      const installed = installedVersions.get(pkgName);

      for (const via of vuln.via) {
        const adv: Advisory = typeof via === 'string' ? { title: via } : via;
        const cweInfo = adv.cwe?.length ? adv.cwe.join(', ') : '';
        const cvssInfo = adv.cvss?.score != null ? `CVSS ${adv.cvss.score}` : '';

        // Build a rich description
        const detailParts: string[] = [];
        if (adv.range) detailParts.push(`Affects ${adv.range}`);
        else detailParts.push(`Affects versions ${vuln.range}`);
        if (cweInfo) detailParts.push(cweInfo);
        if (cvssInfo) detailParts.push(cvssInfo);
        if (vuln.fixAvailable) {
          detailParts.push(
            typeof vuln.fixAvailable === 'object'
              ? `Fix: ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`
              : 'Fix available via npm audit fix',
          );
        } else {
          detailParts.push('No fix available');
        }
        if (adv.url) detailParts.push(adv.url);

        issues.push({
          level: vuln.severity === 'critical' || vuln.severity === 'high' ? 'error' : 'warning',
          tool: 'npm-audit',
          category: 'security',
          severity: vuln.severity === 'critical'
            ? 'critical'
            : vuln.severity === 'high'
              ? 'high'
              : vuln.severity === 'moderate'
                ? 'medium'
                : 'low',
          message: installed
            ? `${pkgName}@${installed}: ${adv.title}`
            : `${pkgName}: ${adv.title}`,
          detail: detailParts.join(' · '),
          package: pkgName,
          version: installed,
          cve: cweInfo || undefined,
          advisory: adv.url,
        });
      }
    }

    return buildResult('npm-audit', 'npm audit', npmVersion(), issues, Date.now() - start);
  },
};

registerTool(npmAuditRunner);
