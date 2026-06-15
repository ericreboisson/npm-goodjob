

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
  ensureLockfile,
  debugLog,
} from './base.js';

/** Shape of `npm audit --json` output (simplified — we only care about
 *  vulnerabilities and advisories) */
interface Advisory {
  title: string;
  description?: string;
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
  path?: string[];
  nodes?: string[];
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
    const projectPath = options.projectPath;
    const lockfilePath = resolve(projectPath, 'package-lock.json');
    const pkgJsonPath = resolve(projectPath, 'package.json');

    if (!existsSync(pkgJsonPath)) {
      return skippedResult(
        'npm-audit',
        'npm audit',
        'No package.json found',
      );
    }

    if (!existsSync(lockfilePath)) {
      if (!ensureLockfile(projectPath)) {
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
              message: 'No lockfile found — could not generate one with npm install --package-lock-only',
              detail: 'Try running "npm install" manually in the cloned project before auditing.',
            },
          ],
          Date.now() - start,
        );
      }
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
      debugLog(options.verbose, `npm-audit: stdout empty (stderr: "${result.stderr.slice(0, 500)}")`);
      return buildResult('npm-audit', 'npm audit', npmVersion(), [], Date.now() - start);
    }

    let parsed: NpmAuditJson;
    try {
      parsed = JSON.parse(stdout) as NpmAuditJson;
    } catch {
      debugLog(options.verbose, `npm-audit: JSON parse failed — stdout (${stdout.length} chars): ${stdout.slice(0, 1000)}`);
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

    for (const [pkgName, vuln] of Object.entries(vulns)) {
      const installed = installedVersions.get(pkgName);

      const advisoryRefs = vuln.via.filter(v => typeof v !== 'string') as Advisory[];
      const depChain = vuln.via.filter(v => typeof v === 'string') as string[];

      const advisory = advisoryRefs
        .slice()
        .sort((a, b) => ((b.cvss?.score ?? 0) - (a.cvss?.score ?? 0)) || ((b.cwe?.length ?? 0) - (a.cwe?.length ?? 0)))
        [advisoryRefs.length - 1]
        ?? (advisoryRefs.length > 0 ? advisoryRefs[advisoryRefs.length - 1] : undefined);

      const nodePath = vuln.nodes?.join('\n  ') ?? (vuln.path ? `node_modules/${vuln.path.join('\n  node_modules/')}` : undefined);

      const detailLines: string[] = [];

      if (advisory?.description) {
        detailLines.push(advisory.description);
      } else if (advisory?.title && advisory.title !== pkgName) {
        detailLines.push(advisory.title);
      }

      if (advisory?.url) {
        detailLines.push(`Advisory: ${advisory.url}`);
      }

      if (depChain.length > 0) {
        const depPathStr = vuln.path
          ? vuln.path.join(' → ')
          : depChain.join(' → ');
        detailLines.push(`Depends on: ${depPathStr} (vulnerable)`);
      }

      if (advisory?.range) {
        detailLines.push(`Affects: ${advisory.range}`);
      } else {
        detailLines.push(`Affects: ${vuln.range}`);
      }

      const cvssScore = advisory?.cvss?.score;
      if (cvssScore != null) detailLines.push(`CVSS: ${cvssScore}`);
      if (advisory?.cwe?.length) detailLines.push(`CWE: ${advisory.cwe.join(', ')}`);

      if (vuln.fixAvailable) {
        if (typeof vuln.fixAvailable === 'object') {
          detailLines.push(`Fix: npm install ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`);
        } else {
          detailLines.push('Fix: npm audit fix');
        }
      } else {
        detailLines.push('No fix available');
      }

      if (nodePath) {
        detailLines.push(`Path: ${nodePath}`);
      }

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
          ? `${pkgName}@${installed}: ${(advisory?.title ?? depChain.join(', ')) || pkgName}`
          : `${pkgName}: ${(advisory?.title ?? depChain.join(', ')) || pkgName}`,
        detail: detailLines.join('\n'),
        package: pkgName,
        version: installed,
        fixVersion: typeof vuln.fixAvailable === 'object' ? vuln.fixAvailable.version : vuln.fixAvailable ? 'npm audit fix' : undefined,
        cve: advisory?.cwe?.join(', ') || undefined,
        advisory: advisory?.url,
      });
    }

    return buildResult('npm-audit', 'npm audit', npmVersion(), issues, Date.now() - start);
  },
};

registerTool(npmAuditRunner);
