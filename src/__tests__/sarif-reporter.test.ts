import { describe, it, expect } from 'vitest';
import type { AuditReport, Issue } from '../types.js';
import { toSarif } from '../reporters/sarif-reporter.js';

// Import the actual toSarif from the module
// Since it's not exported, we test through the public API

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    level: 'warning',
    tool: 'test',
    category: 'security',
    severity: 'high',
    message: 'test issue',
    ...overrides,
  };
}

function makeReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    summary: { total: 0, errors: 0, warnings: 0, info: 0, bySeverity: {}, byCategory: {} },
    tools: {},
    metadata: {
      projectName: 'test', projectPath: '/tmp', timestamp: '2026-01-01T00:00:00.000Z',
      durationMs: 100, nodeVersion: '20.0.0', npmVersion: '10.0.0', goodjobVersion: '0.1.0',
    },
    ...overrides,
  };
}

describe('sarif-reporter', () => {
  it('converts issue to SARIF result', () => {
    const report = makeReport({
      tools: {
        'npm-audit': {
          tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
          status: 'success', durationMs: 100, issues: [
            makeIssue({
              severity: 'high', level: 'error', category: 'security',
              message: 'Prototype Pollution in lodash',
              package: 'lodash', version: '4.17.21',
            }),
          ],
        },
      },
    });

    const sarif = toSarif(report);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].ruleId).toContain('npm-audit/security/high');
    expect(sarif.runs[0].results[0].level).toBe('error');
    expect(sarif.runs[0].results[0].message.text).toContain('Prototype Pollution');
  });

  it('converts warnings correctly', () => {
    const report = makeReport({
      tools: {
        'depcheck': {
          tool: 'depcheck', label: 'Depcheck', version: '1.0.0',
          status: 'success', durationMs: 100, issues: [
            makeIssue({
              severity: 'low', level: 'warning', category: 'unused-dependency',
              message: 'Unused dependency: moment',
            }),
          ],
        },
      },
    });

    const sarif = toSarif(report);
    expect(sarif.runs[0].results[0].level).toBe('warning');
  });

  it('skips info-level issues', () => {
    const report = makeReport({
      tools: {
        'secret-scanning': {
          tool: 'secret-scanning', label: 'Secret Scanning', version: 'built-in',
          status: 'success', durationMs: 10, issues: [
            makeIssue({ severity: 'low', level: 'info', message: 'No secrets found' }),
          ],
        },
      },
    });

    const sarif = toSarif(report);
    expect(sarif.runs[0].results).toHaveLength(0);
  });

  it('includes file location when available', () => {
    const report = makeReport({
      tools: {
        'secret-scanning': {
          tool: 'secret-scanning', label: 'Secret Scanning', version: 'built-in',
          status: 'success', durationMs: 10, issues: [
            makeIssue({
              severity: 'critical', level: 'error', category: 'security',
              message: 'AWS key in config.js',
              file: 'src/config.js', line: 15, column: 8,
            }),
          ],
        },
      },
    });

    const sarif = toSarif(report);
    const loc = sarif.runs[0].results[0].locations[0];
    expect(loc.physicalLocation.artifactLocation.uri).toBe('src/config.js');
    expect(loc.physicalLocation.region?.startLine).toBe(15);
    expect(loc.physicalLocation.region?.startColumn).toBe(8);
  });

  it('includes CVE fingerprint when available', () => {
    const report = makeReport({
      tools: {
        'npm-audit': {
          tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
          status: 'success', durationMs: 100, issues: [
            makeIssue({
              severity: 'critical', level: 'error', category: 'security',
              message: 'Critical in lodash', cve: 'CVE-2024-1234',
            }),
          ],
        },
      },
    });

    const sarif = toSarif(report);
    expect(sarif.runs[0].results[0].partialFingerprints?.cveId).toBe('CVE-2024-1234');
  });

  it('creates rules array from issues', () => {
    const report = makeReport({
      tools: {
        'npm-audit': {
          tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
          status: 'success', durationMs: 100, issues: [
            makeIssue({ severity: 'critical', level: 'error', category: 'security' }),
            makeIssue({ severity: 'high', level: 'warning', category: 'security' }),
          ],
        },
        'eslint': {
          tool: 'eslint', label: 'ESLint', version: '8.0.0',
          status: 'success', durationMs: 100, issues: [
            makeIssue({ severity: 'medium', level: 'warning', category: 'quality' }),
          ],
        },
      },
    });

    const sarif = toSarif(report);
    // 3 unique ruleIds: npm-audit/security/critical, npm-audit/security/high, eslint/quality/medium
    expect(sarif.runs[0].tool.driver.rules.length).toBe(3);
  });
});
