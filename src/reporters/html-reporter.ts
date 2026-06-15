// ---------------------------------------------------------------------------
// npm-goodjob — HTML reporter
// Writes a self-contained HTML audit report with embedded CSS.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import type { AuditReport, HealthScore, Issue, Reporter, Severity } from '../types.js';

export const htmlReporter: Reporter = {
  write(report: AuditReport): void {
    process.stdout.write(renderHtml(report));
  },
};

/** Write HTML report to a file path */
export async function writeHtmlFile(report: AuditReport, filePath: string): Promise<void> {
  writeFileSync(filePath, renderHtml(report), 'utf-8');
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderHtml(report: AuditReport): string {
  const { summary, tools, metadata } = report;

  const toolRows = Object.values(tools)
    .filter((t) => t.issues.length > 0 || t.status === 'error')
    .map(renderToolSection)
    .join('\n');

  const toolsWithIssues = Object.values(tools)
    .filter(t => t.issues.length > 0 || t.status === 'error')
    .map(t => t.label)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  const toolFilterHtml = toolsWithIssues.length > 0
    ? `<div class="filter-row">
  <strong style="font-size:13px;flex-shrink:0;">Tool:</strong>
  <a href="#" onclick="unselectGroup('.tool-filter');return false" style="font-size:11px;color:#a0aec0;text-decoration:none;" title="Unselect all tools">⊘</a>
  <a href="#" onclick="resetGroup('.tool-filter');return false" style="font-size:11px;color:#a0aec0;text-decoration:none;" title="Select all tools">↺</a>
  ${toolsWithIssues.map(label => `<label><input type="checkbox" class="tool-filter" value="${escapeHtml(label)}" checked onchange="applyFilters()"> ${escapeHtml(label)}</label>`).join('\n  ')}
  </div>`
    : '';

  const toolLabelMap: Record<string, string> = {};
  for (const t of Object.values(tools)) {
    toolLabelMap[t.tool] = t.label;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>npm-goodjob Audit Report — ${escapeHtml(metadata.projectName || 'unnamed')}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
    background: #f5f7fa;
    color: #1a1a2e;
    line-height: 1.6;
    padding: 24px;
  }
  .container { max-width: 960px; margin: 0 auto; }

  /* Header */
  header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #fff;
    border-radius: 12px;
    padding: 32px;
    margin-bottom: 24px;
  }
  header h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
  header .meta { font-size: 13px; color: #a0aec0; }
  header .meta span { margin-right: 20px; }

  /* Summary cards */
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card {
    background: #fff;
    border-radius: 10px;
    padding: 20px;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,.08);
  }
  .stat-card .num { font-size: 32px; font-weight: 700; }
  .stat-card .label { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #718096; margin-top: 4px; }
  .num-total { color: #1a1a2e; }
  .num-error { color: #e53e3e; }
  .num-warning { color: #dd6b20; }
  .num-info { color: #3182ce; }

  /* Severity badges */
  .sev-critical { background: #e53e3e; color: #fff; }
  .sev-high { background: #ed8936; color: #fff; }
  .sev-medium { background: #ecc94b; color: #1a1a2e; }
  .sev-low { background: #4299e1; color: #fff; }

  .level-error { border-left: 4px solid #e53e3e; }
  .level-warning { border-left: 4px solid #dd6b20; }
  .level-info { border-left: 4px solid #3182ce; }

  /* Level badges */
  .level-badge {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    padding: 1px 5px;
    border-radius: 3px;
    min-width: 34px;
    text-align: center;
    line-height: 1.4;
  }
  .level-badge.error { background: #fed7d7; color: #9b2c2c; border: 1px solid #feb2b2; }
  .level-badge.warning { background: #fefcbf; color: #975a16; border: 1px solid #f6e05e; }
  .level-badge.info { background: #bee3f8; color: #2a4365; border: 1px solid #90cdf4; }

  /* Filter bar groups */
  .filter-group { display: flex; align-items: center; gap: 8px; }
  /* Text search */
  .search-input {
    flex: 1; min-width: 140px; max-width: 240px;
    padding: 4px 10px; font-size: 13px;
    border: 1px solid #e2e8f0; border-radius: 6px;
    background: #fff; color: #1a1a2e; outline: none;
  }
  .search-input:focus { border-color: #4299e1; box-shadow: 0 0 0 2px rgba(66,153,225,.15); }
  .search-input::placeholder { color: #a0aec0; }

  /* Group toggle */
  .group-toggle { margin-left: auto; }

  /* File groups */
  .file-group { border-top: 1px solid #edf2f7; }
  .file-group:first-child { border-top: none; }
  .file-header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 20px; background: #f7fafc; font-size: 12px;
    color: #4a5568; font-weight: 600;
    border-bottom: 1px solid #edf2f7;
    position: sticky; top: 0; z-index: 1;
  }
  .file-path { font-family: 'SF Mono', Monaco, monospace; color: #2d3748; }
  .file-count {
    margin-left: auto; font-size: 11px; font-weight: 400;
    background: #e2e8f0; padding: 0 8px; border-radius: 999px; color: #4a5568;
  }
  .file-group .issue { padding-left: 32px; }
  .issue.hidden-group { display: none; }

  /* Fix suggestion */
  .issue-fix { margin-top: 6px; }
  .issue-fix code, .fix-cmd {
    display: inline-block; font-size: 11px; padding: 2px 8px;
    background: #f0fff4; color: #22543d; border: 1px solid #c6f6d5;
    border-radius: 4px; cursor: pointer; user-select: all;
    font-family: 'SF Mono', Monaco, monospace;
  }
  .fix-cmd:hover { background: #c6f6d5; }
  .fix-cmd::before { content: '$ '; opacity: .5; }

  /* Collapsible health score section */
  .healthscore-section { margin-bottom: 16px; }
  .healthscore-bar {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    background: #fff; border-radius: 10px; padding: 10px 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08); cursor: pointer;
    user-select: none; transition: box-shadow .15s;
  }
  .healthscore-bar:hover { box-shadow: 0 2px 8px rgba(0,0,0,.12); }
  .healthscore-summary { font-size: 14px; font-weight: 600; color: #1a1a2e; white-space: nowrap; }
  .healthscore-summary .hs-value { color: #38a169; }
  .healthscore-summary .hs-value.ok { color: #dd6b20; }
  .healthscore-summary .hs-value.bad { color: #e53e3e; }
  .healthscore-breakdown { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #4a5568; }
  .healthscore-breakdown .sev-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 2px;
  }
  .sev-dot.critical { background: #e53e3e; }
  .sev-dot.high { background: #ed8936; }
  .sev-dot.medium { background: #ecc94b; }
  .sev-dot.low { background: #4299e1; }
  .healthscore-breakdown .num { font-weight: 600; }
  .healthscore-breakdown .label { color: #a0aec0; margin-left: -4px; margin-right: 4px; }
  .healthscore-toggle { margin-left: auto; font-size: 12px; color: #a0aec0; transition: transform .2s; }
  .healthscore-section.collapsed .healthscore-toggle { transform: rotate(-90deg); }
  .healthscore-section .healthscore-body { overflow: hidden; max-height: 2000px; transition: max-height .3s ease, opacity .3s; opacity: 1; }
  .healthscore-section.collapsed .healthscore-body { max-height: 0; opacity: 0; margin: 0; padding: 0; }
  .healthscore-section.collapsed .healthscore-body > * { display: none; }

  /* NEW regression badge */
  .badge-new {
    display: inline-block; font-size: 9px; font-weight: 700;
    padding: 1px 5px; border-radius: 3px;
    background: #c6f6d5; color: #22543d; border: 1px solid #9ae6b4;
    margin-left: 6px; vertical-align: middle;
  }

  /* Tool sections */
  .tool-card {
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08);
    margin-bottom: 16px;
    overflow: hidden;
  }
  .tool-header {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid #edf2f7;
  }
  .tool-header h2 { font-size: 16px; font-weight: 600; flex: 1; }
  .tool-status { font-size: 12px; padding: 2px 10px; border-radius: 999px; font-weight: 600; }
  .tool-status.ok { background: #c6f6d5; color: #22543d; }
  .tool-status.skip { background: #e2e8f0; color: #4a5568; }
  .tool-status.err { background: #fed7d7; color: #9b2c2c; }
  .tool-count { font-size: 13px; color: #718096; }

  .tool-body { padding: 0; }
  .tool-skipped, .tool-error-msg { padding: 16px 20px; color: #718096; font-size: 13px; }

  /* Issue list */
  .issue { padding: 12px 20px; display: flex; gap: 12px; align-items: flex-start; }
  .issue + .issue { border-top: 1px solid #f7fafc; }
  .issue-badge {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    padding: 2px 8px;
    border-radius: 4px;
    min-width: 52px;
    text-align: center;
  }
  .issue-body { flex: 1; min-width: 0; }
  .issue-msg { font-size: 14px; font-weight: 500; word-break: break-word; }
  .issue-detail { font-size: 12px; color: #718096; margin-top: 4px; white-space: pre-wrap; line-height: 1.5; }
  .issue-meta { font-size: 11px; color: #a0aec0; margin-top: 4px; }
  .issue-meta span { margin-right: 12px; }

  /* Category breakdown */
  .cat-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .cat-tag {
    font-size: 11px; padding: 2px 8px; border-radius: 4px;
    background: #edf2f7; color: #4a5568;
  }
  .cat-tag strong { margin-right: 4px; }
  .cat-chart-wrapper { margin-top: 12px; overflow-x: auto; }
  .cat-chart { min-width: 280px; height: auto; }

  /* Severity row */
  .sev-charts { margin-top: 12px; }
  .sev-row { display: flex; gap: 8px; }
  .sev-bar {
    height: 8px; border-radius: 4px; flex: 1;
  }
  .sev-bar.critical { background: #e53e3e; }
  .sev-bar.high { background: #ed8936; }
  .sev-bar.medium { background: #ecc94b; }
  .sev-bar.low { background: #4299e1; }

  /* Severity donut SVG */
  .donut-row { display: flex; justify-content: center; margin-top: 12px; }
  .donut-wrapper { display: flex; align-items: center; gap: 24px; justify-content: center; flex-wrap: wrap; }
  .donut-chart { max-width: 200px; height: auto; }
  .donut-slice { transition: opacity .2s, stroke-width .2s; cursor: pointer; }
  .donut-slice:hover { opacity: .8; stroke-width: 20; }
  .donut-legend { display: flex; flex-direction: column; gap: 6px; }
  .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #4a5568; }
  .legend-dot { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  .legend-label { flex: 1; }
  .legend-count { font-weight: 600; color: #1a1a2e; margin-left: auto; }

  /* Weighted score explanation */
  .weighted-desc { font-size: 11px; color: #a0aec0; margin-top: 4px; line-height: 1.5; }

  /* Health score legend */
  .health-info { font-size: 12px; color: #718096; background: #f7fafc; border-radius: 6px; padding: 8px 12px; margin-top: 12px; line-height: 1.6; }

  @media (max-width: 600px) {
    .donut-chart { max-width: 140px; }
  }

  /* Filter bar */
  .filter-bar {
    background: #fff; border-radius: 10px; padding: 12px 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 16px;
  }
  .filter-row {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 4px 0;
  }
  .filter-row + .filter-row { border-top: 1px solid #edf2f7; }
  .filter-bar label { font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .filter-bar input[type="checkbox"] { accent-color: #4a5568; }
  .filter-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }

  /* Clickable stat cards */
  .stat-card.clickable { cursor: pointer; transition: transform .15s, box-shadow .15s; }
  .stat-card.clickable:hover { transform: translateY(-2px); box-shadow: 0 3px 8px rgba(0,0,0,.12); }
  .stat-card.clickable.active { box-shadow: inset 0 0 0 2px currentColor; }
  .filter-count { font-size: 12px; color: #718096; margin-left: auto; }
  .issue.hidden { display: none; }
  .tool-card.hidden-card { display: none; }

  /* Collapsible tool sections */
  .tool-header { cursor: pointer; user-select: none; }
  .tool-header .collapse-icon { font-size: 12px; color: #a0aec0; transition: transform .15s; }
  .tool-header.collapsed .collapse-icon { transform: rotate(-90deg); }
  .tool-body.collapsed { display: none; }

  /* Health score gauge */
  .health-score {
    background: #fff; border-radius: 10px; padding: 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 24px;
  }
  .health-score h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
  .health-gauge {
    display: flex; align-items: center; gap: 16px; margin-bottom: 16px;
  }
  .health-circle {
    width: 80px; height: 80px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 800; color: #fff;
    flex-shrink: 0;
  }
  .health-circle.good { background: #38a169; }
  .health-circle.ok { background: #dd6b20; }
  .health-circle.bad { background: #e53e3e; }
  .health-subgrid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .health-cat {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; padding: 4px 8px; border-radius: 6px; background: #f7fafc;
  }
  .health-cat .cat-score { font-weight: 700; min-width: 32px; }
  .health-cat .cat-bar { flex: 1; height: 6px; border-radius: 3px; background: #edf2f7; }
  .health-cat .cat-fill { height: 100%; border-radius: 3px; }
  .health-detail { font-size: 12px; color: #718096; }

  /* Weighted score */
  .weighted-score { margin-top: 12px; display: flex; align-items: center; gap: 8px; }
  .weighted-value {
    font-size: 14px; font-weight: 700; padding: 2px 10px; border-radius: 6px; color: #fff;
  }
  .weighted-value.good { background: #38a169; }
  .weighted-value.ok { background: #dd6b20; }
  .weighted-value.bad { background: #e53e3e; }
  .weighted-label { font-size: 12px; color: #718096; }

  @media (max-width: 600px) {
    body { padding: 12px; }
    header { padding: 20px; }
    .summary-grid { grid-template-columns: repeat(2, 1fr); }
    .health-gauge { flex-direction: column; }
    .health-subgrid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="container">

<header>
  <h1>🔍 npm-goodjob Audit Report</h1>
  <div class="meta">
    <span><strong>Project:</strong> ${escapeHtml(metadata.projectName || '(unnamed)')}</span>
    <span><strong>Path:</strong> ${escapeHtml(metadata.projectPath)}</span>
    <span><strong>Date:</strong> ${metadata.timestamp}</span>
    <span><strong>Duration:</strong> ${formatDuration(metadata.durationMs)}</span>
    <span><strong>Node:</strong> ${metadata.nodeVersion}</span>
  </div>
</header>

<!-- Summary -->
<div class="summary-grid">
  <div class="stat-card clickable" onclick="resetLevelFilters()"><div class="num num-total">${summary.total}</div><div class="label">Total Issues</div></div>
  <div class="stat-card clickable" onclick="filterByLevel('error')"><div class="num num-error">${summary.errors}</div><div class="label">Errors</div></div>
  <div class="stat-card clickable" onclick="filterByLevel('warning')"><div class="num num-warning">${summary.warnings}</div><div class="label">Warnings</div></div>
  <div class="stat-card clickable" onclick="filterByLevel('info')"><div class="num num-info">${summary.info}</div><div class="label">Info</div></div>
</div>

<!-- Health score (collapsible) -->
<div class="healthscore-section collapsed" id="healthscoreSection">
  <div class="healthscore-bar" onclick="toggleHealthScore()">
    <span class="healthscore-summary">
      ${report.healthScore
        ? `<span class="hs-value ${(report.healthScore.total / (report.healthScore.max || 20)) >= 0.8 ? '' : (report.healthScore.total / (report.healthScore.max || 20)) >= 0.6 ? 'ok' : 'bad'}">${report.healthScore.total}/${report.healthScore.max || 20}</span>`
        : '<span class="hs-value">--</span>'}
      &nbsp;—&nbsp;${summary.total} issues
    </span>
    <span class="healthscore-breakdown">
      <span class="sev-dot critical"></span><span class="num">${summary.bySeverity.critical || 0}</span><span class="label">critical</span>
      <span class="sev-dot high"></span><span class="num">${summary.bySeverity.high || 0}</span><span class="label">high</span>
      <span class="sev-dot medium"></span><span class="num">${summary.bySeverity.medium || 0}</span><span class="label">medium</span>
      <span class="sev-dot low"></span><span class="num">${summary.bySeverity.low || 0}</span><span class="label">low</span>
    </span>
    <span class="healthscore-toggle">▼</span>
  </div>
  <div class="healthscore-body">
    ${report.healthScore ? renderHealthScore(report.healthScore) : ''}
    ${renderSeverityBars(summary.bySeverity)}
    ${renderCategories(summary.byCategory)}
  </div>
</div>

<!-- Filter bar -->
<div class="filter-bar" id="filterBar">
  <div class="filter-row">
    <strong style="font-size:13px;flex-shrink:0;">Severity:</strong>
    <a href="#" onclick="unselectGroup('.sev-filter');return false" style="font-size:11px;color:#a0aec0;text-decoration:none;" title="Unselect all severity levels">⊘</a>
    <a href="#" onclick="resetGroup('.sev-filter');return false" style="font-size:11px;color:#a0aec0;text-decoration:none;" title="Select all severity levels">↺</a>
    <label><input type="checkbox" class="sev-filter" value="critical" checked onchange="applyFilters()"> Critical</label>
    <label><input type="checkbox" class="sev-filter" value="high" checked onchange="applyFilters()"> High</label>
    <label><input type="checkbox" class="sev-filter" value="medium" checked onchange="applyFilters()"> Medium</label>
    <label><input type="checkbox" class="sev-filter" value="low" checked onchange="applyFilters()"> Low</label>
  </div>
  <div class="filter-row">
    <strong style="font-size:13px;flex-shrink:0;">Level:</strong>
    <a href="#" onclick="unselectGroup('.lvl-filter');return false" style="font-size:11px;color:#a0aec0;text-decoration:none;" title="Unselect all levels">⊘</a>
    <a href="#" onclick="resetGroup('.lvl-filter');return false" style="font-size:11px;color:#a0aec0;text-decoration:none;" title="Select all levels">↺</a>
    <label><input type="checkbox" class="lvl-filter" value="error" checked onchange="applyFilters()"> Error</label>
    <label><input type="checkbox" class="lvl-filter" value="warning" checked onchange="applyFilters()"> Warning</label>
    <label><input type="checkbox" class="lvl-filter" value="info" checked onchange="applyFilters()"> Info</label>
  </div>
  ${toolFilterHtml}
  <div class="filter-row">
    <input type="text" class="search-input" id="textSearch" placeholder="🔍 Search issues…" oninput="applyFilters()">
    <label><input type="checkbox" id="groupToggle" onchange="toggleGroupByFile()"> 📁 Group by file</label>
    <span style="display:flex;gap:8px;">
      <a href="#" onclick="unselectAll();return false" style="color:#718096;text-decoration:none;font-size:13px;" title="Uncheck all filters">⊘ Unselect all</a>
      <a href="#" onclick="resetFilters();return false" style="color:#4299e1;text-decoration:none;font-size:13px;" title="Reset all filters to default">↺ Reset</a>
    </span>
    <span class="filter-count" id="visibleCount"></span>
  </div>
</div>

<!-- Tool results -->
<div id="results">
${toolRows || '<p style="color:#718096;text-align:center;padding:40px 0;">No issues found — good job!</p>'}
</div>

<!-- Footer -->
<div style="text-align:center;padding:24px 0;color:#a0aec0;font-size:12px;">
  Generated by npm-goodjob v${metadata.goodjobVersion}
</div>

</div>

<script>
var toolLabels = ${JSON.stringify(toolLabelMap)};
function applyFilters() {
  const checkedSev = {}, checkedLvl = {}, checkedTool = {};
  document.querySelectorAll('#filterBar .sev-filter').forEach(cb => { checkedSev[cb.value] = cb.checked; });
  document.querySelectorAll('#filterBar .lvl-filter').forEach(cb => { checkedLvl[cb.value] = cb.checked; });
  document.querySelectorAll('#filterBar .tool-filter').forEach(cb => { checkedTool[cb.value] = cb.checked; });
  const activeLabels = Object.keys(checkedTool).filter(k => checkedTool[k]);
  const hasToolFilters = Object.keys(checkedTool).length > 0;
  const search = (document.getElementById('textSearch').value || '').toLowerCase();
  let visible = 0;
  document.querySelectorAll('.issue').forEach(el => {
    const sev = el.dataset.severity;
    const lvl = el.dataset.level;
    const toolLabel = toolLabels[el.dataset.tool] || el.dataset.tool;
    const toolMatch = !hasToolFilters || activeLabels.includes(toolLabel);
    const txt = el.textContent.toLowerCase();
    const match = (checkedSev[sev] === true) && (checkedLvl[lvl] === true)
      && toolMatch
      && (!search || txt.includes(search));
    el.classList.toggle('hidden', !match);
    if (match) visible++;
  });
  const count = document.getElementById('visibleCount');
  if (count) count.textContent = visible + ' issue' + (visible !== 1 ? 's' : '') + ' shown';
  // Hide tool-card when its tool filter is unchecked, or all its issues are hidden
  document.querySelectorAll('.tool-card').forEach(card => {
    const toolLabel = card.dataset.toolLabel;
    const toolFilteredOut = hasToolFilters && toolLabel && !activeLabels.includes(toolLabel);
    const totalIssues = card.querySelectorAll('.issue').length;
    const visibleIssues = card.querySelectorAll('.issue:not(.hidden)').length;
    card.classList.toggle('hidden-card', toolFilteredOut || (totalIssues > 0 && visibleIssues === 0));
  });
  // Update active state on stat cards
  document.querySelectorAll('.stat-card.clickable').forEach(card => card.classList.remove('active'));
  const activeLevel = Object.keys(checkedLvl).filter(k => checkedLvl[k]);
  if (activeLevel.length === 1) {
    document.querySelectorAll('.stat-card.clickable').forEach(card => {
      if (card.getAttribute('onclick')?.includes("'" + activeLevel[0] + "'")) {
        card.classList.add('active');
      }
    });
  }
}
function unselectGroup(selector) {
  document.querySelectorAll('#filterBar ' + selector).forEach(cb => { cb.checked = false; });
  applyFilters();
}
function resetGroup(selector) {
  document.querySelectorAll('#filterBar ' + selector).forEach(cb => { cb.checked = true; });
  applyFilters();
}
function unselectAll() {
  document.querySelectorAll('#filterBar input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  applyFilters();
}
function resetFilters() {
  document.querySelectorAll('#filterBar input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  document.getElementById('textSearch').value = '';
  applyFilters();
}
function filterByLevel(level) {
  const active = document.querySelector('#filterBar .lvl-filter[value="' + level + '"]')?.checked;
  // Toggle: if already the only active filter, reset instead
  const isOnly = document.querySelectorAll('#filterBar .lvl-filter:checked').length === 1
    && active;
  document.querySelectorAll('#filterBar .lvl-filter').forEach(cb => { cb.checked = isOnly ? true : cb.value === level; });
  applyFilters();
}
function resetLevelFilters() {
  document.querySelectorAll('#filterBar .lvl-filter').forEach(cb => { cb.checked = true; });
  applyFilters();
}
function toggleHealthScore() {
  document.getElementById('healthscoreSection').classList.toggle('collapsed');
}
function esc(s) {
  var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
}
function toggleGroupByFile() {
  const grouped = document.getElementById('groupToggle').checked;
  document.querySelectorAll('.tool-body').forEach(body => {
    const issues = body.querySelectorAll('.issue');
    if (!issues.length || body.querySelector('.tool-skipped, .tool-error-msg')) return;

    if (grouped) {
      if (!body.dataset.flatHtml) body.dataset.flatHtml = body.innerHTML;
      const groups = {};
      issues.forEach(el => {
        const file = el.dataset.file || '(no file)';
        if (!groups[file]) groups[file] = [];
        groups[file].push(el.outerHTML);
      });
      body.innerHTML = Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, htmls]) =>
          '<div class="file-group">' +
          '<div class="file-header">📁 <span class="file-path">' + esc(file) + '</span> <span class="file-count">' + htmls.length + '</span></div>' +
          htmls.join('') +
          '</div>'
        ).join('');
    } else {
      if (body.dataset.flatHtml) body.innerHTML = body.dataset.flatHtml;
    }
  });
  applyFilters();
}
// Collapsible tool headers
document.addEventListener('click', function(e) {
  const header = e.target.closest('.tool-header');
  if (header) {
    header.classList.toggle('collapsed');
    const body = header.nextElementSibling;
    if (body) body.classList.toggle('collapsed');
  }
});
applyFilters();
</script>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderHealthScore(hs: HealthScore): string {
  const max = hs.max || 20;
  const pct = max > 0 ? hs.total / max : 0;
  const circleClass = pct >= 0.8 ? 'good' : pct >= 0.6 ? 'ok' : 'bad';
  const catColors: Record<string, string> = {
    Security: '#e53e3e',
    Dependencies: '#dd6b20',
    'Code Quality': '#3182ce',
    'Project Health': '#38a169',
  };

  const rows = hs.breakdown
    .map((cat) => {
      const pct = cat.max > 0 ? (cat.score / cat.max) * 100 : 0;
      const color = catColors[cat.label] ?? '#718096';
      return `<div class="health-cat">
        <span class="cat-score" style="color:${color}">${cat.score}/${cat.max}</span>
        <div class="cat-bar"><div class="cat-fill" style="width:${pct}%;background:${color}"></div></div>
        <span>${cat.label}</span>
      </div>`;
    })
    .join('');

  const detailsDiv = hs.breakdown
    .map((cat) => `<div class="health-detail"><strong>${cat.label}:</strong> ${escapeHtml(cat.detail)}</div>`)
    .join('');

  const weightedHtml = hs.weighted
    ? `<div class="weighted-score">
        <span class="weighted-value ${hs.weighted.score >= 15 ? 'good' : hs.weighted.score >= 10 ? 'ok' : 'bad'}">${hs.weighted.score}/20</span>
        <span class="weighted-label">Severity-Weighted Score</span>
      </div>
      <div class="weighted-desc">
        Penalty model: starts at 20, subtracts per issue (critical −3, high −2, medium −1, low −0.5).
        The flat score (left) equally weights 4 dimensions; the weighted score (right) reflects actual issue impact.
      </div>`
    : '';

  const totalIssues = Object.values(hs.weighted?.penalties ?? []).length || 0;
  const penaltyCount = hs.weighted?.penalties.length ?? 0;
  const infoHtml = `<div class="health-info">
    <strong>How to read this:</strong>
    Left gauge = flat score /20 (4 dimensions equally weighted).
    Below it, each category shows its contribution.
    ${hs.weighted ? `Right badge = severity-weighted score /20 (penalty model, accounts for issue severity). <strong>0/20</strong> means penalties exceeded 20 points. See top ${Math.min(5, penaltyCount)} penalties below.` : ''}
    ${totalIssues > 0 ? `The detail lines show what impacted each category (penalties and bonuses).` : ''}
  </div>`;

  return `<div class="health-score">
    <h2>Health Score</h2>
    <div class="health-gauge">
      <div class="health-circle ${circleClass}">${hs.total}</div>
      <div class="health-subgrid">${rows}</div>
    </div>
    ${weightedHtml}
    ${infoHtml}
    ${detailsDiv}
  </div>`;
}

function renderSeverityBars(bySeverity: Record<Severity, number>): string {
  const total = Object.values(bySeverity).reduce((a, b) => a + b, 0);
  if (total === 0) return '';
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  const bars = order
    .map((s) => {
      const count = bySeverity[s] ?? 0;
      const pct = total > 0 ? (count / total) * 100 : 0;
      return count > 0
        ? `<div class="sev-bar ${s}" style="flex:${pct}" title="${count} ${s}"></div>`
        : '';
    })
    .filter(Boolean)
    .join('');

  // SVG donut chart
  const donutSvg = renderSeverityDonut(bySeverity, total);

  return `<div class="sev-charts">
    <div class="sev-row">${bars}</div>
    <div class="donut-row">${donutSvg}</div>
  </div>`;
}

function renderSeverityDonut(bySeverity: Record<Severity, number>, total: number): string {
  if (total === 0) return '';
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  const labels: Record<Severity, string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  };
  const colors: Record<Severity, string> = {
    critical: '#e53e3e',
    high: '#ed8936',
    medium: '#ecc94b',
    low: '#4299e1',
  };
  const r = 40;
  const cx = 100;
  const cy = 60;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const slices = order
    .filter((s) => (bySeverity[s] ?? 0) > 0)
    .map((s) => {
      const pct = (bySeverity[s] ?? 0) / total;
      const len = pct * circ;
      const slice = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[s]}"
        stroke-width="16" stroke-dasharray="${len} ${circ - len}"
        stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"
        class="donut-slice" data-severity="${s}" />`;
      offset += len;
      return slice;
    })
    .join('');

  const legendItems = order
    .filter((s) => (bySeverity[s] ?? 0) > 0)
    .map((s) => `<span class="legend-item">
      <span class="legend-dot" style="background:${colors[s]}"></span>
      <span class="legend-label">${labels[s]}</span>
      <span class="legend-count">${bySeverity[s]}</span>
    </span>`)
    .join('');

  return `<div class="donut-wrapper">
    <svg width="200" height="120" viewBox="0 0 200 120" class="donut-chart" role="img" aria-label="Severity distribution">
      ${slices}
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="22" font-weight="700" fill="#1a1a2e">${total}</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="10" fill="#718096">issues</text>
    </svg>
    <div class="donut-legend">${legendItems}</div>
  </div>`;
}

function renderCategories(byCategory: Record<string, number>): string {
  const entries = Object.entries(byCategory).filter(([, c]) => c > 0);
  if (entries.length === 0) return '';

  const tags = entries
    .map(([cat, count]) => `<span class="cat-tag"><strong>${count}</strong> ${cat}</span>`)
    .join('');

  const maxCount = Math.max(...entries.map(([, c]) => c), 1);
  const colors = ['#e53e3e', '#dd6b20', '#3182ce', '#38a169', '#805ad5', '#d53f8c', '#00b5d8'];
  const barHeight = 22;
  const barGap = 6;
  const svgH = entries.length * (barHeight + barGap) + 10;
  const labelW = 130;
  const maxBarW = 220;

  const bars = entries
    .map(([cat, count], i) => {
      const pct = count / maxCount;
      const barW = Math.max(20, pct * maxBarW);
      const y = 10 + i * (barHeight + barGap);
      const color = colors[i % colors.length];
      const label = cat.length > 18 ? cat.slice(0, 15) + '…' : cat;
      return `<g>
        <text x="0" y="${y + 15}" font-size="11" fill="#4a5568">
          <title>${escapeHtml(cat)} (${count})</title>${escapeHtml(label)}</text>
        <rect x="${labelW}" y="${y}" width="${barW}" height="${barHeight}" rx="4" fill="${color}" opacity=".85" />
        <text x="${labelW + barW + 6}" y="${y + 15}" font-size="11" font-weight="600" fill="#1a1a2e">${count}</text>
      </g>`;
    })
    .join('');

  const chartSvg = `<svg width="100%" viewBox="0 0 ${labelW + maxBarW + 60} ${svgH}" class="cat-chart" role="img" aria-label="Issues by category">
    ${bars}
  </svg>`;

  return `<div class="cat-list">${tags}</div>
    <div class="cat-chart-wrapper">${chartSvg}</div>`;
}

function renderToolSection(result: AuditReport['tools'][string]): string {
  const statusClass =
    result.status === 'success' ? 'ok' : result.status === 'skipped' ? 'skip' : 'err';

  const statusLabel =
    result.status === 'success' ? '✓ OK' : result.status === 'skipped' ? '– SKIP' : '✗ ERROR';

  const body = result.status === 'skipped' && result.skipReason
    ? `<div class="tool-skipped">⤷ ${escapeHtml(result.skipReason)}</div>`
    : result.status === 'error' && result.errorMessage
      ? `<div class="tool-error-msg">✗ ${escapeHtml(result.errorMessage)}</div>`
      : result.issues.map(renderIssue).join('');

  const toolParts = result.tool.split('/');
  const workspacePrefix = toolParts.length > 1 ? toolParts.slice(0, -1).join('/') : null;

  const headerLabel = workspacePrefix
    ? `${escapeHtml(workspacePrefix)} <span style="color:#a0aec0;font-weight:400;">—</span> ${escapeHtml(result.label)}`
    : escapeHtml(result.label);

  return `<div class="tool-card" data-tool-label="${escapeHtml(result.label)}">
    <div class="tool-header">
      <h2>${headerLabel} <span style="font-weight:400;font-size:13px;color:#718096;">v${escapeHtml(result.version)}</span></h2>
      <span class="tool-count">${result.issues.length} issues</span>
      <span class="tool-status ${statusClass}">${statusLabel}</span>
    </div>
    <div class="tool-body">${body}</div>
  </div>`;
}

function renderIssue(issue: Issue): string {
  const sevLabel = issue.severity.toUpperCase();
  const sevClass = `sev-${issue.severity}`;
  const levelClass = `level-${issue.level}`;

  const location =
    issue.file
      ? `<span>📁 ${escapeHtml(issue.file)}${issue.line ? `:${issue.line}` : ''}</span>`
      : '';

  const pkgInfo = issue.package
    ? `<span>📦 ${escapeHtml(issue.package)}${issue.version ? `@${escapeHtml(issue.version)}` : ''}</span>`
    : '';

  const cveInfo = issue.cve ? `<span>🔑 ${escapeHtml(issue.cve)}</span>` : '';

  let fixSuggestion = '';
  if (issue.package && issue.fixVersion) {
    if (issue.fixVersion === 'npm audit fix') {
      fixSuggestion = `<div class="issue-fix"><span class="fix-cmd" onclick="navigator.clipboard.writeText('npm audit fix');this.textContent='✓ Copied!'">npm audit fix</span></div>`;
    } else {
      fixSuggestion = `<div class="issue-fix"><span class="fix-cmd" onclick="navigator.clipboard.writeText('npm install ${escapeHtml(issue.package)}@${escapeHtml(issue.fixVersion)}');this.textContent='✓ Copied!'">npm install ${escapeHtml(issue.package)}@${escapeHtml(issue.fixVersion)}</span></div>`;
    }
  }

  const newBadge = (issue as any).isNew
    ? `<span class="badge-new">NEW</span>`
    : '';

  return `<div class="issue ${levelClass}" data-severity="${issue.severity}" data-level="${issue.level}" data-tool="${escapeHtml(issue.tool)}"${issue.file ? ` data-file="${escapeHtml(issue.file)}"` : ''}>
    <span class="issue-badge ${sevClass}">${sevLabel}</span>
    <span class="level-badge ${issue.level}">${issue.level === 'error' ? 'ERR' : issue.level === 'warning' ? 'WARN' : 'INFO'}</span>
    <div class="issue-body">
      <div class="issue-msg">${escapeHtml(issue.message)}${newBadge}</div>
      ${issue.detail ? `<div class="issue-detail">${escapeHtml(issue.detail)}</div>` : ''}
      <div class="issue-meta">${location}${pkgInfo}${cveInfo}</div>
      ${fixSuggestion}
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}
