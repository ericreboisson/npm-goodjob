import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { runAudit } from './runner.js';
import type { DashboardReport, DashboardProject, DashboardProjectEntry, GoodjobConfig } from './types.js';

export function loadProjects(config: GoodjobConfig, configPath: string): DashboardProject[] {
  if (config.projects && config.projects.length > 0) {
    // Resolve relative paths against the config file location
    return config.projects.map((p) => ({
      name: p.name,
      path: resolve(configPath, p.path),
    }));
  }
  return [];
}

export async function runDashboard(
  projects: DashboardProject[],
  options?: { toolTimeoutMs?: number },
): Promise<DashboardReport> {
  const start = Date.now();
  const entries: DashboardProjectEntry[] = [];

  for (const project of projects) {
    const pStart = Date.now();
    if (!existsSync(resolve(project.path, 'package.json'))) {
      entries.push({
        name: project.name,
        path: project.path,
        durationMs: Date.now() - pStart,
        status: 'error',
        error: 'No package.json found at project path',
      });
      continue;
    }

    try {
      const report = await runAudit({
        projectPath: project.path,
        toolTimeoutMs: options?.toolTimeoutMs ?? 180_000,
      });
      entries.push({
        name: project.name,
        path: project.path,
        report,
        durationMs: Date.now() - pStart,
        status: 'success',
      });
    } catch (err) {
      entries.push({
        name: project.name,
        path: project.path,
        durationMs: Date.now() - pStart,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalDurationMs = Date.now() - start;
  const total = entries.reduce((sum, e) => sum + (e.report?.summary.total ?? 0), 0);
  const errors = entries.reduce((sum, e) => sum + (e.report?.summary.errors ?? 0), 0);
  const warnings = entries.reduce((sum, e) => sum + (e.report?.summary.warnings ?? 0), 0);
  const info = entries.reduce((sum, e) => sum + (e.report?.summary.info ?? 0), 0);
  const passed = entries.filter((e) => e.status === 'success').length;
  const failed = entries.filter((e) => e.status === 'error').length;

  return {
    projects: entries,
    totalDurationMs,
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed, errors, warnings, info },
  };
}
