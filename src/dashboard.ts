import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runAudit } from './runner.js';
import type { DashboardReport, DashboardProject, DashboardProjectEntry, GoodjobConfig } from './types.js';

export function loadProjects(config: GoodjobConfig, configPath: string): DashboardProject[] {
  if (config.projects && config.projects.length > 0) {
    return config.projects.map((p) => ({
      name: p.name,
      path: /^https?:\/\//.test(p.path) ? p.path : resolve(configPath, p.path),
    }));
  }
  return [];
}

/** Clone a remote git repo (GitHub URL) into a local cache, or pull if already cloned.
 *  Returns the local path, or null on failure. */
const REMOTE_DIR = '.goodjob-data/remote-repos';

export function resolveRemoteProject(project: DashboardProject, configPath: string): DashboardProject {
  const rawPath = project.path;
  const ghMatch = rawPath.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/);
  if (!ghMatch) return project;

  const [, owner, repoName] = ghMatch;
  const cacheDir = resolve(configPath, REMOTE_DIR);
  const localPath = resolve(cacheDir, `${owner}-${repoName}`);

  mkdirSync(cacheDir, { recursive: true });

  const gitOk = (() => {
    try { execSync('which git', { stdio: 'ignore' }); return true; }
    catch { return false; }
  })();
  if (!gitOk) {
    return { ...project, path: localPath };
  }

  try {
    if (existsSync(localPath)) {
      execSync('git pull --ff-only', { cwd: localPath, stdio: 'pipe', timeout: 60_000 });
    } else {
      execSync(`git clone "${rawPath.endsWith('.git') ? rawPath : rawPath + '.git'}" "${localPath}"`, { stdio: 'pipe', timeout: 120_000 });
    }
    return { ...project, path: localPath };
  } catch {
    console.error(`  \u{26A0} Failed to clone/pull ${rawPath} — check your network or git installation`);
    return { ...project, path: localPath };
  }
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

  // Aggregate bySeverity from all project reports
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const e of entries) {
    if (e.report?.summary.bySeverity) {
      for (const [sev, count] of Object.entries(e.report.summary.bySeverity)) {
        bySeverity[sev] = (bySeverity[sev] ?? 0) + count;
      }
    }
  }

  return {
    projects: entries,
    totalDurationMs,
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed, errors, warnings, info, bySeverity },
  };
}
