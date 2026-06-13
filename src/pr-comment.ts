// ---------------------------------------------------------------------------
// npm-goodjob — PR/MR Comment Generator
// Posts audit results as PR comments on GitHub or GitLab.
// Auto-detects CI platform from environment variables.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import type { AuditReport } from './types.js';

// ---------------------------------------------------------------------------
// CI platform detection
// ---------------------------------------------------------------------------

type CiPlatform = 'github' | 'gitlab' | 'unknown';

function detectPlatform(): CiPlatform {
  if (process.env.GITHUB_ACTIONS) return 'github';
  if (process.env.GITLAB_CI) return 'gitlab';
  return 'unknown';
}

function getPrContext(): Record<string, string> {
  const platform = detectPlatform();

  if (platform === 'github') {
    return {
      repo: process.env.GITHUB_REPOSITORY ?? '',
      prNumber: process.env.GITHUB_PR_NUMBER ?? process.env.GITHUB_EVENT_NAME === 'pull_request'
        ? (getGitHubPrNumber() ?? '')
        : '',
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '',
      runId: process.env.GITHUB_RUN_ID ?? '',
      sha: process.env.GITHUB_SHA ?? '',
    };
  }

  if (platform === 'gitlab') {
    return {
      projectId: process.env.CI_PROJECT_ID ?? '',
      mrIid: process.env.CI_MERGE_REQUEST_IID ?? '',
      token: process.env.CI_API_TOKEN ?? '',
      jobId: process.env.CI_JOB_ID ?? '',
      sha: process.env.CI_COMMIT_SHA ?? '',
    };
  }

  return {};
}

function getGitHubPrNumber(): string | null {
  try {
    // GitHub Actions: GITHUB_REF for PRs is refs/pull/<number>/merge
    const ref = process.env.GITHUB_REF ?? '';
    const match = ref.match(/refs\/pull\/(\d+)/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

function healthBadge(score: number, max: number): string {
  const ratio = score / max;
  const color = ratio >= 0.8 ? 'brightgreen' : ratio >= 0.6 ? 'yellow' : ratio >= 0.4 ? 'orange' : 'red';
  return `![Health](https://img.shields.io/badge/health-${score}%2F${max}-${color})`;
}

function severityBadge(issues: number, severity: string, color: string): string {
  if (issues === 0) return '';
  return `![${severity}](https://img.shields.io/badge/${severity}-${issues}-${color})`;
}

export function formatPrComment(report: AuditReport): string {
  const h = report.healthScore;
  const lines: string[] = [];

  lines.push(`## npm-goodjob Audit Report`);
  lines.push('');

  // Health + run info
  if (h) {
    lines.push(`${healthBadge(h.total, h.max)}`);
    lines.push('');
    lines.push(`**Health Score:** ${h.total}/${h.max}`);
    lines.push('');
  }

  // Severity badges
  const badges: string[] = [];
  if (report.summary.bySeverity.critical > 0) badges.push(severityBadge(report.summary.bySeverity.critical, 'critical', 'red'));
  if (report.summary.bySeverity.high > 0) badges.push(severityBadge(report.summary.bySeverity.high, 'high', 'orange'));
  if (report.summary.bySeverity.medium > 0) badges.push(severityBadge(report.summary.bySeverity.medium, 'medium', 'yellow'));
  if (badges.length > 0) {
    lines.push(badges.join(' '));
    lines.push('');
  }

  // Summary table
  lines.push('| Metric | Count |');
  lines.push('|--------|------:|');
  lines.push(`| **Total Issues** | ${report.summary.total} |`);
  lines.push(`| **Errors** | ${report.summary.errors} |`);
  lines.push(`| **Warnings** | ${report.summary.warnings} |`);
  lines.push(`| **Info** | ${report.summary.info} |`);
  if (h) {
    lines.push(`| **Health Score** | ${h.total}/${h.max} |`);
  }
  lines.push('');

  // Severity breakdown
  const sevEntries = Object.entries(report.summary.bySeverity).filter(([, count]) => count > 0);
  if (sevEntries.length > 0) {
    lines.push('### Severity Breakdown');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|------:|');
    for (const [sev, count] of sevEntries) {
      lines.push(`| ${sev} | ${count} |`);
    }
    lines.push('');
  }

  // Per-tool breakdown
  const activeTools = Object.entries(report.tools).filter(
    ([, t]) => t.status !== 'skipped' && t.issues.length > 0,
  );
  if (activeTools.length > 0) {
    lines.push('### Tool Results');
    lines.push('');
    lines.push('| Tool | Issues | Errors |');
    lines.push('|------|-------:|------:|');
    for (const [name, tool] of activeTools) {
      const errs = tool.issues.filter((i) => i.level === 'error').length;
      lines.push(`| ${name} | ${tool.issues.length} | ${errs} |`);
    }
    lines.push('');
  }

  // Top issues
  const topIssues = report.summary.total > 0;
  if (topIssues) {
    const criticalHigh = Object.values(report.tools)
      .flatMap((t) => t.issues)
      .filter((i) => i.severity === 'critical' || i.severity === 'high')
      .slice(0, 5);

    if (criticalHigh.length > 0) {
      lines.push('### Top Critical/High Issues');
      lines.push('');
      for (const issue of criticalHigh) {
        const emoji = issue.severity === 'critical' ? '🔴' : '🟠';
        const location = issue.file ? ` (\`${issue.file}${issue.line ? `:${issue.line}` : ''}\`)` : '';
        lines.push(`- ${emoji} **${issue.severity}** ${issue.message}${location}`);
      }
      lines.push('');
    }
  }

  // Metadata
  const platform = detectPlatform();
  if (platform === 'github' && process.env.GITHUB_RUN_ID) {
    const repo = process.env.GITHUB_REPOSITORY;
    const runId = process.env.GITHUB_RUN_ID;
    if (repo && runId) {
      lines.push(`_Report generated by npm-goodjob ${report.metadata.goodjobVersion} in ${report.metadata.durationMs}ms_`);
      lines.push('');
    }
  } else {
    lines.push(`_Report generated in ${report.metadata.durationMs}ms by npm-goodjob ${report.metadata.goodjobVersion}_`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// PR comment posting
// ---------------------------------------------------------------------------

export function postPrComment(report: AuditReport): boolean {
  const platform = detectPlatform();
  const comment = formatPrComment(report);

  try {
    if (platform === 'github') {
      return postGitHubComment(comment);
    }
    if (platform === 'gitlab') {
      return postGitLabComment(comment);
    }
    // Fallback: just print to stdout
    process.stdout.write('\n--- PR Comment ---\n');
    process.stdout.write(comment);
    process.stdout.write('\n---\n');
    return false;
  } catch (err) {
    process.stderr.write(`Failed to post PR comment: ${err}\n`);
    return false;
  }
}

function postGitHubComment(comment: string): boolean {
  const ctx = getPrContext();
  if (!ctx.token) {
    process.stderr.write('GITHUB_TOKEN not set, cannot post PR comment\n');
    return false;
  }
  if (!ctx.prNumber) {
    process.stderr.write('Not in a pull request context, cannot post comment\n');
    return false;
  }

  try {
    // Check if gh CLI is available
    execSync('gh --version', { stdio: 'ignore' });
  } catch {
    process.stderr.write('gh CLI not available, cannot post PR comment\n');
    return false;
  }

  try {
    execSync(
      `gh pr comment ${ctx.prNumber} --repo ${ctx.repo} --body '${escapeShell(comment)}'`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 30000 },
    );
    process.stderr.write('PR comment posted successfully\n');
    return true;
  } catch {
    process.stderr.write('Failed to post PR comment via gh CLI\n');
    return false;
  }
}

function postGitLabComment(comment: string): boolean {
  const ctx = getPrContext();
  if (!ctx.token || !ctx.projectId || !ctx.mrIid) {
    process.stderr.write('Missing GitLab CI env vars (CI_API_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID)\n');
    return false;
  }

  try {
    const tmpFile = `/tmp/goodjob-mr-comment-${Date.now()}.md`;
    writeFileSync(tmpFile, comment, 'utf-8');

    execSync(
      `curl -s -X POST \
        --header "PRIVATE-TOKEN: ${ctx.token}" \
        --header "Content-Type: application/json" \
        --data "$(printf '{"body": %s}' "$(cat ${tmpFile} | jq -Rs .)")" \
        "https://gitlab.com/api/v4/projects/${ctx.projectId}/merge_requests/${ctx.mrIid}/notes"`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 30000 },
    );

    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    process.stderr.write('MR comment posted successfully\n');
    return true;
  } catch {
    process.stderr.write('Failed to post MR comment via GitLab API\n');
    return false;
  }
}

function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''");
}
