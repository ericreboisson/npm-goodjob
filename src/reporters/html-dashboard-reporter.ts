import { writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { DashboardReport, DashboardProjectEntry, Severity } from '../types.js';

export function writeDashboardHtml(dr: DashboardReport): string {
  const sorted = [...dr.projects].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'error' ? -1 : 1;
    const ha = a.report?.healthScore;
    const hb = b.report?.healthScore;
    if (ha && hb) return ha.total - hb.total;
    if (ha) return -1;
    if (hb) return 1;
    return 0;
  });

  const projectCards = sorted.map(renderProjectCard).join('\n');
  const totalStr = dr.summary.total;
  const errorStr = dr.summary.errors;
  const warnStr = dr.summary.warnings;
  const infoStr = dr.summary.info;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>npm-goodjob Dashboard</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif;background:#f5f7fa;color:#1a1a2e;line-height:1.6;padding:24px;}
  .container{max-width:1200px;margin:0 auto;}

  header{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#fff;border-radius:12px;padding:32px;margin-bottom:24px;}
  header h1{font-size:24px;font-weight:700;margin-bottom:8px;}
  header .meta{font-size:13px;color:#a0aec0;}
  header .meta span{margin-right:20px;}

  .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:24px;}
  .stat-card{background:#fff;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08);}
  .stat-card .num{font-size:32px;font-weight:700;}
  .stat-card .label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#718096;margin-top:4px;}
  .num-pass{color:#38a169;}
  .num-fail{color:#e53e3e;}
  .num-total{color:#1a1a2e;}
  .num-error{color:#e53e3e;}
  .num-warning{color:#dd6b20;}
  .num-info{color:#3182ce;}

  .projects-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px;}

  .project-card{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden;}
  .project-card.error{border:2px solid #fc8181;}
  .project-header{display:flex;align-items:center;gap:16px;padding:16px 20px;border-bottom:1px solid #edf2f7;cursor:pointer;user-select:none;}
  .project-header h2{font-size:15px;font-weight:600;flex:1;}
  .project-header .collapse-icon{font-size:12px;color:#a0aec0;transition:transform .15s;}
  .project-header.collapsed .collapse-icon{transform:rotate(-90deg);}
  .project-body{padding:16px 20px;}
  .project-body.collapsed{display:none;}

  .health-circle{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;flex-shrink:0;}
  .health-circle.good{background:#38a169;}
  .health-circle.ok{background:#dd6b20;}
  .health-circle.bad{background:#e53e3e;}
  .health-circle.na{background:#a0aec0;}

  .status-badge{font-size:11px;padding:3px 10px;border-radius:999px;font-weight:600;}
  .status-badge.ok{background:#c6f6d5;color:#22543d;}
  .status-badge.warn{background:#fefcbf;color:#744210;}
  .status-badge.err{background:#fed7d7;color:#9b2c2c;}

  .project-stats{display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;}
  .project-stat{font-size:13px;}
  .project-stat strong{margin-right:4px;}
  .sev-critical{color:#e53e3e;}
  .sev-high{color:#ed8936;}
  .sev-medium{color:#d69e2e;}
  .sev-low{color:#3182ce;}

  .sev-bar-row{display:flex;gap:4px;height:8px;border-radius:4px;overflow:hidden;margin-bottom:16px;}
  .sev-bar{height:100%;}
  .sev-bar.bg-critical{background:#e53e3e;}
  .sev-bar.bg-high{background:#ed8936;}
  .sev-bar.bg-medium{background:#ecc94b;}
  .sev-bar.bg-low{background:#4299e1;}

  .filter-bar{background:#fff;border-radius:10px;padding:12px 20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
  .filter-bar label{font-size:13px;display:flex;align-items:center;gap:6px;cursor:pointer;}
  .filter-bar input[type="checkbox"]{accent-color:#4a5568;}

  .tool-section{margin-top:12px;border:1px solid #edf2f7;border-radius:8px;overflow:hidden;}
  .tool-section h4{padding:10px 14px;font-size:13px;font-weight:600;background:#f7fafc;cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;}
  .tool-section h4 .collapse-icon{font-size:10px;color:#a0aec0;transition:transform .15s;}
  .tool-section h4.collapsed .collapse-icon{transform:rotate(-90deg);}
  .tool-section .tool-issues{padding:0;}
  .tool-section .tool-issues.collapsed{display:none;}
  .tool-issue{padding:8px 14px;font-size:12px;display:flex;gap:8px;align-items:flex-start;}
  .tool-issue+.tool-issue{border-top:1px solid #f7fafc;}
  .tool-issue .sev-tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;flex-shrink:0;}
  .tool-issue .sev-tag.critical{background:#e53e3e;color:#fff;}
  .tool-issue .sev-tag.high{background:#ed8936;color:#fff;}
  .tool-issue .sev-tag.medium{background:#ecc94b;color:#1a1a2e;}
  .tool-issue .sev-tag.low{background:#4299e1;color:#fff;}
  .tool-issue .issue-msg{flex:1;word-break:break-word;}
  .tool-skip{font-size:12px;padding:10px 14px;color:#718096;}

  .agg-row{background:#fff;border-radius:10px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:24px;display:flex;gap:24px;flex-wrap:wrap;align-items:center;}
  .agg-row span{font-size:14px;}
  .agg-row .num{font-weight:700;}

  /* Team view sections */
  .team-section{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:16px;overflow:hidden;}
  .team-section h2{padding:16px 20px;font-size:16px;font-weight:700;border-bottom:1px solid #edf2f7;background:#fafbfc;}
  .team-section .body{padding:16px 20px;}
  .team-table{width:100%;border-collapse:collapse;font-size:13px;}
  .team-table th{text-align:left;padding:8px 12px;border-bottom:2px solid #edf2f7;color:#718096;font-size:11px;text-transform:uppercase;letter-spacing:.05em;}
  .team-table td{padding:8px 12px;border-bottom:1px solid #f7fafc;}
  .team-table tr:hover td{background:#f7fafc;}
  .dev-badge{display:inline-block;width:28px;height:28px;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:12px;color:#fff;margin-right:8px;}
  .topflop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px;}
  .topflop-card{padding:12px 16px;border-radius:8px;border:1px solid #edf2f7;}
  .topflop-card .name{font-size:13px;font-weight:600;}
  .topflop-card .health{font-size:18px;font-weight:800;margin-top:4px;}
  .topflop-card .issues{font-size:11px;color:#718096;margin-top:2px;}
  .topflop-card.worst{border-color:#fc8181;}
  .topflop-card.best{border-color:#68d391;}
  .regression-badge{color:#e53e3e;font-weight:700;}
  .improvement-badge{color:#38a169;font-weight:700;}

  @media(max-width:600px){
    body{padding:12px;}
    header{padding:20px;}
    .projects-grid{grid-template-columns:1fr;}
    .summary-grid{grid-template-columns:repeat(2,1fr);}
  }
</style>
</head>
<body>
<div class="container">

<header>
  <h1>npm-goodjob Multi-Project Dashboard</h1>
  <div class="meta">
    <span><strong>Projects:</strong> ${dr.projects.length} (${dr.summary.passed} passed${dr.summary.failed > 0 ? `, ${dr.summary.failed} failed` : ''})</span>
    <span><strong>Date:</strong> ${dr.timestamp}</span>
    <span><strong>Duration:</strong> ${formatDuration(dr.totalDurationMs)}</span>
  </div>
</header>

<div class="summary-grid">
  <div class="stat-card"><div class="num num-total">${totalStr}</div><div class="label">Total Issues</div></div>
  <div class="stat-card"><div class="num num-error">${errorStr}</div><div class="label">Errors</div></div>
  <div class="stat-card"><div class="num num-warning">${warnStr}</div><div class="label">Warnings</div></div>
  <div class="stat-card"><div class="num num-info">${infoStr}</div><div class="label">Info</div></div>
</div>

<div class="agg-row">
  <span><strong>Projects:</strong> <span class="num">${dr.projects.length}</span></span>
  <span><strong>Passed:</strong> <span class="num" style="color:#38a169">${dr.summary.passed}</span></span>
  ${dr.summary.failed > 0 ? `<span><strong>Failed:</strong> <span class="num" style="color:#e53e3e">${dr.summary.failed}</span></span>` : ''}
  <span>Sorted: worst health first</span>
</div>

<div class="projects-grid">
${projectCards}
</div>

${renderTeamView(dr)}

<div style="text-align:center;padding:24px 0;color:#a0aec0;font-size:12px;">
  Generated by npm-goodjob
</div>

</div>

<script>
(function() {
  // Collapsible project cards
  document.querySelectorAll('.project-header').forEach(hdr => {
    hdr.addEventListener('click', function() {
      this.classList.toggle('collapsed');
      const body = this.nextElementSibling;
      if (body) body.classList.toggle('collapsed');
    });
  });

  // Collapsible tool sections
  document.querySelectorAll('.tool-section h4').forEach(hdr => {
    hdr.addEventListener('click', function() {
      this.classList.toggle('collapsed');
      const body = this.nextElementSibling;
      if (body) body.classList.toggle('collapsed');
    });
  });
})();
</script>

</body>
</html>`;
}

export function writeDashboardHtmlFile(dr: DashboardReport, filePath: string): void {
  writeFileSync(filePath, writeDashboardHtml(dr), 'utf-8');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

// ---------------------------------------------------------------------------
// Team view — git blame, top flops, regressions
// ---------------------------------------------------------------------------

interface DevEntry {
  name: string;
  issues: number;
  errors: number;
  warnings: number;
  topOffense: string;
  color: string;
}

const DEV_COLORS = ['#e53e3e', '#dd6b20', '#3182ce', '#38a169', '#805ad5', '#d53f8c', '#00b5d8', '#2b6cb0'];

function renderTeamView(dr: DashboardReport): string {
  const projects = [...dr.projects].filter(p => p.report);
  if (projects.length === 0) return '';

  // Git blame cache: file path -> author name
  const blameCache = new Map<string, string | null>();
  function getBlameAuthor(projectPath: string, filePath: string): string | null {
    const key = `${projectPath}:${filePath}`;
    if (blameCache.has(key)) return blameCache.get(key) ?? null;
    try {
      const fullPath = filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
      if (!existsSync(fullPath)) { blameCache.set(key, null); return null; }
      const out = execSync(`git -C "${projectPath}" ls-files --error-unmatch "${filePath}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
      if (!out.trim()) { blameCache.set(key, null); return null; }
      const blame = execSync(`git -C "${projectPath}" blame -p -L 1,+1 "${filePath}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
      const authorMatch = blame.match(/^author (.+)$/m);
      const author = authorMatch ? authorMatch[1].trim() : null;
      blameCache.set(key, author);
      return author;
    } catch {
      blameCache.set(key, null);
      return null;
    }
  }

  // Collect all issues with developers
  const devMap = new Map<string, DevEntry>();
  const allIssues: Array<{ project: string; dev: string | null; severity: string; level: string; message: string }> = [];

  for (const p of projects) {
    const report = p.report!;
    for (const [, tool] of Object.entries(report.tools)) {
      for (const issue of tool.issues) {
        let dev: string | null = null;
        if (issue.file) {
          dev = getBlameAuthor(p.path, issue.file);
        }
        allIssues.push({ project: p.name, dev, severity: issue.severity, level: issue.level, message: issue.message });

        if (dev) {
          let entry = devMap.get(dev);
          if (!entry) {
            entry = { name: dev, issues: 0, errors: 0, warnings: 0, topOffense: '', color: DEV_COLORS[devMap.size % DEV_COLORS.length] };
            devMap.set(dev, entry);
          }
          entry.issues++;
          if (issue.level === 'error') entry.errors++;
          else if (issue.level === 'warning') entry.warnings++;
          if (issue.severity === 'critical' || issue.severity === 'high') {
            entry.topOffense = issue.message.length > 50 ? issue.message.slice(0, 47) + '...' : issue.message;
          }
        }
      }
    }
  }

  const devRows = [...devMap.entries()]
    .sort((a, b) => b[1].issues - a[1].issues)
    .slice(0, 20);

  // Top flops: worst health score first
  const withScore = projects
    .filter(p => p.report?.healthScore)
    .map(p => ({ name: p.name, health: p.report!.healthScore!.total, issues: p.report!.summary.total }));
  const topFlops = [...withScore].sort((a, b) => a.health - b.health).slice(0, 6);

  // Regressions: projects where health score < 12
  const regressed = projects.filter(p => {
    const hs = p.report?.healthScore;
    return hs && hs.total < 12;
  });

  const sections: string[] = [];

  // Top Flops
  if (topFlops.length > 0) {
    const cards = topFlops.map(p => {
      const pct = p.health / 20;
      const healthColor = pct >= 0.8 ? '#38a169' : pct >= 0.6 ? '#dd6b20' : '#e53e3e';
      const cssClass = p.health >= 16 ? 'best' : p.health < 12 ? 'worst' : '';
      return `<div class="topflop-card ${cssClass}">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="health" style="color:${healthColor}">${p.health}/20</div>
        <div class="issues">${p.issues} issues</div>
      </div>`;
    }).join('');
    sections.push(`<div class="team-section">
      <h2>Top Flops</h2>
      <div class="body">
        <div style="font-size:13px;color:#718096;margin-bottom:8px;">Projects ranked by worst health score</div>
        <div class="topflop-grid">${cards}</div>
      </div>
    </div>`);
  }

  // By Developer
  if (devRows.length > 0) {
    const trs = devRows.map(([name, dev]) => {
      const initial = name.charAt(0).toUpperCase();
      const offenseHtml = dev.topOffense ? `<span style="color:#718096;font-size:11px;">${escapeHtml(dev.topOffense)}</span>` : '<span style="color:#a0aec0;">—</span>';
      return `<tr>
        <td><span class="dev-badge" style="background:${dev.color}">${initial}</span>${escapeHtml(name)}</td>
        <td><strong>${dev.issues}</strong></td>
        <td style="color:#e53e3e;">${dev.errors}</td>
        <td style="color:#dd6b20;">${dev.warnings}</td>
        <td>${offenseHtml}</td>
      </tr>`;
    }).join('');
    sections.push(`<div class="team-section">
      <h2>By Developer <span style="font-weight:400;font-size:13px;color:#718096;">(${devMap.size} developers)</span></h2>
      <div class="body" style="overflow-x:auto;">
        <table class="team-table">
          <thead><tr>
            <th>Developer</th><th>Issues</th><th>Errors</th><th>Warnings</th><th>Top Offense</th>
          </tr></thead>
          <tbody>${trs}</tbody>
        </table>
        <div style="font-size:11px;color:#a0aec0;margin-top:8px;">* Git blame data for file-level issues only. Issues without file attribution are excluded.</div>
      </div>
    </div>`);
  }

  // Regressions
  if (regressed.length > 0) {
    const items = regressed.map(p => {
      const hs = p.report!.healthScore!;
      return `<div style="padding:8px 0;border-bottom:1px solid #f7fafc;display:flex;gap:12px;align-items:center;">
        <span class="regression-badge">&#x2198; ${hs.total}/20</span>
        <span style="font-weight:600;">${escapeHtml(p.name)}</span>
        <span style="font-size:12px;color:#718096;">${p.report!.summary.errors} errors, ${p.report!.summary.warnings} warnings</span>
      </div>`;
    }).join('');
    sections.push(`<div class="team-section">
      <h2>Regressions <span style="font-weight:400;font-size:13px;color:#e53e3e;">(${regressed.length} projects below threshold)</span></h2>
      <div class="body">${items}</div>
    </div>`);
  }

  return sections.join('\n');
}

function renderProjectCard(entry: DashboardProjectEntry): string {
  const isError = entry.status === 'error';
  const cardClass = isError ? 'project-card error' : 'project-card';
  const report = entry.report;
  const hs = report?.healthScore;

  // Health circle
  let healthHtml = '';
  if (hs) {
    const pct = hs.max > 0 ? hs.total / hs.max : 0;
    const circleClass = pct >= 0.8 ? 'good' : pct >= 0.6 ? 'ok' : 'bad';
    healthHtml = `<div class="health-circle ${circleClass}">${hs.total}</div>`;
  } else {
    healthHtml = `<div class="health-circle na">—</div>`;
  }

  // Status badge
  let statusBadge = '';
  if (isError) {
    statusBadge = `<span class="status-badge err">✗ Error</span>`;
  } else {
    const errors = report?.summary.errors ?? 0;
    if (errors > 0) {
      statusBadge = `<span class="status-badge warn">⚠ ${errors} error${errors !== 1 ? 's' : ''}</span>`;
    } else {
      statusBadge = `<span class="status-badge ok">✓ OK</span>`;
    }
  }

  // Severity bar
  let sevBarRow = '';
  let statsHtml = '';
  if (report) {
    const sevOrder: Severity[] = ['critical', 'high', 'medium', 'low'];
    const total = sevOrder.reduce((s, sev) => s + (report.summary.bySeverity[sev] ?? 0), 0);
    if (total > 0) {
      sevBarRow = `<div class="sev-bar-row">` +
        sevOrder.map(sev => {
          const count = report.summary.bySeverity[sev] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return count > 0
            ? `<div class="sev-bar bg-${sev}" style="flex:${pct}"></div>`
            : '';
        }).filter(Boolean).join('') +
        `</div>`;
    }

    statsHtml = `<div class="project-stats">` +
      sevOrder.map(sev => {
        const count = report.summary.bySeverity[sev] ?? 0;
        return count > 0
          ? `<span class="project-stat"><span class="sev-${sev}"><strong>${count}</strong> ${sev}</span></span>`
          : '';
      }).filter(Boolean).join('') +
      `</div>`;
  }

  // Error detail
  let errorHtml = '';
  if (isError && entry.error) {
    errorHtml = `<div style="color:#e53e3e;font-size:13px;margin-bottom:8px;">✗ ${escapeHtml(entry.error)}</div>`;
  }

  // Tool details (collapsible)
  let toolsHtml = '';
  if (report) {
    const toolEntries = Object.entries(report.tools).filter(([, t]) => t.issues.length > 0 || t.status === 'error' || t.status === 'skipped');
    if (toolEntries.length > 0) {
      toolsHtml = toolEntries.map(([, tool]) => {
        const statusIcon = tool.status === 'success' ? '✓' : tool.status === 'skipped' ? '–' : '✗';
        const header = `<h4>${statusIcon} ${escapeHtml(tool.label)} <span style="font-weight:400;color:#718096;">(${tool.issues.length})</span> <span class="collapse-icon">▼</span></h4>`;

        let body = '';
        if (tool.status === 'skipped' && tool.skipReason) {
          body = `<div class="tool-skip">⤷ ${escapeHtml(tool.skipReason)}</div>`;
        } else if (tool.status === 'error' && tool.errorMessage) {
          body = `<div class="tool-skip" style="color:#e53e3e;">✗ ${escapeHtml(tool.errorMessage)}</div>`;
        } else {
          body = tool.issues.map(issue => {
            const sevTag = `<span class="sev-tag ${issue.severity}">${issue.severity.toUpperCase()}</span>`;
            const loc = issue.file ? `<span style="color:#a0aec0;font-size:11px;">${escapeHtml(issue.file)}${issue.line ? `:${issue.line}` : ''}</span>` : '';
            return `<div class="tool-issue">${sevTag}<span class="issue-msg">${escapeHtml(issue.message)} ${loc}</span></div>`;
          }).join('');
        }

        return `<div class="tool-section">${header}<div class="tool-issues">${body}</div></div>`;
      }).join('');
    }
  }

  return `<div class="${cardClass}">
    <div class="project-header">
      <h2>${escapeHtml(entry.name)}</h2>
      ${statusBadge}
      <span class="collapse-icon">▼</span>
    </div>
    <div class="project-body">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
        ${healthHtml}
        <div style="flex:1;">
          <div style="font-size:13px;color:#718096;">${escapeHtml(entry.path)}</div>
          <div style="font-size:12px;color:#a0aec0;">${formatDuration(entry.durationMs)}</div>
        </div>
      </div>
      ${errorHtml}
      ${sevBarRow}
      ${statsHtml}
      ${toolsHtml}
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&quot;');
}
