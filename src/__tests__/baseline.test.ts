import { describe, it, expect } from 'vitest';
import { storeBaseline, loadBaseline, computeDiff, formatDiff, type BaselineReport } from '../baseline.js';
import type { AuditReport } from '../types.js';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeReport(overrides?: Partial<AuditReport>): AuditReport {
  return {
    summary: {
      total: 5,
      errors: 1,
      warnings: 2,
      info: 2,
      bySeverity: { critical: 1, high: 1, medium: 2, low: 1 },
      byCategory: { security: 1, quality: 2, other: 2 },
    },
    tools: {
      'npm-audit': {
        tool: 'npm-audit', label: 'npm audit', version: '10.0.0',
        status: 'success', durationMs: 100,
        issues: [
          { level: 'error', tool: 'npm-audit', category: 'security', severity: 'critical', message: 'vuln1' },
          { level: 'warning', tool: 'npm-audit', category: 'security', severity: 'high', message: 'vuln2' },
        ],
      },
      'license-check': {
        tool: 'license-check', label: 'License Check', version: '1.0.0',
        status: 'success', durationMs: 50,
        issues: [
          { level: 'warning', tool: 'license-check', category: 'license', severity: 'high', message: 'GPL' },
        ],
      },
    },
    metadata: {
      projectName: 'test-project',
      projectPath: '/test',
      timestamp: '2025-01-01T00:00:00.000Z',
      durationMs: 200,
      nodeVersion: '20.0.0',
      npmVersion: '10.0.0',
      goodjobVersion: '0.1.0',
    },
    healthScore: { total: 14, max: 20, security: 3, dependencies: 4, codeQuality: 4, projectHealth: 3, breakdown: [] },
    ...overrides,
  };
}

describe('baseline store/load', () => {
  it('stores and loads baseline correctly', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gj-test-'));
    const filePath = join(tmpDir, 'baseline.json');
    const report = makeReport();

    storeBaseline(report, filePath);
    expect(existsSync(filePath)).toBe(true);

    const loaded = loadBaseline(filePath);
    expect(loaded).not.toBeNull();
    expect(loaded!.projectName).toBe('test-project');
    expect(loaded!.summary.total).toBe(5);
    expect(loaded!.healthScore!.total).toBe(14);
    expect(loaded!.tools['npm-audit'].issues).toBe(2);
    expect(loaded!.tools['license-check'].issues).toBe(1);

    // Cleanup
    unlinkSync(filePath);
  });

  it('returns null when baseline not found', () => {
    const loaded = loadBaseline('/nonexistent/baseline.json');
    expect(loaded).toBeNull();
  });
});

describe('baseline diff', () => {
  it('computes diff between two reports (regression)', () => {
    const baseline: BaselineReport = {
      createdAt: '2025-01-01T00:00:00.000Z',
      projectName: 'test',
      projectPath: '/test',
      healthScore: { total: 16, max: 20, security: 4, dependencies: 4, codeQuality: 4, projectHealth: 4, breakdown: [] },
      summary: { total: 3, errors: 0, warnings: 2, info: 1, bySeverity: { critical: 0, high: 1, medium: 1, low: 1 }, byCategory: {} },
      tools: {
        'npm-audit': { issues: 2, errors: 0, warnings: 2, critical: 0, high: 1 },
        'depcheck': { issues: 1, errors: 0, warnings: 0, critical: 0, high: 0 },
      },
    };

    const current = makeReport(); // 5 issues, 1 error, 2 warnings, 1 critical

    const diff = computeDiff(current, baseline);
    expect(diff.health.delta).toBe(-2); // 14 - 16
    expect(diff.summary.total.delta).toBe(2); // 5 - 3
    expect(diff.summary.errors.delta).toBe(1); // 1 - 0
    expect(diff.severity.critical.delta).toBe(1); // 1 - 0
    expect(diff.overallImproved).toBe(false);
    expect(diff.removedTools).toEqual(['depcheck']); // baseline had depcheck, current doesn't
    expect(diff.newTools).toContain('license-check');
  });

  it('computes diff with improvements', () => {
    const baseline: BaselineReport = {
      createdAt: '2025-01-01T00:00:00.000Z',
      projectName: 'test',
      projectPath: '/test',
      healthScore: { total: 10, max: 20, security: 2, dependencies: 3, codeQuality: 2, projectHealth: 3, breakdown: [] },
      summary: { total: 10, errors: 3, warnings: 5, info: 2, bySeverity: { critical: 3, high: 4, medium: 2, low: 1 }, byCategory: {} },
      tools: {
        'npm-audit': { issues: 8, errors: 3, warnings: 5, critical: 3, high: 4 },
        'license-check': { issues: 2, errors: 0, warnings: 2, critical: 0, high: 0 },
      },
    };

    const current = makeReport(); // 5 issues, 1 error, 2 warnings

    const diff = computeDiff(current, baseline);
    expect(diff.health.delta).toBe(4); // 14 - 10
    expect(diff.summary.total.delta).toBe(-5); // 5 - 10
    expect(diff.summary.errors.delta).toBe(-2); // 1 - 3
    expect(diff.overallImproved).toBe(true);
    expect(diff.healthScoreImproved).toBe(true);
    expect(diff.removedTools).toEqual([]); // same tools in baseline and current
  });

  it('handles tools appearing/disappearing between audits', () => {
    const baseline: BaselineReport = {
      createdAt: '2025-01-01T00:00:00.000Z',
      projectName: 'test',
      projectPath: '/test',
      healthScore: { total: 14, max: 20, security: 3, dependencies: 4, codeQuality: 4, projectHealth: 3, breakdown: [] },
      summary: { total: 5, errors: 1, warnings: 2, info: 2, bySeverity: { critical: 1, high: 1, medium: 2, low: 1 }, byCategory: {} },
      tools: {
        'npm-audit': { issues: 2, errors: 1, warnings: 1, critical: 1, high: 0 },
        'old-tool': { issues: 3, errors: 0, warnings: 3, critical: 0, high: 1 },
      },
    };

    const current = makeReport();

    const diff = computeDiff(current, baseline);
    expect(diff.newTools).toContain('license-check');
    expect(diff.removedTools).toContain('old-tool');
    expect(diff.tools['old-tool'].before).toBe(3);
    expect(diff.tools['old-tool'].after).toBe(0);
  });

  it('handles same state (no diff)', () => {
    const baseline: BaselineReport = {
      createdAt: '2025-01-01T00:00:00.000Z',
      projectName: 'test',
      projectPath: '/test',
      healthScore: { total: 14, max: 20, security: 3, dependencies: 4, codeQuality: 4, projectHealth: 3, breakdown: [] },
      summary: { total: 5, errors: 1, warnings: 2, info: 2, bySeverity: { critical: 1, high: 1, medium: 2, low: 1 }, byCategory: {} },
      tools: {
        'npm-audit': { issues: 2, errors: 1, warnings: 1, critical: 1, high: 0 },
        'license-check': { issues: 1, errors: 0, warnings: 1, critical: 0, high: 1 },
      },
    };

    const current = makeReport();

    const diff = computeDiff(current, baseline);
    expect(diff.health.delta).toBe(0);
    expect(diff.summary.total.delta).toBe(0);
    expect(diff.newTools).toEqual([]);
    expect(diff.removedTools).toEqual([]);
  });
});

describe('formatDiff', () => {
  it('produces formatted output without crashing', () => {
    const baseline: BaselineReport = {
      createdAt: '2025-01-01T00:00:00.000Z',
      projectName: 'test',
      projectPath: '/test',
      healthScore: { total: 10, max: 20, security: 2, dependencies: 3, codeQuality: 2, projectHealth: 3, breakdown: [] },
      summary: { total: 10, errors: 3, warnings: 5, info: 2, bySeverity: { critical: 3, high: 4, medium: 2, low: 1 }, byCategory: {} },
      tools: { 'npm-audit': { issues: 8, errors: 3, warnings: 5, critical: 3, high: 4 } },
    };
    const current = makeReport();
    const diff = computeDiff(current, baseline);
    const output = formatDiff(diff);

    expect(output).toContain('Health');
    expect(output).toContain('Issues');
    expect(output).toContain('npm-audit');
    expect(output).toContain('Improved');
  });
});
