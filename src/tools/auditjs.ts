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

interface AuditJsVuln {
  id?: string;
  title?: string;
  description?: string;
  severity?: string;
  cvssScore?: number;
  reference?: string;
  cve?: string;
  cwe?: string;
  packageName?: string;
  version?: string;
  fixedIn?: string[];
}

interface AuditJsResult {
  vulnerabilities?: AuditJsVuln[];
  summary?: { total: number; critical: number; high: number; medium: number; low: number };
}

export const auditJsRunner: ToolRunner = {
  name: 'auditjs',
  label: 'AuditJS (OSS Index)',

  isAvailable(cwd: string): boolean {
    return isBinaryAvailable('auditjs', cwd) || isNpxAvailable();
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();

    if (!this.isAvailable(options.projectPath)) {
      return skippedResult(
        'auditjs', 'AuditJS (OSS Index)',
        'auditjs CLI not found and npx is unavailable',
      );
    }

    const hasLocal = isBinaryAvailable('auditjs', options.projectPath);
    const useNpx = !hasLocal && isNpxAvailable();

    const result = useNpx
      ? await runNpxToolCommand('auditjs', ['ossi', '--json'], options)
      : await runToolCommand('auditjs', ['ossi', '--json'], options);

    if (!result) {
      return {
        tool: 'auditjs',
        label: 'AuditJS (OSS Index)',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run auditjs — binary not found or not executable',
      };
    }

    if (result.exitCode !== 0 && !result.stdout.trim()) {
      return {
        tool: 'auditjs',
        label: 'AuditJS (OSS Index)',
        version: useNpx ? 'via npx' : getBinaryVersion('auditjs', options.projectPath),
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: (result.stderr || 'Non-zero exit code').slice(0, 500),
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      return buildResult('auditjs', 'AuditJS (OSS Index)', useNpx ? 'via npx' : getBinaryVersion('auditjs', options.projectPath), [], Date.now() - start);
    }

    // auditjs may output one JSON object per line or an array
    let vulns: AuditJsVuln[] = [];
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        vulns = parsed.flatMap((entry: AuditJsResult & { coordinates?: string; vulnerabilities?: AuditJsVuln[] }) =>
          entry.vulnerabilities ?? []
        );
      } else if (parsed.vulnerabilities) {
        vulns = parsed.vulnerabilities;
      }
    } catch {
      // Try line-by-line JSON
      for (const line of stdout.split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line) as AuditJsResult;
          if (entry.vulnerabilities) vulns.push(...entry.vulnerabilities);
        } catch { /* skip unparseable lines */ }
      }
    }

    const issues: Issue[] = vulns.map((v) => {
      const sev = mapAuditJsSeverity(v.severity);
      return {
        level: sev === 'critical' || sev === 'high' ? 'error' : 'warning',
        tool: 'auditjs',
        category: 'security' as const,
        severity: sev,
        message: v.packageName
          ? `${v.packageName}${v.version ? `@${v.version}` : ''}: ${v.title ?? 'Unknown vulnerability'}`
          : v.title ?? 'Unknown vulnerability',
        detail: [
          v.description?.slice(0, 500),
          v.cve ? `CVE: ${v.cve}` : '',
          v.cwe ? `CWE: ${v.cwe}` : '',
          v.cvssScore != null ? `CVSS: ${v.cvssScore}` : '',
          v.fixedIn?.length ? `Fix in: ${v.fixedIn.join(', ')}` : '',
          v.reference ?? '',
        ].filter(Boolean).join(' · '),
        package: v.packageName,
        version: v.version,
        cve: v.cve,
      };
    });

    const version = useNpx ? 'via npx' : getBinaryVersion('auditjs', options.projectPath);
    return buildResult('auditjs', 'AuditJS (OSS Index)', version, issues, Date.now() - start);
  },
};

function mapAuditJsSeverity(s?: string): 'critical' | 'high' | 'medium' | 'low' {
  const lower = (s ?? '').toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'medium' || lower === 'moderate') return 'medium';
  return 'low';
}

registerTool(auditJsRunner);
