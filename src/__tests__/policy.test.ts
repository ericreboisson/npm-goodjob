import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../policy.js';
import type { AuditReport, PolicyConfig } from '../types.js';

function makeReport(overrides?: Partial<AuditReport>): AuditReport {
  return {
    summary: {
      total: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byCategory: {},
    },
    tools: {},
    metadata: {
      projectName: 'test',
      projectPath: '/test',
      timestamp: '2025-01-01T00:00:00.000Z',
      durationMs: 100,
      nodeVersion: '20.0.0',
      npmVersion: '10.0.0',
      goodjobVersion: '0.1.0',
    },
    healthScore: { total: 20, max: 20, security: 5, dependencies: 5, codeQuality: 5, projectHealth: 5, breakdown: [] },
    ...overrides,
  };
}

describe('policy engine', () => {

  it('returns empty violations when no policy configured', () => {
    const report = makeReport();
    const violations = evaluatePolicy(report, undefined);
    expect(violations).toEqual([]);
  });

  it('returns empty violations when all rules pass', () => {
    const report = makeReport();
    const config: PolicyConfig = {
      error: [{ rule: 'health < 10', description: 'Health must be >= 10' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toEqual([]);
  });

  it('detects health score below threshold (error level)', () => {
    const report = makeReport({ healthScore: { total: 8, max: 20, security: 2, dependencies: 2, codeQuality: 2, projectHealth: 2, breakdown: [] } });
    const config: PolicyConfig = {
      error: [{ rule: 'health < 10', description: 'Health must be >= 10' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].level).toBe('error');
    expect(violations[0].actual).toBe(8);
    expect(violations[0].threshold).toBe(10);
  });

  it('detects critical severity issues', () => {
    const report = makeReport({
      summary: { total: 1, errors: 1, warnings: 0, info: 0, bySeverity: { critical: 1, high: 0, medium: 0, low: 0 }, byCategory: { security: 1 } },
    });
    const config: PolicyConfig = {
      error: [{ rule: 'severity.critical > 0', description: 'No critical issues' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].level).toBe('error');
    expect(violations[0].field).toBe('severity.critical');
  });

  it('detects warning-level issues exceeding threshold', () => {
    const report = makeReport({
      summary: { total: 15, errors: 0, warnings: 15, info: 0, bySeverity: { critical: 0, high: 5, medium: 10, low: 0 }, byCategory: {} },
    });
    const config: PolicyConfig = {
      warning: [{ rule: 'level.warning > 10', description: 'Too many warnings' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].level).toBe('warning');
    expect(violations[0].actual).toBe(15);
  });

  it('detects tool-specific issue count', () => {
    const report = makeReport();
    report.tools['npm-audit'] = {
      tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
      status: 'success', durationMs: 100,
      issues: [
        { level: 'error', tool: 'npm-audit', category: 'security', severity: 'critical', message: 'vuln', cve: 'CVE-2024-0001' },
      ],
    };
    report.summary = { total: 1, errors: 1, warnings: 0, info: 0, bySeverity: { critical: 1, high: 0, medium: 0, low: 0 }, byCategory: { security: 1 } };

    const config: PolicyConfig = {
      error: [{ rule: 'tool.npm-audit.errors > 0', description: 'npm audit must have 0 errors' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('tool.npm-audit.errors');
    expect(violations[0].actual).toBe(1);
  });

  it('evaluates multiple rules and returns all violations', () => {
    const report = makeReport({ healthScore: { total: 10, max: 20, security: 2, dependencies: 3, codeQuality: 3, projectHealth: 2, breakdown: [] } });
    report.summary = { total: 3, errors: 1, warnings: 2, info: 0, bySeverity: { critical: 1, high: 2, medium: 0, low: 0 }, byCategory: {} };
    const config: PolicyConfig = {
      error: [
        { rule: 'health < 14' },
        { rule: 'severity.critical > 0' },
      ],
      warning: [
        { rule: 'level.warning > 0' },
      ],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(3);
    expect(violations.filter((v) => v.level === 'error')).toHaveLength(2);
    expect(violations.filter((v) => v.level === 'warning')).toHaveLength(1);
  });

  it('handles malformed rules gracefully (skip, no crash)', () => {
    const report = makeReport({ healthScore: { total: 5, max: 20, security: 1, dependencies: 2, codeQuality: 1, projectHealth: 1, breakdown: [] } });
    const config: PolicyConfig = {
      error: [
        { rule: 'health < 10' },
        { rule: 'this is not a valid rule!!!' },
        { rule: 'health > 3' },
      ],
    };
    // Should not throw
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(2); // health < 10 and health > 3 both pass (5<10 pass, 5>3 pass)
    // Actually: health < 10 → 5 < 10 → true → violation
    // health > 3 → 5 > 3 → true → violation
    // malformed → skipped
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('uses description from config when provided', () => {
    const report = makeReport({ healthScore: { total: 5, max: 20, security: 1, dependencies: 2, codeQuality: 1, projectHealth: 1, breakdown: [] } });
    const config: PolicyConfig = {
      error: [{ rule: 'health < 10', description: 'Custom: health too low' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations[0].description).toBe('Custom: health too low');
  });

  it('treats missing tool as 0 (rule does not fire)', () => {
    const report = makeReport();
    const config: PolicyConfig = {
      error: [{ rule: 'tool.nonexistent.issues > 0', description: 'No issues from nonexistent tool' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(0);
  });

  it('detects duplicates threshold', () => {
    const report = makeReport();
    report.tools['lockfile-analysis'] = {
      tool: 'lockfile-analysis', label: 'Lockfile Analysis', version: 'built-in',
      status: 'success', durationMs: 10,
      issues: [
        { level: 'warning', tool: 'lockfile-analysis', category: 'duplicate', severity: 'medium', message: 'lodash x2' },
        { level: 'warning', tool: 'lockfile-analysis', category: 'duplicate', severity: 'medium', message: 'chalk x2' },
        { level: 'info', tool: 'lockfile-analysis', category: 'other', severity: 'low', message: 'Lockfile info' },
      ],
    };
    const config: PolicyConfig = {
      error: [{ rule: 'duplicates > 1', description: 'Too many duplicate packages' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].actual).toBe(2);
  });

  it('handles >= operator', () => {
    // Rules are BREACH conditions: >= matches actual >= threshold
    const report = makeReport({ healthScore: { total: 18, max: 20, security: 5, dependencies: 4, codeQuality: 5, projectHealth: 4, breakdown: [] } });
    const config: PolicyConfig = {
      error: [{ rule: 'health >= 15', description: 'Breach if health >= 15' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(1); // 18 >= 15 → breach
    expect(violations[0].operator).toBe('>=');
    expect(violations[0].actual).toBe(18);
    expect(violations[0].threshold).toBe(15);
  });

  it('handles != operator', () => {
    const report = makeReport({ healthScore: { total: 18, max: 20, security: 5, dependencies: 4, codeQuality: 5, projectHealth: 4, breakdown: [] } });
    const config: PolicyConfig = {
      error: [{ rule: 'health != 20', description: 'Health must be exactly 20' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(1); // 18 != 20 → breach
  });

  it('handles no breach with != operator', () => {
    const report = makeReport({ healthScore: { total: 20, max: 20, security: 5, dependencies: 5, codeQuality: 5, projectHealth: 5, breakdown: [] } });
    const config: PolicyConfig = {
      error: [{ rule: 'health != 20', description: 'Health must be exactly 20' }],
    };
    const violations = evaluatePolicy(report, config);
    expect(violations).toHaveLength(0); // 20 != 20 is false → no breach
  });

});
