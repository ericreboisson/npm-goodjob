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
  ToolStatus,
  Reporter,
} from './types.js';

export { loadConfig, getDefaultConfig, clearConfigCache } from './config.js';

export { getAllTools, registerTool, getTool } from './tools/base.js';
export { evaluatePolicy } from './policy.js';

export { jsonReporter, consoleReporter, htmlReporter, sarifReporter, writeJsonFile, writeHtmlFile, writeSarifFile } from './reporters/index.js';
