// ---------------------------------------------------------------------------
// npm-goodjob — Terminal UI (interactive, zero external deps)
// Navigable issue browser using raw terminal mode + ANSI escape codes.
// ---------------------------------------------------------------------------

import type { AuditReport, Issue } from './types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const REVERSE = '\x1b[7m';
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_RED = '\x1b[31m';
const FG_CYAN = '\x1b[36m';
const FG_WHITE = '\x1b[37m';
const BG_BLUE = '\x1b[44m';
const CLEAR = '\x1b[2J';
const HOME = '\x1b[H';
const CLEAR_LINE = '\x1b[K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

interface ListItem {
  type: 'tool' | 'issue';
  toolName: string;
  label: string;
  severity?: string;
  issue?: Issue;
}

export function runTui(report: AuditReport): void {
  const h = report.healthScore;

  // Build flat list of items
  const items: ListItem[] = [];
  for (const [name, tool] of Object.entries(report.tools)) {
    if (tool.status === 'skipped') continue;
    items.push({ type: 'tool', toolName: name, label: `${tool.label} (${tool.issues.length} issues)` });
    for (const issue of tool.issues) {
      if (issue.level === 'info') continue;
      const location = issue.file ? ` ${DIM}${issue.file}${issue.line ? `:${issue.line}` : ''}${RESET}` : '';
      items.push({
        type: 'issue',
        toolName: name,
        label: `${issue.message}${location}`,
        severity: issue.severity,
        issue,
      });
    }
  }

  if (items.length === 0) {
    process.stdout.write(`${CLEAR}${HOME}`);
    process.stdout.write(`${BOLD}${FG_GREEN}✓ All clear — no issues found${RESET}\n`);
    process.stdout.write('\nPress any key to exit...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    });
    return;
  }

  let selectedIndex = 0;
  const screenHeight = process.stdout.rows || 24;

  // Set up raw input
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const render = () => {
    const output: string[] = [];
    output.push(HIDE_CURSOR);
    output.push(HOME);

    // Title bar
    output.push(`${BG_BLUE}${FG_WHITE}${BOLD} npm-goodjob ${RESET}${DIM} ${report.metadata.projectName} ${RESET}${BG_BLUE}${FG_WHITE} [↑↓] scroll [Enter] details [q] quit ${RESET}\n`);

    // Health score line
    if (h) {
      const ratio = h.total / h.max;
      const barLen = 20;
      const filled = Math.round(ratio * barLen);
      const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
      const color = ratio >= 0.8 ? FG_GREEN : ratio >= 0.6 ? FG_YELLOW : FG_RED;
      output.push(` ${BOLD}Health:${RESET} ${color}${h.total}${RESET}/${h.max}  ${color}${bar}${RESET}  ${Math.round(ratio * 100)}%\n`);
    }

    // Summary line
    const errorStr = report.summary.errors > 0 ? `${FG_RED}${report.summary.errors} errors${RESET}` : `${FG_GREEN}0 errors${RESET}`;
    const warnStr = report.summary.warnings > 0 ? `${FG_YELLOW}${report.summary.warnings} warnings${RESET}` : `${DIM}0 warnings${RESET}`;
    output.push(` ${BOLD}Issues:${RESET} ${report.summary.total} (${errorStr}, ${warnStr}, ${DIM}${report.summary.info} info${RESET})\n\n`);

    // Separator
    output.push(` ${DIM}── ${BOLD}Issues${RESET}${DIM} ────────────────────────────────────────${RESET}\n`);

    // Scrollable item list
    const termWidth = process.stdout.columns || 80;
    const visibleStart = Math.max(0, selectedIndex - Math.floor((screenHeight - 10) / 2));
    const visibleEnd = visibleStart + (screenHeight - 10);
    const visibleItems = items.slice(visibleStart, visibleEnd);

    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i];
      const globalIndex = visibleStart + i;
      const isSelected = globalIndex === selectedIndex;

      const prefix = isSelected ? ` ${REVERSE} ${RESET} ` : '   ';
      output.push(prefix + CLEAR_LINE);

      let line = '';
      if (item.type === 'tool') {
        line += `${FG_CYAN}${BOLD}${item.label}${RESET}`;
      } else {
        let color = DIM;
        if (item.severity === 'critical' || item.severity === 'error') color = FG_RED;
        else if (item.severity === 'high') color = FG_RED;
        else if (item.severity === 'medium') color = FG_YELLOW;
        else if (item.severity === 'low') color = DIM;

        const bullet = item.severity === 'critical' || item.severity === 'high' ? '◉' : '○';
        line += ` ${color}${bullet} ${item.label}${RESET}`;
      }

      if (isSelected && line.length < termWidth) {
        line += ' '.repeat(Math.max(0, termWidth - visibleLength(line)));
      }

      output.push(line);
      output.push('\n');
    }

    // Detail panel for selected issue
    const selectedItem = items[selectedIndex];
    if (selectedItem?.type === 'issue' && selectedItem.issue) {
      const iss = selectedItem.issue;
      output.push(` ${DIM}${'─'.repeat(50)}${RESET}\n`);
      output.push(` ${BOLD}Detail:${RESET}\n`);
      output.push(`  ${BOLD}Severity:${RESET} ${severityColor(iss.severity)}${iss.severity}${RESET}\n`);
      output.push(`  ${BOLD}Category:${RESET} ${iss.category}\n`);
      output.push(`  ${BOLD}Tool:${RESET} ${iss.tool}\n`);
      if (iss.package) output.push(`  ${BOLD}Package:${RESET} ${iss.package}${iss.version ? `@${iss.version}` : ''}\n`);
      if (iss.fixVersion) output.push(`  ${BOLD}Fix:${RESET} ${FG_GREEN}${iss.fixVersion}${RESET}\n`);
      if (iss.file) output.push(`  ${BOLD}File:${RESET} ${iss.file}${iss.line ? `:${iss.line}` : ''}\n`);
      if (iss.cve) output.push(`  ${BOLD}CVE:${RESET} ${iss.cve}\n`);
      if (iss.detail) output.push(`  ${BOLD}Detail:${RESET} ${iss.detail}\n`);
    } else if (selectedItem?.type === 'tool') {
      const toolResult = report.tools[selectedItem.toolName];
      if (toolResult) {
        output.push(` ${DIM}${'─'.repeat(50)}${RESET}\n`);
        output.push(` ${BOLD}${toolResult.label}${RESET} — ${toolResult.status} ${DIM}${toolResult.durationMs}ms${RESET}\n`);
        output.push(`  ${BOLD}Version:${RESET} ${toolResult.version}\n`);
        output.push(`  ${BOLD}Issues:${RESET} ${toolResult.issues.length}\n`);
        if (toolResult.skipReason) output.push(`  ${BOLD}Skipped:${RESET} ${toolResult.skipReason}\n`);
        if (toolResult.errorMessage) output.push(`  ${BOLD}Error:${RESET} ${FG_RED}${toolResult.errorMessage}${RESET}\n`);
      }
    }

    // Footer
    output.push(`\n ${DIM}[${selectedIndex + 1}/${items.length}]${RESET}`);

    process.stdout.write(output.join(''));
  };

  render();

  const onData = (buf: Buffer) => {
    const key = buf.toString();

    if (key === 'q' || key === '\x1b') { // q or ESC
      cleanup();
      return;
    }

    if (key === '\r' || key === '\n') {
      // Enter — show detail (already visible)
      render();
      return;
    }

    // Arrow keys
    if (key === '\x1b[A' || key === 'k') {
      // Up
      selectedIndex = Math.max(0, selectedIndex - 1);
      render();
      return;
    }

    if (key === '\x1b[B' || key === 'j') {
      // Down
      selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
      render();
      return;
    }

    // Page up / down
    if (key === '\x1b[5~') {
      selectedIndex = Math.max(0, selectedIndex - (screenHeight - 10));
      render();
      return;
    }

    if (key === '\x1b[6~') {
      selectedIndex = Math.min(items.length - 1, selectedIndex + (screenHeight - 10));
      render();
      return;
    }

    // Home / End
    if (key === '\x1b[H' || key === '\x1b[1~') {
      selectedIndex = 0;
      render();
      return;
    }

    if (key === '\x1b[F' || key === '\x1b[4~') {
      selectedIndex = items.length - 1;
      render();
      return;
    }
  };

  const cleanup = () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeListener('data', onData);
    process.stdout.write(`\n${SHOW_CURSOR}`);
  };

  process.stdin.on('data', onData);
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return FG_RED;
    case 'high': return FG_RED;
    case 'medium': return FG_YELLOW;
    case 'low': return DIM;
    default: return RESET;
  }
}

function visibleLength(str: string): number {
  // Strip ANSI codes for width calculation
  return str.replace(/\x1b\[\d+(?:;\d+)*m/g, '').length;
}
