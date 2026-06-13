// ---------------------------------------------------------------------------
// npm-goodjob — Policy as Code engine
// Evaluates policy rules (.goodjobrc -> policy) against an AuditReport and
// returns violations that can fail the build or warn.
// ---------------------------------------------------------------------------

import type { AuditReport, PolicyConfig, PolicyRule, PolicyViolation } from './types.js';

// ---------------------------------------------------------------------------
// Expression parser
// ---------------------------------------------------------------------------

interface ParsedExpr {
  field: string;
  op: '<' | '>' | '<=' | '>=' | '==' | '!=' | '=';
  threshold: number;
}

function parseExpression(rule: string): ParsedExpr {
  const match = rule.match(
    /^\s*([a-zA-Z0-9_.-]+)\s*(<=|>=|==|!=|<|>)\s*(\d+(?:\.\d+)?)\s*$/,
  );
  if (!match) {
    throw new Error(
      `Invalid policy rule expression: "${rule}". Expected format: <field> <op> <number>, e.g. "health < 14"`,
    );
  }
  return {
    field: match[1],
    op: match[2] as ParsedExpr['op'],
    threshold: parseFloat(match[3]),
  };
}

// ---------------------------------------------------------------------------
// Field resolver — extracts a numeric value from the report by dotted path
// ---------------------------------------------------------------------------

function resolveField(report: AuditReport, field: string): number {
  // Shortcut: health
  if (field === 'health' || field === 'score') {
    return report.healthScore?.total ?? 20;
  }

  // severity.<critical|high|medium|low>
  const severityMatch = field.match(/^severity\.(critical|high|medium|low)$/);
  if (severityMatch) {
    const sev = severityMatch[1] as 'critical' | 'high' | 'medium' | 'low';
    return report.summary.bySeverity[sev] ?? 0;
  }

  // level.<error|warning|info>
  const levelMatch = field.match(/^level\.(error|warning|info)$/);
  if (levelMatch) {
    switch (levelMatch[1]) {
      case 'error': return report.summary.errors;
      case 'warning': return report.summary.warnings;
      case 'info': return report.summary.info;
    }
  }

  // license.blocked
  if (field === 'license.blocked') {
    const licenseTool = report.tools['license-check'];
    if (!licenseTool) return 0;
    return licenseTool.issues.filter((i) => i.level === 'error').length;
  }

  // duplicates
  if (field === 'duplicates') {
    const lockfileTool = report.tools['lockfile-analysis'];
    if (!lockfileTool) return 0;
    return lockfileTool.issues.filter((i) => i.category === 'duplicate').length;
  }

  // tool.<name>.<prop>
  const toolMatch = field.match(/^tool\.([a-z0-9_-]+)\.(.+)$/);
  if (toolMatch) {
    const [, toolName, prop] = toolMatch;
    const tool = report.tools[toolName];
    if (!tool) return 0;
    switch (prop) {
      case 'issues': return tool.issues.length;
      case 'errors': return tool.issues.filter((i) => i.level === 'error').length;
      case 'warnings': return tool.issues.filter((i) => i.level === 'warning').length;
      case 'info': return tool.issues.filter((i) => i.level === 'info').length;
      case 'critical': return tool.issues.filter((i) => i.severity === 'critical').length;
      case 'high': return tool.issues.filter((i) => i.severity === 'high').length;
      default: return 0;
    }
  }

  // summary.total
  if (field === 'total') return report.summary.total;

  return 0;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function compare(actual: number, op: string, threshold: number): boolean {
  switch (op) {
    case '<': return actual < threshold;
    case '>': return actual > threshold;
    case '<=': return actual <= threshold;
    case '>=': return actual >= threshold;
    case '==':
    case '=': return actual === threshold;
    case '!=': return actual !== threshold;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate all policy rules against an audit report.
 * Returns violations for rules that fail (error-level first, then warning-level).
 */
export function evaluatePolicy(
  report: AuditReport,
  config?: PolicyConfig,
): PolicyViolation[] {
  if (!config) return [];

  const violations: PolicyViolation[] = [];

  const evaluateRules = (rules: PolicyRule[] | undefined, level: 'error' | 'warning') => {
    if (!rules) return;
    for (const rule of rules) {
      try {
        const expr = parseExpression(rule.rule);
        const actual = resolveField(report, expr.field);
        const failed = compare(actual, expr.op, expr.threshold);

        if (failed) {
          violations.push({
            rule,
            level,
            field: expr.field,
            operator: expr.op,
            threshold: expr.threshold,
            actual,
            description:
              rule.description ??
              `Policy ${level}: ${expr.field} ${expr.op} ${expr.threshold} — actual: ${actual}`,
          });
        }
      } catch {
        // Skip malformed rules silently
      }
    }
  };

  evaluateRules(config.error, 'error');
  evaluateRules(config.warning, 'warning');

  return violations;
}
