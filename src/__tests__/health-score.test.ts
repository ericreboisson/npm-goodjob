import { describe, it, expect } from 'vitest';
import { computeHealthScore } from '../health-score.js';
import type { AuditReport, Issue } from '../types.js';

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    level: 'error',
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
      projectName: 'test',
      projectPath: '/tmp',
      timestamp: '2026-01-01T00:00:00.000Z',
      durationMs: 100,
      nodeVersion: '20.0.0',
      npmVersion: '10.0.0',
      goodjobVersion: '0.1.0',
    },
    ...overrides,
  };
}

describe('computeHealthScore', () => {
  it('returns 20/20 for a clean report', () => {
    const report = makeReport();
    const hs = computeHealthScore(report);
    expect(hs.total).toBe(20);
    expect(hs.security).toBe(5);
    expect(hs.dependencies).toBe(5);
    expect(hs.codeQuality).toBe(5);
    expect(hs.projectHealth).toBe(5);
  });

  it('has max field matching total max', () => {
    const report = makeReport();
    const hs = computeHealthScore(report);
    expect(hs.max).toBe(20);
    expect(hs.total).toBeLessThanOrEqual(hs.max);
  });

  describe('security scoring', () => {
    it('deducts for critical vulnerabilities', () => {
      const report = makeReport({
        tools: {
          'npm-audit': {
            tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
            status: 'success', durationMs: 100, issues: [
              makeIssue({ severity: 'critical', level: 'error', category: 'security' }),
            ],
          },
        },
      });
      const hs = computeHealthScore(report);
      expect(hs.security).toBe(3.5); // 5 - (5 * 0.3) = 4.5 -> wait, Math.round(4.5 * 10) / 10 = 4.5
      // Actually: maxScore * 0.3 = 5 * 0.3 = 1.5, 5 - 1.5 = 3.5
    });

    it('deducts for high severity issues', () => {
      const report = makeReport({
        tools: {
          'npm-audit': {
            tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
            status: 'success', durationMs: 100, issues: [
              makeIssue({ severity: 'high', level: 'error', category: 'security' }),
              makeIssue({ severity: 'high', level: 'error', category: 'security' }),
            ],
          },
        },
      });
      const hs = computeHealthScore(report);
      // 5 - 2 * (5 * 0.16) = 5 - 1.6 = 3.4
      expect(hs.security).toBe(3.4);
    });

    it('does not deduct for info-level issues', () => {
      const report = makeReport({
        tools: {
          'secret-scanning': {
            tool: 'secret-scanning', label: 'Secret Scanning', version: 'built-in',
            status: 'success', durationMs: 10, issues: [
              makeIssue({ severity: 'low', level: 'info', category: 'security' }),
            ],
          },
        },
      });
      const hs = computeHealthScore(report);
      expect(hs.security).toBe(5);
    });

    it('floors at 0', () => {
      const issues: Issue[] = [];
      for (let i = 0; i < 10; i++) {
        issues.push(makeIssue({ severity: 'critical', level: 'error', category: 'security' }));
      }
      const report = makeReport({
        tools: {
          'npm-audit': {
            tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
            status: 'success', durationMs: 100, issues,
          },
        },
      });
      const hs = computeHealthScore(report);
      expect(hs.security).toBe(0);
    });
  });

  describe('dependency scoring', () => {
    it('deducts for outdated deps', () => {
      const report = makeReport({
        tools: {
          'npm-outdated': {
            tool: 'npm-outdated', label: 'npm outdated', version: '10.0.0',
            status: 'success', durationMs: 100, issues: [
              makeIssue({ severity: 'high', level: 'warning', category: 'outdated-dependency' }),
            ],
          },
        },
      });
      const hs = computeHealthScore(report);
      expect(hs.dependencies).toBeLessThan(5);
    });

    it('deducts for license issues', () => {
      const report = makeReport({
        tools: {
          'license-check': {
            tool: 'license-check', label: 'License Check', version: 'via npx',
            status: 'success', durationMs: 1000, issues: [
              makeIssue({ severity: 'high', level: 'error', category: 'license' }),
            ],
          },
        },
      });
      const hs = computeHealthScore(report);
      expect(hs.dependencies).toBeLessThan(5);
    });

    it('deducts for duplicate packages', () => {
      const report = makeReport({
        tools: {
          'lockfile-analysis': {
            tool: 'lockfile-analysis', label: 'Lockfile Analysis', version: 'built-in',
            status: 'success', durationMs: 10, issues: [
              makeIssue({ severity: 'medium', level: 'warning', category: 'duplicate' }),
            ],
          },
        },
      });
      const hs = computeHealthScore(report);
      expect(hs.dependencies).toBeLessThan(5);
    });
  });

  describe('code quality scoring', () => {
    it('deducts for eslint errors', () => {
      const report = makeReport({
        tools: {
          'eslint': {
            tool: 'eslint', label: 'ESLint', version: '8.0.0',
            status: 'success', durationMs: 1000, issues: [
              makeIssue({ severity: 'medium', level: 'error', category: 'quality' }),
              makeIssue({ severity: 'medium', level: 'error', category: 'quality' }),
              makeIssue({ severity: 'medium', level: 'error', category: 'quality' }),
            ],
          },
        },
      });
      const hs = computeHealthScore(report);
      // 5 - 3 * 0.4 = 3.8
      expect(hs.codeQuality).toBe(3.8);
    });
  });

  describe('custom weights from config', () => {
    it('uses custom weights from config', () => {
      const report = makeReport();
      const hs = computeHealthScore(report, {
        healthScore: {
          weights: { security: 10, dependencies: 3, codeQuality: 2, projectHealth: 5 },
        },
      });
      expect(hs.max).toBe(20); // 10 + 3 + 2 + 5 = 20
      expect(hs.total).toBe(20);
      expect(hs.security).toBe(10);
      expect(hs.dependencies).toBe(3);
      expect(hs.codeQuality).toBe(2);
      expect(hs.projectHealth).toBe(5);
    });

    it('adjusts max when weights are changed', () => {
      const report = makeReport();
      const hs = computeHealthScore(report, {
        healthScore: {
          weights: { security: 8, dependencies: 4, codeQuality: 4, projectHealth: 4 },
        },
      });
      expect(hs.max).toBe(20); // 8 + 4 + 4 + 4 = 20
    });
  });

  describe('breakdown details', () => {
    it('returns breakdown for each category', () => {
      const report = makeReport();
      const hs = computeHealthScore(report);
      expect(hs.breakdown).toHaveLength(4);
      expect(hs.breakdown[0].label).toBe('Security');
      expect(hs.breakdown[1].label).toBe('Dependencies');
      expect(hs.breakdown[2].label).toBe('Code Quality');
      expect(hs.breakdown[3].label).toBe('Project Health');
    });

    it('breakdown details contain score', () => {
      const report = makeReport({
        tools: {
          'npm-audit': {
            tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
            status: 'success', durationMs: 100, issues: [
              makeIssue({ severity: 'critical', level: 'error', category: 'security' }),
            ],
          },
        },
      });
      const hs = computeHealthScore(report);
      expect(hs.breakdown[0].detail).toContain('3.5');
    });
  });
});
