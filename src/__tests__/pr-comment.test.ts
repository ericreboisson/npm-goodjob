import { describe, it, expect } from 'vitest';
import { formatPrComment } from '../pr-comment.js';
import type { AuditReport } from '../types.js';

function makeReport(overrides?: Partial<AuditReport>): AuditReport {
  return {
    summary: {
      total: 7,
      errors: 2,
      warnings: 3,
      info: 2,
      bySeverity: { critical: 1, high: 2, medium: 1, low: 3 },
      byCategory: { security: 3, quality: 2, license: 1, other: 1 },
    },
    tools: {
      'npm-audit': {
        tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
        status: 'success', durationMs: 100,
        issues: [
          { level: 'error', tool: 'npm-audit', category: 'security', severity: 'critical', message: 'Critical vuln in lodash', cve: 'CVE-2024-0001', package: 'lodash', fixVersion: '4.17.21' },
          { level: 'warning', tool: 'npm-audit', category: 'security', severity: 'high', message: 'High vuln in axios', cve: 'CVE-2024-0002' },
        ],
      },
      'secret-scanning': {
        tool: 'secret-scanning', label: 'Secret Scanning', version: 'built-in',
        status: 'success', durationMs: 50,
        issues: [
          { level: 'error', tool: 'secret-scanning', category: 'security', severity: 'critical', message: 'AWS key detected', file: 'src/config.ts', line: 42 },
        ],
      },
      'license-check': {
        tool: 'license-check', label: 'License Check', version: '1.0.0',
        status: 'success', durationMs: 30,
        issues: [
          { level: 'error', tool: 'license-check', category: 'license', severity: 'high', message: 'GPL license blocked' },
        ],
      },
    },
    metadata: {
      projectName: 'test-app', projectPath: '/test',
      timestamp: '2025-01-01T00:00:00.000Z', durationMs: 350,
      nodeVersion: '20.0.0', npmVersion: '10.0.0', goodjobVersion: '0.2.0',
    },
    healthScore: { total: 12, max: 20, security: 2, dependencies: 3, codeQuality: 3, projectHealth: 4, breakdown: [] },
    ...overrides,
  };
}

describe('PR comment formatting', () => {
  it('includes health badge', () => {
    const report = makeReport();
    const comment = formatPrComment(report);
    expect(comment).toContain('![Health]');
    expect(comment).toContain('health-12%2F20');
    expect(comment).toContain('**Health Score:** 12/20');
  });

  it('includes severity badges when issues exist', () => {
    const report = makeReport();
    const comment = formatPrComment(report);
    expect(comment).toContain('critical-1-red');
    expect(comment).toContain('high-2-orange');
  });

  it('includes summary table', () => {
    const report = makeReport();
    const comment = formatPrComment(report);
    expect(comment).toContain('| **Total Issues** | 7 |');
    expect(comment).toContain('| **Errors** | 2 |');
    expect(comment).toContain('| **Warnings** | 3 |');
  });

  it('includes severity breakdown table', () => {
    const report = makeReport();
    const comment = formatPrComment(report);
    expect(comment).toContain('| critical | 1 |');
    expect(comment).toContain('| high | 2 |');
  });

  it('includes per-tool breakdown', () => {
    const report = makeReport();
    const comment = formatPrComment(report);
    expect(comment).toContain('| npm-audit | 2 | 1 |');
    expect(comment).toContain('| secret-scanning | 1 | 1 |');
  });

  it('includes top critical/high issues with file locations', () => {
    const report = makeReport();
    const comment = formatPrComment(report);
    expect(comment).toContain('🔴 **critical** Critical vuln in lodash');
    expect(comment).toContain('🟠 **high** High vuln in axios');
    expect(comment).toContain('`src/config.ts:42`');
  });

  it('handles clean report with no issues', () => {
    const cleanReport: AuditReport = {
      summary: { total: 0, errors: 0, warnings: 0, info: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, byCategory: {} },
      tools: {},
      metadata: { projectName: 'clean', projectPath: '/clean', timestamp: '2025-01-01T00:00:00.000Z', durationMs: 100, nodeVersion: '20.0.0', npmVersion: '10.0.0', goodjobVersion: '0.2.0' },
      healthScore: { total: 20, max: 20, security: 5, dependencies: 5, codeQuality: 5, projectHealth: 5, breakdown: [] },
    };
    const comment = formatPrComment(cleanReport);
    expect(comment).toContain('npm-goodjob Audit Report');
    expect(comment).toContain('| **Total Issues** | 0 |');
    expect(comment).toContain('**Health Score:** 20/20');
  });

  it('skips health badge when no health score', () => {
    const report = makeReport({ healthScore: undefined });
    const comment = formatPrComment(report);
    expect(comment).not.toContain('![Health]');
    expect(comment).not.toContain('**Health Score:**');
  });

  it('shows tool duration in footer', () => {
    const report = makeReport();
    const comment = formatPrComment(report);
    expect(comment).toContain('350ms');
  });
});
