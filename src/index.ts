// ---------------------------------------------------------------------------
// npm-goodjob — Public API
// ---------------------------------------------------------------------------

export { runAudit } from './runner.js';
export type { RunOptions } from './runner.js';

export type {
  AuditReport,
  GoodjobConfig,
  HealthScore,
  Issue,
  IssueCategory,
  IssueLevel,
  Severity,
  ToolOptions,
  ToolResult,
  ToolRunner,
  Reporter,
  DashboardReport,
  DashboardProject,
  DashboardProjectEntry,
  PolicyRule,
  PolicyConfig,
  PolicyViolation,
} from './types.js';

export { loadConfig, getDefaultConfig, clearConfigCache } from './config.js';

export { getAllTools, registerTool, getTool } from './tools/base.js';
export { evaluatePolicy } from './policy.js';
export { computeCacheKey, clearCache } from './cache.js';

export { jsonReporter, consoleReporter, htmlReporter, sarifReporter, writeJsonFile, writeHtmlFile, writeSarifFile } from './reporters/index.js';

export { isGitUrl, parseGitUrl, cloneRepo, resolveProjectPath } from './git-clone.js';
export type { CloneResult } from './git-clone.js';

export { saveRun, loadHistory, getHistoryIndex, loadRunData, listRunIds } from './history.js';
export type { HistoryEntry, HistoryIndex } from './history.js';

export { startServer, stopServer } from './serve.js';
export type { ServeOptions } from './serve.js';
