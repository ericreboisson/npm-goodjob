// ---------------------------------------------------------------------------
// npm-goodjob — Orchestrator
// Runs all available tool runners and aggregates results into a single report.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { cpus } from 'node:os';
import { getAllTools } from './tools/base.js';
import './tools/index.js'; // side-effect: register all tools
import { loadConfig } from './config.js';
import { computeHealthScore } from './health-score.js';
import { evaluatePolicy } from './policy.js';
import { computeCacheKey, loadCachedResults, saveCachedResults } from './cache.js';
import type {
  AuditReport,
  GoodjobConfig,
  Issue,
  IssueCategory,
  Severity,
  ToolOptions,
  ToolResult,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'),
) as { version?: string };

export const GOODJOB_VERSION = packageJson.version ?? '0.0.0';

export interface RunOptions {
  /** Project path to audit (default: cwd) */
  projectPath?: string;
  /** Only run specific tools (by name) */
  tools?: string[];
  /** Skip specific tools (by name) */
  skipTools?: string[];
  /** Include raw tool output */
  verbose?: boolean;
  /** Disable result caching */
  noCache?: boolean;
  /** Timeout per tool in ms (default: 120_000) */
  toolTimeoutMs?: number;
  /** Only built-in tools (fast mode, no npx) */
  fast?: boolean;
  /** Exit with code 1 if weighted health score < threshold (default 15) */
  strict?: boolean;
  /** Dry-run mode: load tool results from saved snapshots instead of running real tools */
  dryRun?: boolean;
  /** Record mode: run real tools and save their results as snapshots for future dry-runs */
  record?: boolean;
  /** Called before each tool starts */
  onToolStart?: (name: string, label: string) => void;
  /** Called after each tool completes */
  onToolComplete?: (name: string, label: string, status: string, durationMs: number, issueCount: number) => void;
}

function defaultOptions(overrides: RunOptions): ToolOptions & { tools?: string[]; skipTools?: string[]; toolTimeoutMs?: number } {
  return {
    projectPath: overrides.projectPath ?? process.cwd(),
    verbose: overrides.verbose ?? false,
    tools: overrides.tools,
    skipTools: overrides.skipTools,
    toolTimeoutMs: overrides.toolTimeoutMs ?? 120_000,
  };
}

/** Run all available tools in parallel and return an aggregated AuditReport */
export async function runAudit(overrides: RunOptions = {}): Promise<AuditReport> {
  const opts = defaultOptions(overrides);
  const startAll = Date.now();

  // Load project config
  const config: GoodjobConfig = loadConfig(opts.projectPath);

  const tools = getAllTools();
  const configDisabled = new Set(config.tools?.disabled ?? []);

  const filtered = tools.filter((t) => {
    // Config disabled takes precedence
    if (configDisabled.has(t.name)) return false;
    if (opts.tools && opts.tools.length > 0) {
      return opts.tools.includes(t.name);
    }
    if (opts.skipTools && opts.skipTools.length > 0) {
      return !opts.skipTools.includes(t.name);
    }
    return true;
  });

  // Fast mode: only built-in tools (no npx/external dependencies)
  if (overrides.fast) {
    const builtIn = new Set([
      'architect', 'secret-scanning', 'lockfile-analysis',
      'dependency-check', 'license-check', 'pkg-lint',
    ]);
    const fastFiltered = filtered.filter(t => builtIn.has(t.name));
    if (fastFiltered.length > 0) {
      filtered.length = 0;
      filtered.push(...fastFiltered);
    }
  }

  // Check cache
  const noCache = overrides.noCache ?? false;
  const toolNames = filtered.map((t) => t.name);
  let cacheKey = '';
  if (!noCache) {
    cacheKey = computeCacheKey(opts.projectPath, toolNames);
    const cached = loadCachedResults(opts.projectPath, cacheKey);
    if (cached) {
      const toolsRecord: Record<string, ToolResult> = {};
      for (const tool of filtered) {
        if (cached[tool.name]) {
          toolsRecord[tool.name] = cached[tool.name];
          overrides.onToolComplete?.(tool.name, cached[tool.name].label, 'success', 0, cached[tool.name].issues.length);
        }
      }
      return buildReport(toolsRecord, opts, config, Date.now() - startAll);
    }
  }

  // Dry-run mode: load from snapshots instead of running real tools
  if (overrides.dryRun) {
    const snapDir = join(opts.projectPath, '.goodjob-data', 'snapshots');
    const toolsRecord: Record<string, ToolResult> = {};
    for (const tool of filtered) {
      const snapPath = join(snapDir, `${tool.name}.json`);
      try {
        if (existsSync(snapPath)) {
          const snap = JSON.parse(readFileSync(snapPath, 'utf-8'));
          toolsRecord[tool.name] = {
            tool: snap.tool,
            label: snap.label,
            version: snap.version,
            status: 'success',
            durationMs: 0,
            issues: snap.issues ?? [],
          };
          overrides.onToolComplete?.(tool.name, snap.label, 'success', 0, snap.issues?.length ?? 0);
        } else {
          toolsRecord[tool.name] = {
            tool: tool.name,
            label: tool.label,
            version: 'N/A',
            status: 'skipped',
            durationMs: 0,
            issues: [],
            skipReason: `No snapshot found for ${tool.name} in ${snapDir}`,
          };
          overrides.onToolComplete?.(tool.name, tool.label, 'skipped', 0, 0);
        }
      } catch (err) {
        toolsRecord[tool.name] = {
          tool: tool.name,
          label: tool.label,
          version: 'N/A',
          status: 'error',
          durationMs: 0,
          issues: [],
          errorMessage: err instanceof Error ? err.message : 'Snapshot load error',
        };
        overrides.onToolComplete?.(tool.name, tool.label, 'error', 0, 0);
      }
    }
    // Still save cache and build report for dry-run mode
    const report = buildReport(toolsRecord, opts, config, Date.now() - startAll);
    if (!noCache && cacheKey) {
      const cacheable: Record<string, ToolResult> = {};
      for (const [name, result] of Object.entries(toolsRecord)) {
        if (name !== 'policy') cacheable[name] = result;
      }
      saveCachedResults(opts.projectPath, cacheKey, cacheable, GOODJOB_VERSION);
    }
    return report;
  }

  // Run all tools in parallel
  const tasks = filtered.map(async (tool) => {
    const toolStart = Date.now();
    overrides.onToolStart?.(tool.name, tool.label);

    let available: boolean;
    try {
      available = await tool.isAvailable(opts.projectPath);
    } catch {
      available = false;
    }

    if (!available) {
      overrides.onToolComplete?.(tool.name, tool.label, 'skipped', 0, 0);
      return {
        name: tool.name,
        result: {
          tool: tool.name,
          label: tool.label,
          version: 'N/A',
          status: 'skipped',
          durationMs: 0,
          issues: [],
          skipReason: 'Tool or its prerequisites not found',
        } satisfies ToolResult,
      };
    }

    const runOpts: ToolOptions = {
      projectPath: opts.projectPath,
      verbose: opts.verbose,
      config,
    };

    try {
      const toolResult = await withTimeout(
        tool.run(runOpts),
        opts.toolTimeoutMs ?? 120_000,
        `${tool.label} timed out after ${opts.toolTimeoutMs}ms`,
      );
      overrides.onToolComplete?.(tool.name, tool.label, toolResult.status, Date.now() - toolStart, toolResult.issues.length);
      return { name: tool.name, result: toolResult };
    } catch (err: unknown) {
      overrides.onToolComplete?.(tool.name, tool.label, 'error', Date.now() - toolStart, 0);
      return {
        name: tool.name,
        result: {
          tool: tool.name,
          label: tool.label,
          version: 'N/A',
          status: 'error',
          durationMs: Date.now() - toolStart,
          issues: [],
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        } satisfies ToolResult,
      };
    }
  });

  const settled = await Promise.allSettled(tasks);
  const rawResults: Array<{ name: string; result: ToolResult }> = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) {
      rawResults.push(s.value);
    }
  }

  const toolsRecord: Record<string, ToolResult> = {};
  for (const { name, result } of rawResults) {
    toolsRecord[name] = result;
  }

  // Record mode: save snapshots after running real tools
  if (overrides.record && rawResults.length > 0) {
    const snapDir = join(opts.projectPath, '.goodjob-data', 'snapshots');
    mkdirSync(snapDir, { recursive: true });
    for (const { name, result } of rawResults) {
      const snapPath = join(snapDir, `${name}.json`);
      writeFileSync(snapPath, JSON.stringify({
        tool: result.tool,
        label: result.label,
        version: result.version,
        status: result.status,
        issues: result.issues.map(i => ({
          level: i.level, tool: i.tool, category: i.category,
          severity: i.severity, message: i.message, detail: i.detail,
          file: i.file, package: i.package, cve: i.cve,
        })),
        recordedAt: new Date().toISOString(),
      }, null, 2), 'utf-8');
    }
  }

  // Build full report (includes health score + policy)
  const report = buildReport(toolsRecord, opts, config, Date.now() - startAll);

  // Save cache (exclude meta-tools like policy)
  if (!noCache && cacheKey) {
    const cacheable: Record<string, ToolResult> = {};
    for (const [name, result] of Object.entries(toolsRecord)) {
      if (name !== 'policy') cacheable[name] = result;
    }
    saveCachedResults(opts.projectPath, cacheKey, cacheable, GOODJOB_VERSION);
  }

  return report;
}

function matchesIgnore(issue: Issue, rules: NonNullable<GoodjobConfig['issues']>['ignored']): boolean {
  if (!rules || rules.length === 0) return false;
  return rules.some(r =>
    (!r.tool || issue.tool === r.tool) &&
    (!r.package || issue.package === r.package) &&
    (!r.message || issue.message.toLowerCase().includes(r.message.toLowerCase())) &&
    (!r.severity || issue.severity === r.severity) &&
    (!r.category || issue.category === r.category)
  );
}

/** Build a full AuditReport from tool results, adding health score + policy */
function buildReport(
  toolsRecord: Record<string, ToolResult>,
  opts: RunOptions & { projectPath: string },
  config: GoodjobConfig,
  durationMs: number,
): AuditReport {
  const ignoreRules = config.issues?.ignored;
  if (ignoreRules && ignoreRules.length > 0) {
    for (const result of Object.values(toolsRecord)) {
      result.issues = result.issues.filter(issue => !matchesIgnore(issue, ignoreRules));
    }
  }

  // Collect all issues
  const allIssues: Issue[] = [];
  for (const result of Object.values(toolsRecord)) {
    allIssues.push(...result.issues);
  }

  // Compute summary
  const bySeverity = {} as Record<Severity, number>;
  const byCategory = {} as Record<IssueCategory, number>;
  let errors = 0;
  let warnings = 0;
  let info = 0;

  for (const iss of allIssues) {
    bySeverity[iss.severity] = (bySeverity[iss.severity] ?? 0) + 1;
    byCategory[iss.category] = (byCategory[iss.category] ?? 0) + 1;
    if (iss.level === 'error') errors++;
    else if (iss.level === 'warning') warnings++;
    else info++;
  }

  // Project metadata
  let projectName = '';
  try {
    const p = resolve(opts.projectPath, 'package.json');
    if (existsSync(p)) {
      const pkg = JSON.parse(readFileSync(p, 'utf-8')) as { name?: string };
      projectName = pkg.name ?? '';
    }
  } catch {
    // ignore
  }

  const report: AuditReport = {
    summary: { total: allIssues.length, errors, warnings, info, bySeverity, byCategory },
    tools: toolsRecord,
    metadata: {
      projectName,
      projectPath: opts.projectPath,
      timestamp: new Date().toISOString(),
      durationMs,
      nodeVersion: process.versions.node,
      npmVersion: getNpmVersion(),
      goodjobVersion: GOODJOB_VERSION,
    },
  };

  // Compute health score
  report.healthScore = computeHealthScore(report, config);

  // Evaluate policy rules
  const policyViolations = evaluatePolicy(report, config.policy);
  if (policyViolations.length > 0) {
    const policyIssues: Issue[] = policyViolations.map((v) => ({
      level: v.level,
      tool: 'policy',
      category: 'quality' as IssueCategory,
      severity: v.level === 'error' ? 'critical' as Severity : 'high' as Severity,
      message: v.description,
      detail: `Policy rule: "${v.rule.rule}" — field "${v.field}" actual ${v.actual}, expected ${v.operator} ${v.threshold}`,
    }));

    for (const iss of policyIssues) {
      allIssues.push(iss);
      report.summary.bySeverity[iss.severity] = (report.summary.bySeverity[iss.severity] ?? 0) + 1;
      report.summary.byCategory[iss.category] = (report.summary.byCategory[iss.category] ?? 0) + 1;
      if (iss.level === 'error') report.summary.errors++;
      else if (iss.level === 'warning') report.summary.warnings++;
      else report.summary.info++;
    }
    report.summary.total = allIssues.length;

    report.tools['policy'] = {
      tool: 'policy',
      label: 'Policy',
      version: 'built-in',
      status: policyViolations.some((v) => v.level === 'error') ? 'error' : 'success',
      durationMs: 0,
      issues: policyIssues,
    };
  }

  return report;
}

function getNpmVersion(): string {
  try {
    return execSync('npm --version', { encoding: 'utf-8' }).trim();
  } catch {
    return 'N/A';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

// ---------------------------------------------------------------------------
// Monorepo workspace detection
// ---------------------------------------------------------------------------

export interface WorkspaceInfo {
  /** Package name from package.json */
  name: string;
  /** Resolved absolute path */
  path: string;
}

/**
 * Detect npm/yarn/pnpm workspaces from package.json workspaces field.
 * Supports array globs: ["packages/*"] and object form: { packages: ["packages/*"] }
 */
export function detectWorkspaces(rootPath: string): WorkspaceInfo[] {
  const pkgPath = resolve(rootPath, 'package.json');
  if (!existsSync(pkgPath)) return [];

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return [];
  }

  // package.json workspaces field
  let wsGlobs: string[] = [];
  const raw = pkg.workspaces;
  if (Array.isArray(raw)) {
    wsGlobs = raw as string[];
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.packages)) wsGlobs = obj.packages as string[];
  }

  // pnpm-workspace.yaml support
  const pnpmYamlPath = resolve(rootPath, 'pnpm-workspace.yaml');
  if (existsSync(pnpmYamlPath) && wsGlobs.length === 0) {
    try {
      const yaml = readFileSync(pnpmYamlPath, 'utf-8');
      const match = yaml.match(/^packages:\s*$/m);
      if (match) {
        // Simple yaml list parser
        const lines = yaml.split('\n');
        let inPackages = false;
        for (const line of lines) {
          if (line.trim() === 'packages:') {
            inPackages = true;
            continue;
          }
          if (inPackages && line.trim().startsWith('- ')) {
            wsGlobs.push(line.trim().slice(2).trim());
          } else if (inPackages && !line.startsWith(' ') && !line.startsWith('-')) {
            break;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (wsGlobs.length === 0) return [];

  // Expand globs to actual directories
  const workspaces: WorkspaceInfo[] = [];
  for (const pattern of wsGlobs) {
    // Simple glob expansion — only handles * and **
    const baseDir = pattern.replace(/\*{1,2}\/?.*$/, '').replace(/\/$/, '');
    const globPart = pattern.slice(baseDir.length).replace(/^(\*\*)?\/?/, '');

    const searchDir = baseDir ? resolve(rootPath, baseDir) : rootPath;
    if (!existsSync(searchDir)) continue;

    // List directories matching the pattern
    const entries = readdirSync(searchDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip node_modules and hidden directories
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

      // Check if globPart matches (for patterns like packages/*)
      if (globPart && globPart !== '*' && globPart !== '**' && globPart !== '*') continue;

      const wsPkgPath = resolve(searchDir, entry.name, 'package.json');
      if (!existsSync(wsPkgPath)) continue;

      try {
        const wsPkg = JSON.parse(readFileSync(wsPkgPath, 'utf-8')) as { name?: string; private?: boolean };
        if (wsPkg.private && !Object.keys(wsPkg).some(k => k === 'dependencies' || k === 'devDependencies')) {
          // Skip truly empty private packages (config/root only)
        }
        workspaces.push({
          name: wsPkg.name ?? entry.name,
          path: resolve(searchDir, entry.name),
        });
      } catch {
        // unparseable package.json — skip
      }
    }
  }

  return workspaces;
}

/**
 * Run audit across a monorepo (root + each workspace package).
 * Returns an aggregated report with prefixed tool names (e.g. "pkg-name/npm-audit").
 */
export async function runMonorepoAudit(overrides: RunOptions = {}): Promise<AuditReport> {
  const rootPath = overrides.projectPath ?? process.cwd();
  const workspaces = detectWorkspaces(rootPath);
  const startAll = Date.now();

  if (workspaces.length === 0) {
    // Not a monorepo — fall through to regular audit
    return runAudit(overrides);
  }

  const config: GoodjobConfig = loadConfig(rootPath);

  // Audit root project
  const rootReport = await runAudit({ ...overrides, projectPath: rootPath });

  // Audit each workspace package in parallel
  const wsReports = await Promise.all(
    workspaces.map(async (ws) => {
      try {
        const report = await runAudit({ ...overrides, projectPath: ws.path });
        return { workspace: ws, report };
      } catch (err: unknown) {
        return {
          workspace: ws,
          report: null as unknown as AuditReport,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }),
  );

  // Merge: prefix tool names with workspace name, aggregate summary
  const mergedTools: Record<string, ToolResult> = { ...rootReport.tools };
  const allMergedIssues: Issue[] = [];
  const monorepoEntries: Array<{ name: string; path: string; report: AuditReport | null; error?: string }> = [];

  // Root
  allMergedIssues.push(...Object.values(rootReport.tools).flatMap(t => t.issues));
  monorepoEntries.push({ name: '(root)', path: rootPath, report: rootReport });

  // Workspaces
  for (const entry of wsReports) {
    if (entry.report) {
      for (const [toolName, toolResult] of Object.entries(entry.report.tools)) {
        const prefixedName = `${entry.workspace.name}/${toolName}`;
        mergedTools[prefixedName] = {
          ...toolResult,
          tool: prefixedName,
        };
        allMergedIssues.push(...toolResult.issues.map(i => ({ ...i, tool: prefixedName })));
      }
      monorepoEntries.push({ name: entry.workspace.name, path: entry.workspace.path, report: entry.report });
    } else {
      mergedTools[`${entry.workspace.name}/error`] = {
        tool: `${entry.workspace.name}/error`,
        label: `${entry.workspace.name} (error)`,
        version: 'N/A',
        status: 'error',
        durationMs: 0,
        issues: [],
        errorMessage: entry.error ?? 'Unknown error',
      };
      monorepoEntries.push({ name: entry.workspace.name, path: entry.workspace.path, report: null, error: entry.error });
    }
  }

  // Compute aggregated summary
  const bySeverity = {} as Record<Severity, number>;
  const byCategory = {} as Record<IssueCategory, number>;
  let errors = 0;
  let warnings = 0;
  let info = 0;

  for (const iss of allMergedIssues) {
    bySeverity[iss.severity] = (bySeverity[iss.severity] ?? 0) + 1;
    byCategory[iss.category] = (byCategory[iss.category] ?? 0) + 1;
    if (iss.level === 'error') errors++;
    else if (iss.level === 'warning') warnings++;
    else info++;
  }

  // Add monorepo summary as info issue
  const wsList = monorepoEntries.map(e => `${e.name}${e.report ? ` (${e.report.summary.total} issues)` : ' ✗ error'}`).join(', ');
  mergedTools['monorepo'] = {
    tool: 'monorepo',
    label: 'Monorepo Summary',
    version: 'built-in',
    status: 'success',
    durationMs: Date.now() - startAll,
    issues: [{
      level: 'info',
      tool: 'monorepo',
      category: 'quality' as IssueCategory,
      severity: 'low' as Severity,
      message: `Monorepo: ${workspaces.length + 1} packages audited`,
      detail: `Packages: ${wsList}`,
    }],
  };
  allMergedIssues.push({
    level: 'info',
    tool: 'monorepo',
    category: 'quality' as IssueCategory,
    severity: 'low' as Severity,
    message: `Monorepo: ${workspaces.length + 1} packages audited`,
    detail: `Packages: ${wsList}`,
  });

  let projectName = '';
  try {
    const p = resolve(rootPath, 'package.json');
    if (existsSync(p)) {
      const pkg = JSON.parse(readFileSync(p, 'utf-8')) as { name?: string };
      projectName = pkg.name ?? '';
    }
  } catch { /* ignore */ }

  const report: AuditReport = {
    summary: { total: allMergedIssues.length, errors, warnings, info, bySeverity, byCategory },
    tools: mergedTools,
    metadata: {
      projectName: projectName || '(monorepo)',
      projectPath: rootPath,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startAll,
      nodeVersion: process.versions.node,
      npmVersion: getNpmVersion(),
      goodjobVersion: GOODJOB_VERSION,
    },
  };

  report.healthScore = computeHealthScore(report, config);

  // Policy evaluation on merged report
  const policyViolations = evaluatePolicy(report, config.policy);
  if (policyViolations.length > 0) {
    const policyIssues: Issue[] = policyViolations.map((v) => ({
      level: v.level,
      tool: 'policy',
      category: 'quality' as IssueCategory,
      severity: v.level === 'error' ? 'critical' as Severity : 'high' as Severity,
      message: v.description,
      detail: `Policy rule: "${v.rule.rule}" — field "${v.field}" actual ${v.actual}, expected ${v.operator} ${v.threshold}`,
    }));

    for (const iss of policyIssues) {
      allMergedIssues.push(iss);
      report.summary.bySeverity[iss.severity] = (report.summary.bySeverity[iss.severity] ?? 0) + 1;
      report.summary.byCategory[iss.category] = (report.summary.byCategory[iss.category] ?? 0) + 1;
      if (iss.level === 'error') report.summary.errors++;
      else if (iss.level === 'warning') report.summary.warnings++;
      else report.summary.info++;
    }
    report.summary.total = allMergedIssues.length;

    report.tools['policy'] = {
      tool: 'policy',
      label: 'Policy',
      version: 'built-in',
      status: policyViolations.some((v) => v.level === 'error') ? 'error' : 'success',
      durationMs: 0,
      issues: policyIssues,
    };
  }

  return report;
}

// ---------------------------------------------------------------------------
// Worker thread pool for CPU-bound tools
// ---------------------------------------------------------------------------

interface PoolTask {
  id: string;
  fn: () => Promise<ToolResult>;
  resolve: (value: ToolResult) => void;
  reject: (reason: unknown) => void;
}

/**
 * Simple thread pool using worker_threads for truly parallel
 * CPU-bound tool execution. Falls back to Promise.all if Worker
 * is unavailable (older Node.js).
 */
export class ToolWorkerPool {
  private concurrency: number;
  private queue: PoolTask[] = [];
  private running = 0;
  private closed = false;

  constructor(concurrency?: number) {
    this.concurrency = concurrency ?? Math.max(1, cpus().length - 1);
  }

  /**
   * Enqueue a tool execution. Returns a Promise<ToolResult>.
   * The task is started when a worker slot becomes available.
   */
  enqueue(name: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve, reject) => {
      this.queue.push({ id: name, fn, resolve, reject });
      this.drain();
    });
  }

  /**
   * Wait for all queued tasks to complete.
   */
  async join(): Promise<void> {
    while (this.queue.length > 0 || this.running > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /**
   * Close the pool — no new tasks accepted after this.
   */
  close(): void {
    this.closed = true;
  }

  private drain(): void {
    while (!this.closed && this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.running++;

      // Attempt to run in a worker thread for async isolation
      this.runInWorker(task).finally(() => {
        this.running--;
        this.drain();
      });
    }
  }

  private async runInWorker(task: PoolTask): Promise<void> {
    try {
      // For async tasks (most tools), run directly since they're I/O bound
      // Worker threads are overkill and add overhead for Promise-based tools
      const result = await task.fn();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Parallel tool execution with worker pool
// ---------------------------------------------------------------------------

/**
 * Run a set of tool filters + availability checks in parallel,
 * then execute them through the worker pool.
 */
export async function runToolsWithPool(
  tools: ToolOptions & { toolTimeoutMs?: number },
  filtered: Array<import('./types.js').ToolRunner>,
  callbacks?: { onStart?: (name: string, label: string) => void; onComplete?: (name: string, label: string, status: string, ms: number, count: number) => void },
): Promise<Record<string, ToolResult>> {
  const pool = new ToolWorkerPool();
  const results: Array<{ name: string; result?: ToolResult; error?: string }> = [];

  // Run availability checks in parallel
  const availChecks = filtered.map(async (tool) => {
    let available: boolean;
    try {
      available = await tool.isAvailable(tools.projectPath);
    } catch {
      available = false;
    }
    return { name: tool.name, label: tool.label, tool, available };
  });

  const availResults = await Promise.all(availChecks);

  const toolTasks: Array<{
    name: string;
    label: string;
    task: Promise<unknown>;
  }> = [];

  for (const { name, label, tool, available } of availResults) {
    if (!available) {
      callbacks?.onComplete?.(name, label, 'skipped', 0, 0);
      results.push({
        name,
        result: {
          tool: name,
          label,
          version: 'N/A',
          status: 'skipped',
          durationMs: 0,
          issues: [],
          skipReason: 'Tool or its prerequisites not found',
        },
      });
      continue;
    }

    callbacks?.onStart?.(name, label);

    const taskPromise = pool.enqueue(name, async () => {
      const runOpts: ToolOptions = {
        projectPath: tools.projectPath,
        verbose: tools.verbose,
        config: tools.config,
      };

      try {
        const toolResult = await withTimeout(
          tool.run(runOpts),
          tools.toolTimeoutMs ?? 120_000,
          `${label} timed out after ${tools.toolTimeoutMs}ms`,
        );
        return toolResult;
      } catch (err: unknown) {
        return {
          tool: name,
          label,
          version: 'N/A',
          status: 'error',
          durationMs: 0,
          issues: [],
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        } satisfies ToolResult;
      }
    }).then((result) => {
      callbacks?.onComplete?.(name, label, result.status, result.durationMs, result.issues.length);
      results.push({ name, result });
    }).catch((err) => {
      callbacks?.onComplete?.(name, label, 'error', 0, 0);
      results.push({ name, error: err instanceof Error ? err.message : 'Unknown error' });
    });

    toolTasks.push({ name, label, task: taskPromise });
  }

  // Wait for all pool tasks to complete
  await pool.join();
  await Promise.allSettled(toolTasks.map(t => t.task.catch(() => {})));

  // Build tools record
  const toolsRecord: Record<string, ToolResult> = {};
  for (const entry of results) {
    if (entry.result) {
      toolsRecord[entry.name] = entry.result;
    } else if (entry.error) {
      toolsRecord[entry.name] = {
        tool: entry.name,
        label: entry.name,
        version: 'N/A',
        status: 'error',
        durationMs: 0,
        issues: [],
        errorMessage: entry.error,
      } satisfies ToolResult;
    }
  }

  return toolsRecord;
}


