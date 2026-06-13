// ---------------------------------------------------------------------------
// npm-goodjob — Console reporter
// Human-readable terminal output with coloured severity indicators.
// Zero dependencies — pure ANSI escape codes.
// ---------------------------------------------------------------------------

import type { AuditReport, Issue, Reporter, IssueCategory, Severity, HealthScore, ToolResult } from '../types.js';

// -------- ANSI helpers ---------------------------------------------------
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const FG_RED = '\x1b[31m';
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_BLUE = '\x1b[34m';
const FG_GRAY = '\x1b[90m';

const BG_RED = '\x1b[41m';
const BG_YELLOW = '\x1b[43m';
const BG_BLUE = '\x1b[44m';

function sevColor(sev: Severity): string {
  switch (sev) {
    case 'critical': return FG_RED + BOLD;
    case 'high': return FG_RED;
    case 'medium': return FG_YELLOW;
    case 'low': return FG_BLUE;
  }
}

function levelBadge(level: Issue['level']): string {
  switch (level) {
    case 'error':
      return `${BG_RED}${BOLD} ERROR ${RESET}`;
    case 'warning':
      return `${BG_YELLOW}${BOLD} WARN  ${RESET}`;
    case 'info':
      return `${BG_BLUE}${BOLD} INFO  ${RESET}`;
  }
}

function sevBadge(sev: Severity): string {
  switch (sev) {
    case 'critical':
      return `${BG_RED}${BOLD}CRIT${RESET}`;
    case 'high':
      return `${FG_RED}${BOLD}HIGH${RESET}`;
    case 'medium':
      return `${FG_YELLOW}MED ${RESET}`;
    case 'low':
      return `${FG_BLUE}LOW ${RESET}`;
  }
}

const CATEGORY_ICON: Record<IssueCategory, string> = {
  'security': '🔒',
  'unused-dependency': '🗑',
  'missing-dependency': '📦',
  'outdated-dependency': '🔄',
  'dead-code': '💀',
  'quality': '📐',
  'bundle-size': '📏',
  'architecture': '🏗',
  'configuration': '⚙',
  'license': '📜',
  'duplicate': '🧬',
  'health': '❤️',
  'other': '•',
};

// -------- Reporter --------------------------------------------------------

export const consoleReporter: Reporter = {
  write(report: AuditReport): void {
    printHeader(report);
    printSummary(report);

    for (const [, result] of Object.entries(report.tools)) {
      printToolResult(result);
    }

    printFooter(report);
  },
};

function printHeader(report: AuditReport): void {
  const { metadata } = report;
  console.log('');
  console.log(`${BOLD}╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║         npm-goodjob — Audit Report              ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`  ${DIM}Project:${RESET} ${BOLD}${metadata.projectName || '(unnamed)'}${RESET}`);
  console.log(`  ${DIM}Path:${RESET}    ${metadata.projectPath}`);
  console.log(`  ${DIM}Date:${RESET}    ${metadata.timestamp}`);
  console.log(`  ${DIM}Duration:${RESET} ${formatDuration(metadata.durationMs)}`);
  console.log(`  ${DIM}Node:${RESET}    ${metadata.nodeVersion}`);
  console.log(`  ${DIM}npm:${RESET}     ${metadata.npmVersion}`);
  console.log(`  ${DIM}Version:${RESET} ${metadata.goodjobVersion}`);
  console.log('');
}

function printSummary(report: AuditReport): void {
  const { summary } = report;

  const totalStr = `${BOLD}${summary.total}${RESET}`;
  const errStr = summary.errors > 0
    ? `${FG_RED}${BOLD}${summary.errors} errors${RESET}`
    : `${FG_GREEN}0 errors${RESET}`;
  const warnStr = summary.warnings > 0
    ? `${FG_YELLOW}${summary.warnings} warnings${RESET}`
    : `${FG_GREEN}0 warnings${RESET}`;
  const infoStr = `${FG_BLUE}${summary.info} info${RESET}`;

  console.log(`  ${BOLD}Results:${RESET} ${totalStr} issues · ${errStr} · ${warnStr} · ${infoStr}`);

  // Severity breakdown
  const sevParts: string[] = [];
  const sevOrder: Severity[] = ['critical', 'high', 'medium', 'low'];
  for (const s of sevOrder) {
    const count = summary.bySeverity[s] ?? 0;
    if (count > 0) {
      sevParts.push(`${sevColor(s)}${count} ${s}${RESET}`);
    }
  }
  if (sevParts.length > 0) {
    console.log(`  ${DIM}By severity:${RESET} ${sevParts.join(' · ')}`);
  }

  // Category breakdown (show active categories only)
  const catParts: string[] = [];
  for (const [cat, count] of Object.entries(summary.byCategory)) {
    if (count > 0) {
      catParts.push(`${CATEGORY_ICON[cat as IssueCategory] ?? '•'} ${cat} (${count})`);
    }
  }
  if (catParts.length > 0) {
    console.log(`  ${DIM}By category:${RESET} ${catParts.join(' · ')}`);
  }
  console.log('');
}

function printToolResult(result: ToolResult): void {
  const statusTag = result.status === 'success'
    ? `${FG_GREEN}✓${RESET}`
    : result.status === 'skipped'
      ? `${DIM}–${RESET}`
      : `${FG_RED}✗${RESET}`;

  const issueCount =
    result.issues.length > 0
      ? ` ${FG_YELLOW}(${result.issues.length})${RESET}`
      : '';

  // Version badge: only show "vX.Y.Z" for real versions
  let versionBadge = '';
  if (result.version && result.version !== 'N/A' && result.version !== '') {
    if (result.version === 'via npx') {
      versionBadge = ` ${DIM}(via npx)${RESET}`;
    } else if (/^\d/.test(result.version)) {
      versionBadge = ` ${DIM}v${result.version}${RESET}`;
    } else {
      versionBadge = ` ${DIM}${result.version}${RESET}`;
    }
  }

  // Separator before tools with issues or errors
  if (result.issues.length > 0 || result.status === 'error') {
    console.log(`  ${DIM}${'─'.repeat(50)}${RESET}`);
  }

  console.log(`  ${statusTag} ${BOLD}${result.label}${RESET}${versionBadge}${issueCount}`);

  if (result.status === 'skipped' && result.skipReason) {
    console.log(`    ${DIM}⤷ ${result.skipReason}${RESET}`);
  }
  if (result.status === 'error' && result.errorMessage) {
    console.log(`    ${FG_RED}⤷ ${result.errorMessage}${RESET}`);
  }

  if (result.issues.length > 0) {
    const grouped = new Map<string, Issue[]>();
    for (const issue of result.issues) {
      const key = issue.file ?? '(general)';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(issue);
    }

    for (const [file, issues] of grouped) {
      if (file !== '(general)') {
        console.log(`    ${FG_GRAY}${file}:${RESET}`);
      }
      for (const issue of issues) {
        const loc = issue.line
          ? `${FG_GRAY}:${issue.line}${issue.column ? `:${issue.column}` : ''}${RESET}`
          : '';
        console.log(
          `      ${levelBadge(issue.level)} ${sevBadge(issue.severity)} ${issue.message}${loc}`,
        );
        if (issue.detail) {
          console.log(`        ${DIM}${issue.detail.slice(0, 200)}${RESET}`);
        }
      }
    }
  }
  console.log('');
}

function printFooter(report: AuditReport): void {
  const { summary, healthScore } = report;
  console.log(`  ${BOLD}${'═'.repeat(46)}${RESET}`);

  if (healthScore) {
    printHealthScore(healthScore);
    console.log('');
  }

  if (summary.errors === 0 && summary.warnings === 0) {
    console.log(`  ${FG_GREEN}${BOLD}  ✓  No issues found — good job!${RESET}`);
  } else {
    const parts: string[] = [];
    if (summary.errors > 0) parts.push(`${FG_RED}${summary.errors} error(s)${RESET}`);
    if (summary.warnings > 0) parts.push(`${FG_YELLOW}${summary.warnings} warning(s)${RESET}`);
    if (summary.info > 0) parts.push(`${FG_BLUE}${summary.info} info${RESET}`);
    console.log(`  ${BOLD}  Found ${summary.total} issue(s):${RESET} ${parts.join(', ')}`);
  }
  console.log('');
}

function printHealthScore(hs: HealthScore): void {
  const max = hs.max || 20;
  const pct = max > 0 ? hs.total / max : 0;
  const color = pct >= 0.8 ? FG_GREEN : pct >= 0.6 ? FG_YELLOW : FG_RED;
  const barLen = 20;
  const filled = Math.round(pct * barLen);
  const empty = barLen - filled;
  const bar = `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;

  console.log(`  ${BOLD}Health Score:${RESET} ${color}${BOLD}${hs.total}/${max}${RESET}`);
  console.log(`  ${bar}`);

  for (const cat of hs.breakdown) {
    const catPct = cat.max > 0 ? cat.score / cat.max : 0;
    const catColor = catPct >= 0.8 ? FG_GREEN : catPct >= 0.6 ? FG_YELLOW : FG_RED;
    console.log(`    ${BOLD}${cat.label}:${RESET} ${catColor}${cat.score}/${cat.max}${RESET}  ${DIM}${cat.detail}${RESET}`);
  }
}

// -------- Helpers -----------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}
