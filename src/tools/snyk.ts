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

interface SnykVuln {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  package: string;
  version: string;
  upgradePath: string[];
  identifiers?: { CVE?: string[]; CWE?: string[] };
  credit?: string[];
  semver?: { vulnerable: string[] };
  CVSSv3?: string;
  cvssScore?: number;
  exploit?: string;
  description?: string;
}

interface SnykJson {
  vulnerabilities?: SnykVuln[];
  ok?: boolean;
  error?: string;
  path?: string;
}

export const snykRunner: ToolRunner = {
  name: 'snyk',
  label: 'Snyk',

  isAvailable(cwd: string): boolean {
    return isBinaryAvailable('snyk', cwd) || isNpxAvailable();
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();

    if (!this.isAvailable(options.projectPath)) {
      return skippedResult('snyk', 'Snyk', 'snyk CLI not found and npx is unavailable');
    }

    const hasLocal = isBinaryAvailable('snyk', options.projectPath);
    const useNpx = !hasLocal && isNpxAvailable();

    const result = useNpx
      ? await runNpxToolCommand('snyk', ['test', '--json'], options)
      : await runToolCommand('snyk', ['test', '--json'], options);

    if (!result) {
      return {
        tool: 'snyk',
        label: 'Snyk',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run snyk — binary not found or not executable',
      };
    }

    if (result.exitCode !== 0 && !result.stdout.trim()) {
      // When snyk is unauthenticated, it exits non-zero and outputs
      // {"ok":false,"error":"Use `snyk auth` to authenticate."} on stderr.
      const stderrText = result.stderr || '';
      let errMsg = stderrText.slice(0, 500);
      try {
        const parsed = JSON.parse(stderrText) as { ok?: boolean; error?: string };
        if (parsed.ok === false && parsed.error) errMsg = parsed.error.slice(0, 500);
      } catch { /* empty */ }
      return {
        tool: 'snyk',
        label: 'Snyk',
        version: useNpx ? 'via npx' : getBinaryVersion('snyk', options.projectPath),
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: errMsg,
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout || stdout === '{}' || stdout === '[]') {
      return buildResult('snyk', 'Snyk', useNpx ? 'via npx' : getBinaryVersion('snyk', options.projectPath), [], Date.now() - start);
    }

    let parsed: SnykJson;
    try {
      parsed = JSON.parse(stdout) as SnykJson;
    } catch {
      return buildResult('snyk', 'Snyk', useNpx ? 'via npx' : getBinaryVersion('snyk', options.projectPath), [], Date.now() - start);
    }

    if (parsed.ok === false && parsed.error) {
      return {
        tool: 'snyk',
        label: 'Snyk',
        version: useNpx ? 'via npx' : getBinaryVersion('snyk', options.projectPath),
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: parsed.error.slice(0, 500),
      };
    }

    const vulns = parsed.vulnerabilities ?? [];

    const issues: Issue[] = vulns.map((v) => ({
      level: v.severity === 'critical' || v.severity === 'high' ? 'error' : 'warning',
      tool: 'snyk',
      category: 'security' as const,
      severity: v.severity === 'critical' ? 'critical' as const
        : v.severity === 'high' ? 'high' as const
        : v.severity === 'medium' ? 'medium' as const
        : 'low' as const,
      message: v.CVSSv3
        ? `${v.package}@${v.version}: ${v.title} (CVSS ${v.CVSSv3})`
        : `${v.package}@${v.version}: ${v.title}`,
      detail: [
        v.description?.slice(0, 500),
        v.identifiers?.CVE?.length ? `CVE: ${v.identifiers.CVE.join(', ')}` : '',
        v.identifiers?.CWE?.length ? `CWE: ${v.identifiers.CWE.join(', ')}` : '',
        v.cvssScore != null ? `CVSS Score: ${v.cvssScore}` : '',
        v.exploit ? `Exploit: ${v.exploit}` : '',
        v.upgradePath?.length ? `Upgrade to: ${v.upgradePath.filter(Boolean).join(' → ')}` : '',
      ].filter(Boolean).join(' · '),
      package: v.package,
      version: v.version,
      cve: v.identifiers?.CVE?.[0],
    }));

    const version = useNpx ? 'via npx' : getBinaryVersion('snyk', options.projectPath);
    return buildResult('snyk', 'Snyk', version, issues, Date.now() - start);
  },
};

registerTool(snykRunner);
