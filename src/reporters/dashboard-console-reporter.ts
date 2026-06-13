import type { DashboardReport, DashboardProjectEntry } from '../types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const FG_RED = '\x1b[31m';
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_BLUE = '\x1b[34m';

export function writeDashboardConsole(report: DashboardReport): void {
  console.log('');
  console.log(`${BOLD}╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║      npm-goodjob — Multi-Project Dashboard      ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  const duration = formatDuration(report.totalDurationMs);
  console.log(`  ${DIM}Projects:${RESET} ${report.projects.length} (${FG_GREEN}${report.summary.passed} passed${RESET}${report.summary.failed > 0 ? `, ${FG_RED}${report.summary.failed} failed${RESET}` : ''})`);
  console.log(`  ${DIM}Date:${RESET}     ${report.timestamp}`);
  console.log(`  ${DIM}Duration:${RESET}  ${duration}`);
  console.log('');

  if (report.projects.length === 0) {
    console.log(`  ${FG_YELLOW}No projects configured. Add a "projects" section to .goodjobrc.${RESET}`);
    console.log('');
    return;
  }

  // Sort: failed projects first, then by health score ascending (worst first)
  const sorted = [...report.projects].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'error' ? -1 : 1;
    const ha = a.report?.healthScore;
    const hb = b.report?.healthScore;
    if (ha && hb) return ha.total - hb.total;
    if (ha) return -1;
    if (hb) return 1;
    return 0;
  });

  // Determine column widths
  const nameWidth = Math.max(15, ...sorted.map((e) => e.name.length));
  const sep = `${DIM}│${RESET}`;

  // Header
  const header = `  ${DIM}┌${'─'.repeat(nameWidth + 2)}┬───────┬────────┬──────────┐${RESET}`;
  const hdrRow = `  ${sep} ${BOLD}Project${' '.repeat(nameWidth - 6)}${sep} ${BOLD}Health${sep} ${BOLD}Issues${sep} ${BOLD}Status   ${sep}`;
  const divider = `  ${DIM}├${'─'.repeat(nameWidth + 2)}┼───────┼────────┼──────────┤${RESET}`;
  const footer = `  ${DIM}└${'─'.repeat(nameWidth + 2)}┴───────┴────────┴──────────┘${RESET}`;

  console.log(header);
  console.log(hdrRow);
  console.log(divider);

  for (const entry of sorted) {
    const name = entry.name.padEnd(nameWidth);
    const healthStr = formatHealthShort(entry);
    const issuesStr = entry.report ? String(entry.report.summary.total).padStart(4) : '  —';
    const statusStr = formatStatus(entry);
    console.log(`  ${sep} ${BOLD}${name}${RESET} ${sep} ${healthStr} ${sep} ${issuesStr}  ${sep} ${statusStr} ${sep}`);
  }

  console.log(footer);
  console.log('');

  // Summary row
  const parts: string[] = [];
  if (report.summary.errors > 0) parts.push(`${FG_RED}${report.summary.errors} error(s)${RESET}`);
  if (report.summary.warnings > 0) parts.push(`${FG_YELLOW}${report.summary.warnings} warning(s)${RESET}`);
  if (report.summary.info > 0) parts.push(`${FG_BLUE}${report.summary.info} info${RESET}`);
  console.log(`  ${BOLD}Aggregated:${RESET} ${report.summary.total} issues · ${parts.join(' · ')}`);
  console.log('');
}

function formatHealthShort(entry: DashboardProjectEntry): string {
  if (!entry.report?.healthScore) {
    return `${DIM}  —/—${RESET}`;
  }
  const hs = entry.report.healthScore;
  const pct = hs.max > 0 ? hs.total / hs.max : 0;
  const color = pct >= 0.8 ? FG_GREEN : pct >= 0.6 ? FG_YELLOW : FG_RED;
  return `${color}${String(hs.total).padStart(2)}/${hs.max}${RESET}`;
}

function formatStatus(entry: DashboardProjectEntry): string {
  if (entry.status === 'error') {
    return `${FG_RED}${BOLD}✗ ERROR ${RESET}`;
  }
  const errors = entry.report?.summary.errors ?? 0;
  if (errors > 0) {
    return `${FG_YELLOW}${BOLD}⚠ ${errors} err ${RESET}`;
  }
  return `${FG_GREEN}${BOLD}✓ OK    ${RESET}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}
