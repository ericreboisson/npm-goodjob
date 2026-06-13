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

function renderHtml(report: AuditReport): string {
  const { summary, tools, metadata } = report;

  const toolRows = Object.values(tools)
    .filter((t) => t.issues.length > 0 || t.status === 'error')
    .map(renderToolSection)
    .join('\n');

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
  .issue-detail { font-size: 12px; color: #718096; margin-top: 4px; }
  .issue-meta { font-size: 11px; color: #a0aec0; margin-top: 4px; }
  .issue-meta span { margin-right: 12px; }

  /* Category breakdown */
  .cat-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .cat-tag {
    font-size: 11px; padding: 2px 8px; border-radius: 4px;
    background: #edf2f7; color: #4a5568;
  }
  .cat-tag strong { margin-right: 4px; }

  /* Severity row */
  .sev-row { display: flex; gap: 8px; margin-top: 12px; }
  .sev-bar {
    height: 8px; border-radius: 4px; flex: 1;
  }
  .sev-bar.critical { background: #e53e3e; }
  .sev-bar.high { background: #ed8936; }
  .sev-bar.medium { background: #ecc94b; }
  .sev-bar.low { background: #4299e1; }

  /* Filter bar */
  .filter-bar {
    background: #fff; border-radius: 10px; padding: 12px 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 16px;
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  }
  .filter-bar label { font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .filter-bar input[type="checkbox"] { accent-color: #4a5568; }
  .filter-count { font-size: 12px; color: #718096; margin-left: auto; }
  .issue.hidden { display: none; }

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
  <div class="stat-card"><div class="num num-total">${summary.total}</div><div class="label">Total Issues</div></div>
  <div class="stat-card"><div class="num num-error">${summary.errors}</div><div class="label">Errors</div></div>
  <div class="stat-card"><div class="num num-warning">${summary.warnings}</div><div class="label">Warnings</div></div>
  <div class="stat-card"><div class="num num-info">${summary.info}</div><div class="label">Info</div></div>
</div>

<!-- Health score -->
${report.healthScore ? renderHealthScore(report.healthScore) : ''}

<!-- Severity bars -->
${renderSeverityBars(summary.bySeverity)}

<!-- Category tags -->
${renderCategories(summary.byCategory)}

<!-- Filter bar -->
<div class="filter-bar" id="filterBar">
  <strong style="font-size:13px;">Filter:</strong>
  <label><input type="checkbox" value="critical" checked onchange="applyFilters()"> Critical</label>
  <label><input type="checkbox" value="high" checked onchange="applyFilters()"> High</label>
  <label><input type="checkbox" value="medium" checked onchange="applyFilters()"> Medium</label>
  <label><input type="checkbox" value="low" checked onchange="applyFilters()"> Low</label>
  <span class="filter-count" id="visibleCount"></span>
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
function applyFilters() {
  const checked = {};
  document.querySelectorAll('#filterBar input[type="checkbox"]').forEach(cb => { checked[cb.value] = cb.checked; });
  let visible = 0;
  document.querySelectorAll('.issue').forEach(el => {
    const sev = el.dataset.severity;
    const match = checked[sev] === true;
    el.classList.toggle('hidden', !match);
    if (match) visible++;
  });
  const count = document.getElementById('visibleCount');
  if (count) count.textContent = visible + ' issue' + (visible !== 1 ? 's' : '') + ' shown';
  // Collapse tool sections with no visible issues
  document.querySelectorAll('.tool-card').forEach(card => {
    const visibleIssues = card.querySelectorAll('.issue:not(.hidden)').length;
    const totalIssues = card.querySelectorAll('.issue').length;
    if (totalIssues > 0 && visibleIssues === 0) {
      card.querySelector('.tool-header')?.classList.add('collapsed');
      card.querySelector('.tool-body')?.classList.add('collapsed');
    } else {
      card.querySelector('.tool-header')?.classList.remove('collapsed');
      card.querySelector('.tool-body')?.classList.remove('collapsed');
    }
  });
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

  return `<div class="health-score">
    <h2>Health Score</h2>
    <div class="health-gauge">
      <div class="health-circle ${circleClass}">${hs.total}</div>
      <div class="health-subgrid">${rows}</div>
    </div>
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
        ? `<div class="sev-bar ${s}" style="flex:${pct}"></div>`
        : '';
    })
    .filter(Boolean)
    .join('');
  return `<div class="sev-row">${bars}</div>`;
}

function renderCategories(byCategory: Record<string, number>): string {
  const entries = Object.entries(byCategory).filter(([, c]) => c > 0);
  if (entries.length === 0) return '';
  const tags = entries
    .map(([cat, count]) => `<span class="cat-tag"><strong>${count}</strong> ${cat}</span>`)
    .join('');
  return `<div class="cat-list">${tags}</div>`;
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

  return `<div class="tool-card">
    <div class="tool-header">
      <h2>${escapeHtml(result.label)} <span style="font-weight:400;font-size:13px;color:#718096;">v${escapeHtml(result.version)}</span></h2>
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

  return `<div class="issue ${levelClass}" data-severity="${issue.severity}">
    <span class="issue-badge ${sevClass}">${sevLabel}</span>
    <div class="issue-body">
      <div class="issue-msg">${escapeHtml(issue.message)}</div>
      ${issue.detail ? `<div class="issue-detail">${escapeHtml(issue.detail)}</div>` : ''}
      <div class="issue-meta">${location}${pkgInfo}${cveInfo}</div>
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
