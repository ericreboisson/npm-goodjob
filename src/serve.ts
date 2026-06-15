// ---------------------------------------------------------------------------
// npm-goodjob — Web dashboard server (zero dependencies, uses Node http)
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { AuditReport, DashboardReport } from './types.js';
import { getHistoryIndex, loadRunData, saveRun, type HistoryEntry } from './history.js';
import { loadProjects, runDashboard, resolveRemoteProject } from './dashboard.js';
import { loadConfig } from './config.js';
import { GOODJOB_VERSION } from './runner.js';
import { renderHtml } from './reporters/html-reporter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServeOptions {
  port?: number;
  open?: boolean;
  projectPath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function errorResponse(res: ServerResponse, message: string, status = 500): void {
  jsonResponse(res, { error: message }, status);
}

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

function serveHtml(res: ServerResponse, _port: number): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>npm-goodjob Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f172a; color: #e2e8f0; min-height: 100vh;
  }
  nav {
    background: #1e293b; padding: 16px 24px; display: flex; align-items: center;
    justify-content: space-between; border-bottom: 1px solid #334155;
  }
  nav h1 { font-size: 20px; font-weight: 700; }
  nav h1 span { color: #38bdf8; }
  nav .actions { display: flex; gap: 8px; }
  .btn {
    padding: 8px 16px; border: none; border-radius: 6px; font-size: 14px;
    cursor: pointer; font-weight: 600; transition: opacity 0.2s;
  }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-secondary { background: #475569; color: #e2e8f0; }
  .btn-success { background: #16a34a; color: #fff; }
  .btn-danger { background: #dc2626; color: #fff; }

  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }

  .cards { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; margin-bottom: 24px; }
  @media (max-width: 768px) { .cards { grid-template-columns: 1fr; } }

  .card {
    background: #1e293b; border-radius: 12px; padding: 20px;
    border: 1px solid #334155;
  }
  .card h2 { font-size: 14px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
  .card canvas { max-width: 100%; max-height: 250px; }

  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat {
    background: #1e293b; border-radius: 8px; padding: 16px; text-align: center;
    border: 1px solid #334155;
  }
  .stat .value { font-size: 28px; font-weight: 700; }
  .stat .label { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  .stat.critical .value { color: #ef4444; }
  .stat.high .value { color: #f97316; }
  .stat.medium .value { color: #eab308; }
  .stat.low .value { color: #94a3b8; }

  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: #94a3b8; font-weight: 600; padding: 8px 12px; border-bottom: 2px solid #334155; }
  td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
  tr:hover td { background: rgba(56, 189, 248, 0.05); }
  .text-right { text-align: right; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 12px; font-weight: 600;
  }
  .badge-green { background: rgba(22, 163, 74, 0.2); color: #4ade80; }
  .badge-yellow { background: rgba(234, 179, 8, 0.2); color: #facc15; }
  .badge-red { background: rgba(220, 38, 38, 0.2); color: #f87171; }

  /* Loading state */
  .loading { text-align: center; padding: 40px; color: #94a3b8; }
  .loading-row td { text-align: center; padding: 32px; }
  .loading-row .mini-spinner {
    display: inline-block; width: 18px; height: 18px;
    border: 3px solid #334155; border-top: 3px solid #38bdf8;
    border-radius: 50%; animation: spin .8s linear infinite;
    vertical-align: middle; margin-right: 10px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .loading-overlay {
    position: fixed; inset: 0; background: #0f172a; z-index: 9999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    transition: opacity .5s ease;
  }
  .loading-overlay.hidden { opacity: 0; pointer-events: none; }
  .loading-overlay .spinner {
    width: 44px; height: 44px;
    border: 4px solid #334155; border-top: 4px solid #38bdf8;
    border-radius: 50%; animation: spin .8s linear infinite; margin-bottom: 20px;
  }
  .loading-overlay .loading-title { color: #e2e8f0; font-size: 16px; font-weight: 600; margin-bottom: 6px; }
  .loading-overlay .loading-sub { color: #64748b; font-size: 13px; }

  .error-container {
    background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 8px; padding: 16px; margin-bottom: 16px;
  }
  .error-container h3 { color: #f87171; margin-bottom: 4px; }

  #projectsContainer { margin-bottom: 24px; }
  .project-card {
    background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-bottom: 8px;
  }
  .project-header { display: flex; justify-content: space-between; align-items: center; }
  .project-name { font-weight: 700; font-size: 16px; }
  .project-path { font-size: 12px; color: #64748b; }
  .project-stats { display: flex; gap: 16px; margin-top: 8px; }
  .project-stat { font-size: 13px; }
  .project-stat strong { margin-right: 4px; }

  @media print {
    nav .actions { display: none; }
    .btn { display: none; }
    #runBtn { display: none; }
  }
</style>
</head>
<body>
<nav>
  <h1><span>npm-goodjob</span> Dashboard</h1>
  <div class="actions">
    <button class="btn btn-primary" id="runBtn" onclick="runAudit()">Run Audit</button>
    <button class="btn btn-secondary" onclick="window.print()">Export PDF</button>
  </div>
</nav>

<div class="loading-overlay" id="loadingOverlay">
  <div class="spinner"></div>
  <div class="loading-title">Running audit…</div>
  <div class="loading-sub" id="loadingDetail">Initializing tools</div>
</div>

<div class="container">
  <div id="errorContainer" class="error-container" style="display:none">
    <h3 id="errorTitle">Error</h3>
    <p id="errorMessage"></p>
  </div>

  <div class="stats-grid" id="statsGrid">
    <div class="stat"><div class="value" id="statCritical">0</div><div class="label">Critical</div></div>
    <div class="stat"><div class="value" id="statHigh">0</div><div class="label">High</div></div>
    <div class="stat"><div class="value" id="statMedium">0</div><div class="label">Medium</div></div>
    <div class="stat"><div class="value" id="statLow">0</div><div class="label">Low</div></div>
  </div>

  <div class="cards">
    <div class="card">
      <h2>Health Score</h2>
      <canvas id="healthGauge"></canvas>
    </div>
    <div class="card">
      <h2>Health Timeline</h2>
      <canvas id="timelineChart"></canvas>
    </div>
  </div>

  <div id="projectsContainer"></div>

  <div class="card">
    <h2>Run History</h2>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px;">
      Each row is an audit run triggered manually or on server start.
      Click <strong>Run Audit</strong> to trigger a new scan.
      Health score is the flat /20 score.
      The timeline chart above plots health % over time.
    </p>
    <table>
      <thead>
        <tr>
          <th>Age</th>
          <th>Timestamp</th>
          <th>Project</th>
          <th class="text-right">Total</th>
          <th class="text-right" title="Error-level issues (critical & high severity)">Errors</th>
          <th class="text-right">Warnings</th>
          <th class="text-right">Health</th>
        </tr>
      </thead>
      <tbody id="historyBody">
        <tr class="loading-row"><td colspan="7"><span class="mini-spinner"></span>Loading audit results…</td></tr>
      </tbody>
    </table>
  </div>
</div>

<script>
let healthChart = null;
let timelineChart = null;

// Show error
function showError(title, message) {
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorMessage').textContent = message;
  document.getElementById('errorContainer').style.display = 'block';
  setTimeout(() => { document.getElementById('errorContainer').style.display = 'none'; }, 8000);
}

// Fetch helper
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

// Update stats
function updateStats(report) {
  const s = report.summary || {};
  const sev = s.bySeverity || {};
  document.getElementById('statCritical').textContent = sev.critical || 0;
  document.getElementById('statHigh').textContent = sev.high || 0;
  document.getElementById('statMedium').textContent = sev.medium || 0;
  document.getElementById('statLow').textContent = sev.low || 0;
}

// Draw health gauge
function drawHealthGauge(score, max) {
  const ctx = document.getElementById('healthGauge').getContext('2d');
  const pct = max > 0 ? score / max : 0;
  const color = pct >= 0.8 ? '#22c55e' : pct >= 0.6 ? '#eab308' : '#ef4444';

  if (healthChart) { healthChart.destroy(); }

  healthChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pct * 100, 100 - pct * 100],
        backgroundColor: [color, '#334155'],
        borderWidth: 0,
        circumference: 270,
        rotation: 225,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '75%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
    plugins: [{
      id: 'centerText',
      beforeDraw(chart) {
        const { width, height, ctx } = chart;
        ctx.save();
        const cx = width / 2;
        const cy = height / 2 + 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 40px system-ui, -apple-system, sans-serif';
        ctx.fillText(score + '/' + max, cx, cy - 10);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px system-ui, -apple-system, sans-serif';
        ctx.fillText('Health Score', cx, cy + 25);
        ctx.restore();
      },
    }],
  });
}

// Draw timeline
function drawTimeline(history) {
  const ctx = document.getElementById('timelineChart').getContext('2d');

  if (timelineChart) { timelineChart.destroy(); }

  const labels = history.map((r) => {
    const d = new Date(r.timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }).reverse();

  const scores = history.map((r) => {
    if (!r.healthScore) return null;
    const max = r.healthScore.max || 20;
    return max > 0 ? Math.round((r.healthScore.total / max) * 100) : null;
  }).reverse();

  const filteredScores = scores.filter(s => s !== null);

  timelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.slice(-50),
      datasets: [{
        label: 'Health %',
        data: scores.slice(-50),
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#38bdf8',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxTicksLimit: 10 },
          grid: { color: 'rgba(51, 65, 85, 0.5)' },
        },
        y: {
          min: 0,
          max: 100,
          ticks: { color: '#94a3b8', callback: (v) => v + '%' },
          grid: { color: 'rgba(51, 65, 85, 0.5)' },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

// Populate history table
function populateHistory(history) {
  const tbody = document.getElementById('historyBody');
  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No runs yet. Click "Run Audit" to start.</td></tr>';
    return;
  }

  tbody.innerHTML = history.slice(0, 50).map((r) => {
    const d = new Date(r.timestamp);
    const ts = d.toLocaleString();
    const age = relativeTime(d);
    const hs = r.healthScore ? r.healthScore.total + '/' + r.healthScore.max : '--';
    const badge = r.errors > 0 ? 'badge-red' : r.warnings > 0 ? 'badge-yellow' : 'badge-green';
    return '<tr>' +
      '<td style="white-space:nowrap;color:#94a3b8;font-size:12px;">' + age + '</td>' +
      '<td>' + ts + '</td>' +
      '<td title="' + esc(r.projectPath) + '" style="cursor:help;">' + esc(r.projectName) + '</td>' +
      '<td class="text-right">' + r.total + '</td>' +
      '<td class="text-right"><span class="badge ' + badge + '">' + r.errors + '</span></td>' +
      '<td class="text-right">' + r.warnings + '</td>' +
      '<td class="text-right">' + hs + '</td>' +
      '</tr>';
  }).join('');
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + 'd ago';
  const mo = Math.floor(day / 30);
  if (mo < 12) return mo + 'mo ago';
  return Math.floor(day / 365) + 'y ago';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// Update projects multi-project view
function updateProjects(projects) {
  const container = document.getElementById('projectsContainer');
  if (!projects || projects.length === 0) {
    container.innerHTML = '';
    return;
  }

  const errors = projects.filter(p => p.status === 'error');

  container.innerHTML = '<div class="card"><h2>Projects</h2>';
  projects.forEach((p, idx) => {
    const cls = p.status === 'error' ? 'badge-red' : 'badge-green';
    const label = p.status === 'error' ? 'ERROR' : 'OK';
    container.innerHTML += '<div class="project-card">' +
      '<div class="project-header">' +
        '<div><div class="project-name">' + esc(p.name) + '</div><div class="project-path">' + esc(p.path) + '</div></div>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          (p.report ? '<a href="/report/' + idx + '" target="_blank" class="btn btn-secondary" style="font-size:11px;padding:4px 10px;text-decoration:none;">📄 Full Report</a>' : '') +
          '<span class="badge ' + cls + '">' + label + '</span>' +
        '</div>' +
      '</div>';
    if (p.status === 'error') {
      container.innerHTML += '<div style="color:#f87171;margin-top:8px;font-size:13px">' + esc(p.error || 'Unknown error') + '</div>';
    } else if (p.report) {
      container.innerHTML += '<div class="project-stats">' +
        '<div class="project-stat"><strong style="color:#ef4444">' + (p.report.summary.bySeverity?.critical || 0) + '</strong>critical</div>' +
        '<div class="project-stat"><strong style="color:#f97316">' + (p.report.summary.bySeverity?.high || 0) + '</strong>high</div>' +
        '<div class="project-stat"><strong style="color:#eab308">' + (p.report.summary.bySeverity?.medium || 0) + '</strong>medium</div>' +
        '<div class="project-stat"><strong style="color:#94a3b8">' + (p.report.summary.bySeverity?.low || 0) + '</strong>low</div>' +
        (p.report.healthScore ? '<div class="project-stat"><strong style="color:#38bdf8">' + p.report.healthScore.total + '/' + p.report.healthScore.max + '</strong>health</div>' : '') +
      '</div>';
    }
    container.innerHTML += '</div>';
  });
  container.innerHTML += '</div>';
}

// Main refresh
function showLoadingOverlay(detail) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    document.getElementById('loadingDetail').textContent = detail || 'Initializing tools';
  }
}
function hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.add('hidden');
}

async function refreshDashboard() {
  try {
    const data = await api('/api/dashboard');
    const dr = data.dashboard;

    if (!dr) {
      // Audit still running (initial refresh not complete), retry in 2s
      showLoadingOverlay('Audit in progress, please wait…');
      setTimeout(refreshDashboard, 2000);
      return;
    }
    hideLoadingOverlay();

    if (dr.summary) {
      updateStats(dr);
    }

    const historyRes = await api('/api/history');
    populateHistory(historyRes.runs || []);

    // Use latest report for health gauge
    if (historyRes.runs && historyRes.runs.length > 0) {
      const latest = historyRes.runs[0];
      if (latest.healthScore) {
        drawHealthGauge(latest.healthScore.total, latest.healthScore.max);
      }
      drawTimeline(historyRes.runs);
    } else {
      drawHealthGauge(0, 20);
    }

    updateProjects(dr.projects || []);
  } catch (err) {
    hideLoadingOverlay();
    showError('Failed to load dashboard', err.message);
  }
}

// Run audit
async function runAudit() {
  showLoadingOverlay('Running audit…');
  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  btn.textContent = 'Running...';
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-success');

  try {
    await api('/api/run', { method: 'POST' });
    await refreshDashboard();
  } catch (err) {
    showError('Audit failed', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Audit';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-primary');
  }
}

// Init
refreshDashboard();
setInterval(refreshDashboard, 30000); // auto-refresh every 30s
</script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

function parseUrl(req: IncomingMessage): { pathname: string; searchParams: URLSearchParams } {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return { pathname: url.pathname, searchParams: url.searchParams };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let serverInstance: ReturnType<typeof createServer> | null = null;

export function stopServer(): void {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

// Find the run immediately before the given timestamp for this project
function findPreviousRun(projectPath: string, currentTimestamp: string): AuditReport | null {
  try {
    const idx = getHistoryIndex(projectPath);
    const curIdx = idx.runs.findIndex(r => r.timestamp === currentTimestamp);
    if (curIdx < 0 || curIdx + 1 >= idx.runs.length) return null;
    return loadRunData(projectPath, idx.runs[curIdx + 1].id);
  } catch { return null; }
}

// Stable signature for deduplicating issues across runs
function issueSignature(iss: { cve?: string; package?: string; fixVersion?: string; version?: string; file?: string; line?: number; message: string }): string {
  return iss.cve || (iss.package + '|' + (iss.fixVersion || iss.version || '')) || (iss.file + '|' + (iss.line || '') + '|' + iss.message);
}

export async function startServer(options: ServeOptions = {}): Promise<void> {
  const port = options.port ?? 3333;
  const projectPath = options.projectPath ?? resolve(process.cwd());

  // Load config + projects
  const config = loadConfig(projectPath);
  let projects = loadProjects(config, projectPath);

  if (projects.length === 0) {
    try {
      const entries = readdirSync(projectPath);
      for (const entry of entries) {
        const fullPath = join(projectPath, entry);
        if (statSync(fullPath).isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
          if (existsSync(join(fullPath, 'package.json'))) {
            projects.push({ name: entry, path: fullPath });
          }
        }
      }
    } catch { /* ok */ }
    if (projects.length === 0) {
      const dirName = projectPath.split(/[/\\]/).pop() ?? 'project';
      projects = [{ name: dirName, path: projectPath }];
    }
  }

  // Resolve remote projects (clone GitHub repos into local cache)
  projects = projects.map((p) => resolveRemoteProject(p, projectPath));

  // Cached latest dashboard report
  let latestDashboard: DashboardReport | null = null;
  let latestError: string | null = null;
  let refreshing = false;

  async function refreshDashboardData(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    const auditStart = Date.now();
    const names = projects.map((p) => p.name).join(', ');
    console.error(`  \u{23F3} Running audit for ${projects.length} project(s): ${names}...`);
    try {
      latestError = null;
      latestDashboard = await runDashboard(projects, { toolTimeoutMs: 180_000 });
      for (const entry of latestDashboard.projects) {
        if (entry.report) {
          saveRun(entry.report, entry.path);
          const hs = entry.report.healthScore
            ? `${entry.report.healthScore.total}/${entry.report.healthScore.max}`
            : '--';
          console.error(`  \u{2705} ${entry.name}: ${entry.report.summary.total} issues (${entry.report.summary.errors} errors) — health ${hs} (${Math.round((Date.now() - auditStart) / 1000)}s)`);
        } else if (entry.status === 'error') {
          console.error(`  \u{274C} ${entry.name}: ERROR — ${entry.error}`);
        }
      }
    } catch (err) {
      latestError = err instanceof Error ? err.message : String(err);
      console.error(`  \u{274C} Audit failed: ${latestError}`);
    } finally {
      refreshing = false;
    }
  }

  serverInstance = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = parseUrl(req);
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      // CORS preflight
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      // API routes
      if (pathname === '/api/status') {
        jsonResponse(res, {
          status: 'ok',
          version: GOODJOB_VERSION,
          uptime: process.uptime(),
          projectPath,
          projects: projects.map((p) => ({ name: p.name, path: p.path })),
        });
        return;
      }

      if (pathname === '/api/history') {
        const allHistory: HistoryEntry[] = [];
        for (const p of projects) {
          const pHistory = getHistoryIndex(p.path);
          allHistory.push(...pHistory.runs);
        }
        // Sort by timestamp descending (newest first)
        allHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        jsonResponse(res, { runs: allHistory.slice(0, 100) });
        return;
      }

      if (pathname === '/api/run' && method === 'POST') {
        while (refreshing) {
          await new Promise((r) => setTimeout(r, 200));
        }
        await refreshDashboardData();
        jsonResponse(res, {
          success: true,
          dashboard: latestDashboard,
        });
        return;
      }

      if (pathname === '/api/dashboard') {
        if (!latestDashboard && !latestError && !refreshing) {
          refreshDashboardData().catch(() => {});
        }
        jsonResponse(res, {
          dashboard: latestDashboard,
          error: latestError,
        });
        return;
      }

      if (pathname.startsWith('/api/history/')) {
        const id = pathname.replace('/api/history/', '');
        for (const p of projects) {
          const report = loadRunData(p.path, id);
          if (report) {
            jsonResponse(res, report);
            return;
          }
        }
        errorResponse(res, 'Run not found', 404);
        return;
      }

      const reportMatch = pathname.match(/^\/report\/(\d+)$/);
      if (reportMatch) {
        const idx = parseInt(reportMatch[1], 10);
        if (latestDashboard && idx >= 0 && idx < latestDashboard.projects.length) {
          const entry = latestDashboard.projects[idx];
          if (entry.report) {
            // Flag regressions: compare with previous run for this project
            const prevRun = findPreviousRun(entry.path, entry.report.metadata.timestamp);
            if (prevRun) {
              const prevSignatures = new Set();
              for (const t of Object.values(prevRun.tools)) {
                for (const iss of t.issues) {
                  prevSignatures.add(issueSignature(iss));
                }
              }
              for (const t of Object.values(entry.report.tools)) {
                for (const iss of t.issues) {
                  if (!prevSignatures.has(issueSignature(iss))) {
                    (iss as any).isNew = true;
                  }
                }
              }
            }
            const html = renderHtml(entry.report);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }
        }
        errorResponse(res, 'Report not found', 404);
        return;
      }

      if (pathname === '/' || pathname === '/dashboard') {
        serveHtml(res, port);
        return;
      }

      errorResponse(res, 'Not found', 404);
    } catch (err) {
      errorResponse(res, err instanceof Error ? err.message : String(err));
    }
  });

  refreshDashboardData().catch(() => {});

  return new Promise<void>((resolvePromise) => {
    serverInstance!.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.error(`\n  \u{1F4CA} npm-goodjob Dashboard server running at ${url}\n`);

      if (options.open) {
        const cmd = process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
        const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
        child.unref();
        console.error(`  Browser opened: ${url}\n`);
      }

      console.error(`  Press Ctrl+C to stop the server.\n`);
      resolvePromise();
    });
  });
}
