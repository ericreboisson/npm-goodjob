// ---------------------------------------------------------------------------
// npm-goodjob — Orchestrator
// Runs all available tool runners and aggregates results into a single report.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { getAllTools } from './tools/base.js';
import './tools/index.js'; // side-effect: register all tools
import { loadConfig } from './config.js';
import { computeHealthScore } from './health-score.js';
import { evaluatePolicy } from './policy.js';
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
  /** Timeout per tool in ms (default: 120_000) */
  toolTimeoutMs?: number;
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
  const results: Array<{ name: string; result: ToolResult }> = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) {
      results.push(s.value);
    }
  }

  // Collect all issues
  const allIssues: Issue[] = [];
  for (const { result } of results) {
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

  const toolsRecord: Record<string, ToolResult> = {};
  for (const { name, result } of results) {
    toolsRecord[name] = result;
  }

  const report: AuditReport = {
    summary: {
      total: allIssues.length,
      errors,
      warnings,
      info,
      bySeverity,
      byCategory,
    },
    tools: toolsRecord,
    metadata: {
      projectName,
      projectPath: opts.projectPath,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startAll,
      nodeVersion: process.versions.node,
      npmVersion: getNpmVersion(),
      goodjobVersion: GOODJOB_VERSION,
    },
  };

  // Compute health score from the full report
  report.healthScore = computeHealthScore(report, config);

  // Evaluate policy rules from config
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

    // Recompute summary counts
    for (const iss of policyIssues) {
      allIssues.push(iss);
      report.summary.bySeverity[iss.severity] = (report.summary.bySeverity[iss.severity] ?? 0) + 1;
      report.summary.byCategory[iss.category] = (report.summary.byCategory[iss.category] ?? 0) + 1;
      if (iss.level === 'error') report.summary.errors++;
      else if (iss.level === 'warning') report.summary.warnings++;
      else report.summary.info++;
    }
    report.summary.total = allIssues.length;

    // Add meta-tool result for policy
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
