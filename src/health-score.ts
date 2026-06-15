import type { AuditReport, HealthScore, GoodjobConfig, IssueCategory, WeightedPenalty } from './types.js';

export interface ScoreCategory {
  label: string;
  score: number;
  max: number;
  detail: string;
}

const PENALTY_MAP = { critical: 3, high: 2, medium: 1, low: 0.5 } as const;

export function computeHealthScore(report: AuditReport, config?: GoodjobConfig): HealthScore {
  const w = config?.healthScore?.weights ?? {};

  const maxSecurity = w.security ?? 5;
  const maxDeps = w.dependencies ?? 5;
  const maxQuality = w.codeQuality ?? 5;
  const maxProject = w.projectHealth ?? 5;
  const totalMax = maxSecurity + maxDeps + maxQuality + maxProject;

  const categories: ScoreCategory[] = [
    computeSecurityScore(report, maxSecurity),
    computeDependencyScore(report, maxDeps),
    computeCodeQualityScore(report, maxQuality),
    computeProjectHealthScore(report, maxProject),
  ];

  const total = Math.min(
    Math.round(categories.reduce((sum, c) => sum + c.score, 0)),
    totalMax,
  );

  // Weighted penalty score (base 20, subtract penalty per issue)
  const penalties: WeightedPenalty[] = [];
  let weightedScore = 20;
  for (const [, result] of Object.entries(report.tools)) {
    for (const issue of result.issues) {
      if (issue.level === 'info') continue;
      const penalty = PENALTY_MAP[issue.severity] ?? 0.5;
      weightedScore -= penalty;
      penalties.push({
        label: `${issue.tool}: ${issue.message.slice(0, 50)}`,
        penalty,
        detail: issue.detail ?? '',
      });
    }
  }
  // Limit penalties list to avoid explosion
  while (penalties.length > 100) {
    penalties.pop();
  }
  weightedScore = Math.max(0, Math.round(weightedScore * 10) / 10);

  return {
    total,
    max: totalMax,
    security: categories[0].score,
    dependencies: categories[1].score,
    codeQuality: categories[2].score,
    projectHealth: categories[3].score,
    breakdown: categories,
    weighted: { score: weightedScore, penalties },
  };
}

/** Check if the weighted score passes the strict threshold */
export function isStrictPass(report: AuditReport, config?: GoodjobConfig): boolean {
  const threshold = config?.healthScore?.thresholds?.strict ?? 15;
  const weighted = report.healthScore?.weighted?.score ?? report.healthScore?.total ?? 20;
  return weighted >= threshold;
}

// ---------------------------------------------------------------------------
// Security (0–5)
// ---------------------------------------------------------------------------
function computeSecurityScore(report: AuditReport, maxScore: number): ScoreCategory {
  const securityIssues = extractIssuesByCategory(report, 'security');
  let score = maxScore;

  for (const iss of securityIssues) {
    switch (iss.severity) {
      case 'critical': score -= maxScore * 0.3; break;
      case 'high':     score -= maxScore * 0.16; break;
      case 'medium':   score -= maxScore * 0.08; break;
      case 'low':      score -= maxScore * 0.02; break;
    }
  }

  score = Math.max(0, Math.round(score * 10) / 10);

  const criticalCount = securityIssues.filter(i => i.severity === 'critical').length;
  const highCount = securityIssues.filter(i => i.severity === 'high').length;
  const detail = securityIssues.length === 0
    ? 'No security issues found'
    : `${criticalCount} critical, ${highCount} high, ${securityIssues.length} total — score: ${score}/${maxScore}`;

  return { label: 'Security', score, max: maxScore, detail };
}

// ---------------------------------------------------------------------------
// Dependencies (0–5)
// ---------------------------------------------------------------------------
function computeDependencyScore(report: AuditReport, maxScore: number): ScoreCategory {
  let score = maxScore;
  const deductions: string[] = [];

  const outdatedTool = report.tools['npm-outdated'];
  if (outdatedTool) {
    const outdatedCount = outdatedTool.issues.length;
    if (outdatedCount > 0) {
      const criticalOutdated = outdatedTool.issues.filter(i => i.severity === 'high' || i.severity === 'critical').length;
      if (criticalOutdated > 0) {
        const deduct = Math.min(1.5, criticalOutdated * 0.5);
        score -= deduct;
        deductions.push(`-${deduct} outdated`);
      }
      if (outdatedCount > 5) { score -= 0.5; deductions.push('-0.5 many outdated'); }
      else if (outdatedCount > 0) { score -= 0.2; deductions.push('-0.2 outdated'); }
    }
  }

  const licenseTool = report.tools['license-check'];
  if (licenseTool) {
    const licenseIssues = licenseTool.issues.filter(i => i.level !== 'info');
    if (licenseIssues.length > 0) {
      const highLicense = licenseIssues.filter(i => i.severity === 'high').length;
      if (highLicense > 0) { score -= Math.min(1.5, highLicense * 0.5); deductions.push(`-${Math.min(1.5, highLicense * 0.5)} license`); }
      const mediumLicense = licenseIssues.filter(i => i.severity === 'medium').length;
      if (mediumLicense > 0) { score -= Math.min(0.5, mediumLicense * 0.2); deductions.push(`-${Math.min(0.5, mediumLicense * 0.2)} license`); }
    }
  }

  const lockfileTool = report.tools['lockfile-analysis'];
  if (lockfileTool) {
    const duplicateIssues = lockfileTool.issues.filter(i => i.category === 'duplicate' && i.level !== 'info');
    if (duplicateIssues.length > 0) {
      const highDups = duplicateIssues.filter(i => i.severity === 'high').length;
      const medDups = duplicateIssues.filter(i => i.severity === 'medium').length;
      if (highDups > 0) { score -= Math.min(1, highDups); deductions.push('-1 duplicates'); }
      else if (medDups > 0) { score -= Math.min(0.5, medDups * 0.2); deductions.push('-0.5 duplicates'); }
    }
  }

  score = Math.max(0, Math.round(score * 10) / 10);

  const detail = deductions.length === 0
    ? `All dependency checks pass — score: ${score}/${maxScore}`
    : deductions.join(', ') + ` — score: ${score}/${maxScore}`;

  return { label: 'Dependencies', score, max: maxScore, detail };
}

// ---------------------------------------------------------------------------
// Code Quality (0–5)
// ---------------------------------------------------------------------------
function computeCodeQualityScore(report: AuditReport, maxScore: number): ScoreCategory {
  let score = maxScore;
  const deductions: string[] = [];

  const eslintTool = report.tools['eslint'];
  if (eslintTool) {
    const errCount = eslintTool.issues.filter(i => i.level === 'error').length;
    const warnCount = eslintTool.issues.filter(i => i.level === 'warning').length;
    if (errCount > 0) { const deduct = Math.min(2, errCount * 0.4); score -= deduct; deductions.push(`-${deduct} eslint errors`); }
    if (warnCount > 5) { score -= 0.5; deductions.push('-0.5 eslint warnings'); }
    else if (warnCount > 0) { score -= 0.2; deductions.push('-0.2 eslint warnings'); }
  }

  const tsPruneTool = report.tools['ts-prune'];
  if (tsPruneTool) {
    const deadCode = tsPruneTool.issues.length;
    if (deadCode > 0) { const deduct = Math.min(1.5, deadCode * 0.2); score -= deduct; deductions.push(`-${deduct} dead code`); }
  }

  const depcheckTool = report.tools['depcheck'];
  if (depcheckTool) {
    const unused = depcheckTool.issues.filter(i => i.category === 'unused-dependency').length;
    const missing = depcheckTool.issues.filter(i => i.category === 'missing-dependency').length;
    if (unused > 0) { const deduct = Math.min(1, unused * 0.2); score -= deduct; deductions.push(`-${deduct} unused deps`); }
    if (missing > 0) { const deduct = Math.min(1, missing * 0.3); score -= deduct; deductions.push(`-${deduct} missing deps`); }
  }

  const architectTool = report.tools['architect'];
  if (architectTool) {
    const qualIssues = architectTool.issues.filter(i => (i.category === 'quality' || i.category === 'architecture') && i.level !== 'info');
    if (qualIssues.length > 0) { const deduct = Math.min(1.0, qualIssues.length * 0.15); score -= deduct; deductions.push(`-${deduct} architect issues`); }
  }

  const knipTool = report.tools['knip'];
  if (knipTool) {
    const deadCode = knipTool.issues.filter(i => i.category === 'dead-code').length;
    if (deadCode > 0) { const deduct = Math.min(1.0, deadCode * 0.1); score -= deduct; deductions.push(`-${deduct} knip dead code`); }
    const unresolved = knipTool.issues.filter(i => i.category === 'missing-dependency').length;
    if (unresolved > 0) { const deduct = Math.min(0.5, unresolved * 0.15); score -= deduct; deductions.push(`-${deduct} knip unresolved`); }
  }

  score = Math.max(0, Math.round(score * 10) / 10);

  const detail = deductions.length === 0
    ? `No code quality issues found — score: ${score}/${maxScore}`
    : deductions.join(', ') + ` — score: ${score}/${maxScore}`;

  return { label: 'Code Quality', score, max: maxScore, detail };
}

// ---------------------------------------------------------------------------
// Project Health (0–5)
// ---------------------------------------------------------------------------
function computeProjectHealthScore(report: AuditReport, maxScore: number): ScoreCategory {
  let score = maxScore;
  const deductions: string[] = [];

  const lockfileTool = report.tools['lockfile-analysis'];
  if (lockfileTool) {
    const infoIssue = lockfileTool.issues.find(i => i.level === 'info');
    if (infoIssue) {
      const totalMatch = infoIssue.message.match(/Lockfile:\s*(\d+)\s*total/);
      const totalDeps = totalMatch ? parseInt(totalMatch[1], 10) : 0;
      const nestedMatch = infoIssue.message.match(/nested\s*(\d+)/);
      const nestedDeps = nestedMatch ? parseInt(nestedMatch[1], 10) : 0;

      if (totalDeps > 500) { score -= 1.5; deductions.push('-1.5 huge dep graph'); }
      else if (totalDeps > 200) { score -= 0.8; deductions.push('-0.8 large dep graph'); }
      else if (totalDeps > 100) { score -= 0.3; deductions.push('-0.3 moderate dep graph'); }

      if (nestedDeps > totalDeps * 0.8 && totalDeps > 50) { score -= 0.3; deductions.push('-0.3 high transitive ratio'); }
    }
  }

  const outdatedTool = report.tools['npm-outdated'];
  if (outdatedTool) {
    const outdatedCount = outdatedTool.issues.length;
    if (outdatedCount > 10) { score -= 0.5; deductions.push('-0.5 many outdated'); }
    else if (outdatedCount > 0) { score -= 0.2; deductions.push('-0.2 outdated'); }
  }

  const depcheckTool = report.tools['depcheck'];
  if (depcheckTool) {
    const missing = depcheckTool.issues.filter(i => i.category === 'missing-dependency').length;
    if (missing > 0) { const deduct = Math.min(0.8, missing * 0.2); score -= deduct; deductions.push(`-${deduct} missing deps`); }
  }

  const pkgLintTool = report.tools['pkg-lint'];
  if (pkgLintTool) {
    const warnCount = pkgLintTool.issues.filter(i => i.level === 'warning').length;
    if (warnCount > 5) { score -= 0.5; deductions.push('-0.5 pkg-lint warnings'); }
    else if (warnCount > 0) { score -= 0.2; deductions.push('-0.2 pkg-lint warnings'); }
    const infoCount = pkgLintTool.issues.filter(i => i.level === 'info').length;
    if (infoCount > 8) { score -= 0.2; deductions.push('-0.2 many pkg-lint suggestions'); }
  }

  const npmAuditTool = report.tools['npm-audit'];
  if (npmAuditTool) {
    const critical = npmAuditTool.issues.filter(i => i.severity === 'critical').length;
    if (critical === 0) { score = Math.min(5, score + 0.3); deductions.push('+0.3 no critical vulns'); }
  }

  score = Math.max(0, Math.min(maxScore, Math.round(score * 10) / 10));

  const detail = deductions.length === 0
    ? `Project appears healthy — score: ${score}/${maxScore}`
    : deductions.join(', ') + ` — score: ${score}/${maxScore}`;

  return { label: 'Project Health', score, max: maxScore, detail };
}

function extractIssuesByCategory(report: AuditReport, category: IssueCategory) {
  const issues: typeof report.tools[string]['issues'] = [];
  for (const tool of Object.values(report.tools)) {
    for (const issue of tool.issues) {
      if (issue.category === category && (issue.level === 'error' || issue.level === 'warning')) {
        issues.push(issue);
      }
    }
  }
  return issues;
}
