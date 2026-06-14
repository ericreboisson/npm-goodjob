// ---------------------------------------------------------------------------
// npm-goodjob — Core type definitions
// ---------------------------------------------------------------------------

/** Severity classification used across all tools */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** Issue category for grouping and filtering */
export type IssueCategory =
  | 'security'
  | 'unused-dependency'
  | 'missing-dependency'
  | 'outdated-dependency'
  | 'dead-code'
  | 'quality'
  | 'bundle-size'
  | 'architecture'
  | 'configuration'
  | 'license'
  | 'duplicate'
  | 'health'
  | 'other';

/** Issue level contributing to exit code */
export type IssueLevel = 'error' | 'warning' | 'info';

/** A single issue found by any audit tool */
export interface Issue {
  /** error / warning / info — determines exit code contribution */
  level: IssueLevel;
  /** Which tool reported this */
  tool: string;
  /** Semantic category */
  category: IssueCategory;
  /** Severity for human triage */
  severity: Severity;
  /** Human-readable title */
  message: string;
  /** Longer description (optional) */
  detail?: string;
  /** File path relative to project root (optional) */
  file?: string;
  /** Line number (optional) */
  line?: number;
  /** Column number (optional) */
  column?: number;
  /** Package name if dependency-related (optional) */
  package?: string;
  /** Installed version (optional) */
  version?: string;
  /** Recommended / fixed version (optional) */
  fixVersion?: string;
  /** CVE identifier if security-related (optional) */
  cve?: string;
  /** CVSS score if available (optional) */
  cvss?: number;
  /** GitHub advisory URL (optional) */
  advisory?: string;
}

/** Execution status of a single tool */
export type ToolStatus = 'success' | 'skipped' | 'error';

/** Result produced by one tool runner */
export interface ToolResult {
  /** Tool identifier (kebab-case) */
  tool: string;
  /** Human-readable tool name */
  label: string;
  /** Human-readable tool version (or "N/A") */
  version: string;
  /** Execution status */
  status: ToolStatus;
  /** Wall-clock duration in ms */
  durationMs: number;
  /** All issues found */
  issues: Issue[];
  /** Optional explanation when skipped */
  skipReason?: string;
  /** Optional error message when failed */
  errorMessage?: string;
}

/** Health score breakdown (0–N total, default 20) */
export interface HealthScore {
  total: number;
  max: number;
  security: number;
  dependencies: number;
  codeQuality: number;
  projectHealth: number;
  breakdown: Array<{
    label: string;
    score: number;
    max: number;
    detail: string;
  }>;
}

/** Aggregated report — the top-level output */
export interface AuditReport {
  /** Human-readable summary counts */
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    /** Count by severity */
    bySeverity: Record<Severity, number>;
    /** Count by category */
    byCategory: Record<IssueCategory, number>;
  };
  /** Per-tool results keyed by tool identifier */
  tools: Record<string, ToolResult>;
  /** Project / invocation metadata */
  metadata: {
    projectName: string;
    projectPath: string;
    timestamp: string;
    durationMs: number;
    nodeVersion: string;
    npmVersion: string;
    goodjobVersion: string;
  };
  /** Health score (optional, computed post-hoc) */
  healthScore?: HealthScore;
}

/** A single policy rule: e.g. "health < 14" or "severity.critical > 0" */
export interface PolicyRule {
  /** Human-readable description (auto-generated if empty) */
  description?: string;
  /** Expression: <field> <op> <value>, e.g. "health < 14", "severity.critical > 0" */
  rule: string;
}

/** Policy configuration — rules that must pass for the build to succeed */
export interface PolicyConfig {
  /** Rules that cause the build to FAIL (exit code 1) */
  error?: PolicyRule[];
  /** Rules that cause a warning (printed but exit code 0) */
  warning?: PolicyRule[];
}

/** Result of evaluating a single policy rule */
export interface PolicyViolation {
  rule: PolicyRule;
  level: 'error' | 'warning';
  field: string;
  operator: string;
  threshold: number;
  actual: number;
  description: string;
}

/** A single project entry in the multi-project dashboard */
export interface DashboardProject {
  /** Display name (e.g. "App Front Office") */
  name: string;
  /** Absolute or relative path to the project directory */
  path: string;
}

/** Per-project entry in a dashboard report */
export interface DashboardProjectEntry {
  /** Display name */
  name: string;
  /** Resolved absolute path */
  path: string;
  /** Audit result (undefined if tool errored) */
  report?: AuditReport;
  /** Execution duration in ms */
  durationMs: number;
  /** Whether the audit completed successfully */
  status: 'success' | 'error';
  /** Error message if status === 'error' */
  error?: string;
}

/** Aggregated multi-project dashboard report */
export interface DashboardReport {
  /** Per-project audit results */
  projects: DashboardProjectEntry[];
  /** Total wall-clock duration in ms */
  totalDurationMs: number;
  /** ISO timestamp */
  timestamp: string;
  /** Aggregated summary across all projects */
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
    info: number;
  };
}

/** User-facing config from .goodjobrc */
export interface GoodjobConfig {
  policy?: PolicyConfig;
  license?: {
    whitelist?: string[];
    blocklist?: string[];
  };
  healthScore?: {
    weights?: {
      security?: number;
      dependencies?: number;
      codeQuality?: number;
      projectHealth?: number;
    };
    thresholds?: {
      good?: number;
      warning?: number;
    };
  };
  tools?: {
    disabled?: string[];
    options?: Record<string, Record<string, unknown>>;
  };
  secretScanning?: {
    disabled?: boolean;
    excludePaths?: string[];
    extraPatterns?: Array<{
      name: string;
      pattern: string;
      severity: 'critical' | 'high' | 'medium';
    }>;
  };
  /** Package lint custom validation rules */
  pkgLint?: PkgLintConfig;
  /** Multi-project dashboard config */
  projects?: DashboardProject[];
}

export interface PkgLintConfig {
  /** Additional fields that must exist in package.json (dot-separated paths supported) */
  requireFields?: string[];
  /** Field path → regex pattern — validates the field value against the pattern */
  fieldPatterns?: Record<string, string>;
}

/** Options passed to every tool runner */
export interface ToolOptions {
  /** Absolute path to the project being audited */
  projectPath: string;
  /** Whether to include raw tool output in the result */
  verbose: boolean;
  /** Optional project config from .goodjobrc */
  config?: GoodjobConfig;
}

/** Interface every tool runner must implement */
export interface ToolRunner {
  /** Unique kebab-case identifier (e.g. "npm-audit") */
  readonly name: string;
  /** Human-readable label */
  readonly label: string;
  /** Quick check if this tool is usable (binary found, config exists, etc.) */
  isAvailable(cwd: string): boolean | Promise<boolean>;
  /** Run the tool and produce a result */
  run(options: ToolOptions): Promise<ToolResult>;
}

/** Reporter turns an AuditReport into output */
export interface Reporter {
  /** Write the report somewhere (stdout, file, etc.) */
  write(report: AuditReport): void | Promise<void>;
}
