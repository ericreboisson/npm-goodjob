// ---------------------------------------------------------------------------
// npm-goodjob — Baseline and Diff engine
// Saves audit snapshots and compares against them to show trends.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReport, HealthScore, IssueCategory } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaselineReport {
  createdAt: string;
  projectName: string;
  projectPath: string;
  healthScore: HealthScore | undefined;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  };
  tools: Record<string, { issues: number; errors: number; warnings: number; critical: number; high: number }>;
}

export interface HistorySnapshot {
  date: string;
  projectPath: string;
  healthScore: number;
  weightedScore: number;
  totals: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    byCategory: Record<string, number>;
  };
}

export interface DiffResult {
  health: { before: number; after: number; delta: number };
  summary: {
    total: { before: number; after: number; delta: number };
    errors: { before: number; after: number; delta: number };
    warnings: { before: number; after: number; delta: number };
    info: { before: number; after: number; delta: number };
  };
  severity: Record<string, { before: number; after: number; delta: number }>;
  tools: Record<string, { before: number; after: number; delta: number }>;
  newTools: string[];
  removedTools: string[];
  healthScoreImproved: boolean;
  overallImproved: boolean;
  newCves: string[];
  categoryDeltas: Record<string, number>;
  trend: HistorySnapshot[];
}

// ---------------------------------------------------------------------------
// Store baseline
// ---------------------------------------------------------------------------

export function storeBaseline(report: AuditReport, filePath: string): void {
  const tools: BaselineReport['tools'] = {};
  for (const [name, toolResult] of Object.entries(report.tools)) {
    tools[name] = {
      issues: toolResult.issues.length,
      errors: toolResult.issues.filter((i) => i.level === 'error').length,
      warnings: toolResult.issues.filter((i) => i.level === 'warning').length,
      critical: toolResult.issues.filter((i) => i.severity === 'critical').length,
      high: toolResult.issues.filter((i) => i.severity === 'high').length,
    };
  }

  const baseline: BaselineReport = {
    createdAt: new Date().toISOString(),
    projectName: report.metadata.projectName,
    projectPath: report.metadata.projectPath,
    healthScore: report.healthScore,
    summary: {
      total: report.summary.total,
      errors: report.summary.errors,
      warnings: report.summary.warnings,
      info: report.summary.info,
      bySeverity: { ...report.summary.bySeverity },
      byCategory: { ...report.summary.byCategory },
    },
    tools,
  };

  writeFileSync(filePath, JSON.stringify(baseline, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Load baseline
// ---------------------------------------------------------------------------

export function loadBaseline(filePath: string): BaselineReport | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as BaselineReport;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run history (trend tracking)
// ---------------------------------------------------------------------------

function historyDir(projectPath: string): string {
  const safe = projectPath.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_{2,}/g, '_');
  return join(projectPath, '.goodjob-data', 'history', safe);
}

export function saveRunToHistory(report: AuditReport): void {
  const dir = historyDir(report.metadata.projectPath);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'history.ndjson');
  const entry: HistorySnapshot = {
    date: report.metadata.timestamp,
    projectPath: report.metadata.projectPath,
    healthScore: report.healthScore?.total ?? 0,
    weightedScore: report.healthScore?.weighted?.score ?? report.healthScore?.total ?? 0,
    totals: {
      total: report.summary.total,
      errors: report.summary.errors,
      warnings: report.summary.warnings,
      info: report.summary.info,
      byCategory: { ...report.summary.byCategory },
    },
  };
  writeFileSync(filePath, JSON.stringify(entry) + '\n', { flag: 'a' });
  // Trim to last 30 entries
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.trim().split('\n');
    if (lines.length > 30) {
      writeFileSync(filePath, lines.slice(lines.length - 30).join('\n') + '\n', 'utf-8');
    }
  } catch { /* ignore */ }
}

export function loadRunHistory(projectPath: string, limit = 10): HistorySnapshot[] {
  const dir = historyDir(projectPath);
  const filePath = join(dir, 'history.ndjson');
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const snapshots: HistorySnapshot[] = raw.trim().split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HistorySnapshot);
    return snapshots.slice(-limit);
  } catch {
    return [];
  }
}

export function computeTrend(history: HistorySnapshot[]): { direction: 'up' | 'down' | 'flat'; change: number } {
  if (history.length < 2) return { direction: 'flat', change: 0 };
  const first = history[0].weightedScore;
  const last = history[history.length - 1].weightedScore;
  const change = last - first;
  return {
    direction: change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat',
    change,
  };
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

export function computeDiff(report: AuditReport, baseline: BaselineReport): DiffResult {
  const healthBefore = baseline.healthScore?.total ?? 20;
  const healthAfter = report.healthScore?.total ?? 20;

  const tools: Record<string, { before: number; after: number; delta: number }> = {};
  const baselineToolNames = new Set(Object.keys(baseline.tools));
  const currentToolNames = new Set(Object.keys(report.tools));

  for (const name of baselineToolNames) {
    const before = baseline.tools[name]?.issues ?? 0;
    const after = report.tools[name]?.issues.length ?? 0;
    tools[name] = { before, after, delta: after - before };
  }
  for (const name of currentToolNames) {
    if (!baselineToolNames.has(name)) {
      tools[name] = { before: 0, after: report.tools[name]?.issues.length ?? 0, delta: report.tools[name]?.issues.length ?? 0 };
    }
  }

  const newTools = [...currentToolNames].filter((n) => !baselineToolNames.has(n));
  const removedTools = [...baselineToolNames].filter((n) => !currentToolNames.has(n));

  const severity: Record<string, { before: number; after: number; delta: number }> = {};
  const allSevs = new Set([...Object.keys(baseline.summary.bySeverity), ...Object.keys(report.summary.bySeverity)]);
  for (const sev of allSevs) {
    const sevKey = sev as 'critical' | 'high' | 'medium' | 'low';
    const before = baseline.summary.bySeverity[sevKey] ?? 0;
    const after = report.summary.bySeverity[sevKey] ?? 0;
    severity[sev] = { before, after, delta: after - before };
  }

  const newCves: string[] = [];
  const cveSeen = new Set<string>();
  for (const toolResult of Object.values(report.tools)) {
    for (const issue of toolResult.issues) {
      if (issue.cve && !cveSeen.has(issue.cve)) {
        cveSeen.add(issue.cve);
        newCves.push(issue.cve);
      }
    }
  }

  // Category deltas
  const allCategories = new Set([
    ...Object.keys(baseline.summary.byCategory),
    ...Object.keys(report.summary.byCategory),
  ]);
  const categoryDeltas: Record<string, number> = {};
  for (const cat of allCategories) {
    const catKey = cat as IssueCategory;
    const before = baseline.summary.byCategory[catKey] ?? 0;
    const after = report.summary.byCategory[catKey] ?? 0;
    if (after !== before) {
      categoryDeltas[cat] = after - before;
    }
  }

  // Trend data
  const trend = loadRunHistory(report.metadata.projectPath, 10);

  const totalDelta = report.summary.total - baseline.summary.total;
  const errorsDelta = report.summary.errors - baseline.summary.errors;

  return {
    health: { before: healthBefore, after: healthAfter, delta: healthAfter - healthBefore },
    summary: {
      total: { before: baseline.summary.total, after: report.summary.total, delta: totalDelta },
      errors: { before: baseline.summary.errors, after: report.summary.errors, delta: errorsDelta },
      warnings: { before: baseline.summary.warnings, after: report.summary.warnings, delta: report.summary.warnings - baseline.summary.warnings },
      info: { before: baseline.summary.info, after: report.summary.info, delta: report.summary.info - baseline.summary.info },
    },
    severity,
    tools,
    newTools,
    removedTools,
    healthScoreImproved: healthAfter > healthBefore,
    overallImproved: totalDelta <= 0 && errorsDelta <= 0 && healthAfter >= healthBefore,
    newCves,
    categoryDeltas,
    trend,
  };
}

// ---------------------------------------------------------------------------
// Diff formatter (console)
// ---------------------------------------------------------------------------

export function formatDiff(diff: DiffResult): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push('\x1b[1mBaseline Diff\x1b[0m');
  lines.push('');

  // Health score
  const healthArrow = diff.health.delta > 0 ? '\x1b[32m▲' : diff.health.delta < 0 ? '\x1b[31m▼' : '\x1b[2m▬';
  lines.push(
    `  Health: \x1b[1m${diff.health.before}\x1b[0m/\x1b[2m20\x1b[0m → \x1b[1m${diff.health.after}\x1b[0m/\x1b[2m20\x1b[0m  ${healthArrow} ${diff.health.delta > 0 ? '+' : ''}${diff.health.delta}\x1b[0m`,
  );

  // Summary counts
  const deltaStr = (n: number) => n > 0 ? `\x1b[31m+${n}\x1b[0m` : n < 0 ? `\x1b[32m${n}\x1b[0m` : `\x1b[2m${n}\x1b[0m`;
  lines.push(`  Issues:  ${diff.summary.total.before} → ${diff.summary.total.after}  ${deltaStr(diff.summary.total.delta)}`);
  lines.push(`  Errors:  ${diff.summary.errors.before} → ${diff.summary.errors.after}  ${deltaStr(diff.summary.errors.delta)}`);
  lines.push(`  Warnings: ${diff.summary.warnings.before} → ${diff.summary.warnings.after}  ${deltaStr(diff.summary.warnings.delta)}`);

  // Severity
  lines.push('');
  lines.push('  \x1b[1mBy Severity:\x1b[0m');
  for (const [sev, data] of Object.entries(diff.severity)) {
    if (data.before === 0 && data.after === 0) continue;
    lines.push(`    ${sev}: ${data.before} → ${data.after}  ${deltaStr(data.delta)}`);
  }

  // Tools
  const changedTools = Object.entries(diff.tools).filter(([, d]) => d.delta !== 0 || d.before > 0);
  if (changedTools.length > 0 || diff.newTools.length > 0 || diff.removedTools.length > 0) {
    lines.push('');
    lines.push('  \x1b[1mBy Tool:\x1b[0m');
    for (const [name, data] of changedTools) {
      lines.push(`    ${name}: ${data.before} → ${data.after}  ${deltaStr(data.delta)}`);
    }
    for (const name of diff.newTools) {
      lines.push(`    ${name}: \x1b[32mNEW\x1b[0m`);
    }
    for (const name of diff.removedTools) {
      lines.push(`    ${name}: \x1b[31mREMOVED\x1b[0m`);
    }
  }

  // New CVEs
  if (diff.newCves.length > 0) {
    lines.push('');
    lines.push(`  \x1b[33m\x1b[1mNew CVEs:\x1b[0m`);
    for (const cve of diff.newCves) {
      lines.push(`    \x1b[33m⚠ ${cve}\x1b[0m`);
    }
  }

  // Category regressions
  const regressedCats = Object.entries(diff.categoryDeltas).filter(([, d]) => d > 0);
  if (regressedCats.length > 0) {
    lines.push('');
    lines.push(`  \x1b[31m\x1b[1mRegressions:\x1b[0m`);
    for (const [cat, delta] of regressedCats) {
      lines.push(`    \x1b[31m${cat}: +${delta}\x1b[0m`);
    }
  }

  // Trend chart (sparkline)
  if (diff.trend.length >= 2) {
    const vals = diff.trend.map(s => s.weightedScore);
    const trendDir = vals[vals.length - 1] > vals[0] ? '\x1b[32m↗\x1b[0m' : vals[vals.length - 1] < vals[0] ? '\x1b[31m↘\x1b[0m' : '\x1b[2m→\x1b[0m';
    lines.push('');
    lines.push(`  \x1b[1mTrend (last ${vals.length} runs):\x1b[0m ${trendDir}  ${vals.join(' → ')}`);
  }

  // Verdict
  lines.push('');
  if (diff.overallImproved) {
    lines.push(`  \x1b[32m✓ Overall: Improved\x1b[0m`);
  } else if (diff.healthScoreImproved) {
    lines.push(`  \x1b[33m∼ Overall: Mixed (health up, issues may be up)\x1b[0m`);
  } else {
    lines.push(`  \x1b[31m✗ Overall: Regressed\x1b[0m`);
  }
  lines.push('');

  return lines.join('\n');
}

export function baselineSummary(report: AuditReport): string {
  const h = report.healthScore;
  const healthLine = h ? `Health: ${h.total}/${h.max}` : 'Health: N/A';
  return `${healthLine} — ${report.summary.total} issues (${report.summary.errors} errors, ${report.summary.warnings} warnings)`;
}
