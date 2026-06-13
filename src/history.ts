// ---------------------------------------------------------------------------
// npm-goodjob — Audit history storage (JSON files in .goodjob-data/)
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReport } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  timestamp: string;
  projectPath: string;
  projectName: string;
  total: number;
  errors: number;
  warnings: number;
  info: number;
  healthScore?: { total: number; max: number };
  durationMs: number;
}

export interface HistoryIndex {
  runs: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

function getDataDir(projectPath: string): string {
  return join(projectPath, '.goodjob-data');
}

function getIndexPath(projectPath: string): string {
  return join(getDataDir(projectPath), 'history-idx.json');
}

function getRunsDir(projectPath: string): string {
  return join(getDataDir(projectPath), 'runs');
}

// ---------------------------------------------------------------------------
// Index load / save
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadIndex(projectPath: string): HistoryIndex {
  const idxPath = getIndexPath(projectPath);
  if (!existsSync(idxPath)) {
    return { runs: [] };
  }
  try {
    return JSON.parse(readFileSync(idxPath, 'utf-8')) as HistoryIndex;
  } catch {
    return { runs: [] };
  }
}

function saveIndex(projectPath: string, index: HistoryIndex): void {
  ensureDir(getDataDir(projectPath));
  writeFileSync(getIndexPath(projectPath), JSON.stringify(index, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Save an AuditReport to history. Returns the run ID. */
export function saveRun(report: AuditReport, projectPath?: string): string {
  const basePath = projectPath ?? report.metadata.projectPath;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Update index
  const index = loadIndex(basePath);
  const entry: HistoryEntry = {
    id,
    timestamp: report.metadata.timestamp,
    projectPath: basePath,
    projectName: report.metadata.projectName,
    total: report.summary.total,
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    info: report.summary.info,
    healthScore: report.healthScore
      ? { total: report.healthScore.total, max: report.healthScore.max }
      : undefined,
    durationMs: report.metadata.durationMs,
  };
  index.runs.unshift(entry); // newest first

  // Keep max 100 entries
  if (index.runs.length > 100) {
    index.runs = index.runs.slice(0, 100);
  }

  saveIndex(basePath, index);

  // Save full run data
  const runsDir = getRunsDir(basePath);
  ensureDir(runsDir);
  writeFileSync(join(runsDir, `${id}.json`), JSON.stringify(report, null, 2), 'utf-8');

  return id;
}

/** Load the history index (lightweight — summaries only). */
export function getHistoryIndex(projectPath: string): HistoryIndex {
  return loadIndex(projectPath);
}

/** Load the full AuditReport for a specific run ID. */
export function loadRunData(projectPath: string, id: string): AuditReport | null {
  const runPath = join(getRunsDir(projectPath), `${id}.json`);
  if (!existsSync(runPath)) return null;
  try {
    return JSON.parse(readFileSync(runPath, 'utf-8')) as AuditReport;
  } catch {
    return null;
  }
}

/** Load all history entries as an array (newest first). */
export function loadHistory(projectPath: string): HistoryEntry[] {
  return loadIndex(projectPath).runs;
}

/** List all stored run IDs. */
export function listRunIds(projectPath: string): string[] {
  const runsDir = getRunsDir(projectPath);
  if (!existsSync(runsDir)) return [];
  try {
    return readdirSync(runsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}
