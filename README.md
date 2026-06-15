# npm-goodjob

[![CI](https://github.com/ericreboisson/npm-goodjob/actions/workflows/ci.yml/badge.svg)](https://github.com/ericreboisson/npm-goodjob/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/npm-goodjob.svg)](https://www.npmjs.com/package/npm-goodjob)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-025e8c)](https://github.com/ericreboisson/npm-goodjob/network/updates)

**Unified npm project audit aggregator** — run 17 audit tools with one command, get one report with health score, policy enforcement, SBOM, SARIF, baseline diff, web dashboard, and interactive TUI.

```bash
npx npm-goodjob . --html-output audit.html
```

---

## Features

| Capability | Description |
|---|---|---|
| **17 built-in tools** | npm-audit, npm-outdated, depcheck, ts-prune, ESLint, dependency-cruiser, dependency-check, license-check, lockfile-analysis, secret-scanning, **Snyk**, **Socket.dev**, **AuditJS**, **npm-signatures**, **pkg-lint**, **architect**, **knip** |
| **6 output formats** | Console (colorized), JSON, HTML, SARIF 2.1.0, **Dashboard HTML**, **Web Dashboard Server** |
| **Auto-fix** | `--fix` auto-fixes npm audit vulnerabilities, updates outdated deps, fixes package.json issues, dedupes lockfile |
| **Monorepo support** | Automatic npm/yarn/pnpm workspace detection — audits root + all packages in one command |
| **Dependency drift** | Built-in lockfile analysis detects mismatches between package.json and package-lock.json |
| **Issue exclusions** | Configure per-project exclusions to suppress known false positives |
| **Multi-project dashboard** | Architect oversight — run audits across all projects in one shot |
| **Health score** | /20 composite score: security, dependencies, code quality, project health |
| **Severity-weighted score** | Penalty model (critical=-3, high=-2, medium=-1, low=-0.5) with `--strict` enforcement |
| **Policy as Code** | Expression-based rules (`severity.critical > 0`) with error/warning levels |
| **SBOM (SPDX 2.3)** | Software Bill of Materials with PURLs, licenses — CRA compliant |
| **Baseline + Diff** | Store a snapshot, diff against future runs, detect regressions and new CVEs |
| **Trend tracking** | Auto-saved run history in `.goodjob-data/history/`, `baseline trend` for health evolution |
| **Team dashboard** | Per-developer git blame, top flops ranking, regressions view in HTML dashboard |
| **Fast mode** | `--fast` runs only 6 built-in tools — ideal for pre-commit or quick health checks |
| **Dry-run mode** | `--dry-run` replays recorded snapshots without real tool execution — CI without network |
| **Interactive TUI** | Keyboard-navigable issue browser (`npx npm-goodjob tui`) |
| **Pre-commit hook** | Fast checks (secret-scanning + lockfile-analysis) before every commit |
| **PR/MR comments** | Auto-post health summary to GitHub/GitLab PRs |
| **Framework detection** | Auto-detects Angular, React, Node.js projects |
| **CI templates** | GitHub Actions + GitLab CI with SARIF upload and baseline |
| **Zero-effort skip** | Gracefully skips uninstalled tools — no config needed |
| **Extensible** | `registerTool()` API for custom runners |

---

## Quick start

```bash
# Run full audit (auto-detects all installed tools)
npx npm-goodjob .

# Generate HTML report
npx npm-goodjob . --html-output audit.html

# Output JSON
npx npm-goodjob . --json

# Generate SARIF for GitHub Code Scanning
npx npm-goodjob . --sarif-output results.sarif

# Generate SPDX SBOM
npx npm-goodjob . --sbom-output sbom.json
```

---

## Installation

### Via npx (no install needed)

```bash
npx npm-goodjob .
```

### Global install

```bash
npm install -g npm-goodjob
npm-goodjob .
```

### Local dev dependency

```bash
npm install --save-dev npm-goodjob
npx npm-goodjob .
```

---

## Built-in tools

| Tool | Name | Category | Activated when | Runs via |
|---|---|---|---|---|
| npm audit | `npm-audit` | Security | `npm` available | `npm audit --json` |
| npm outdated | `npm-outdated` | Dependencies | `npm` available | `npm outdated --json` |
| npm audit signatures | `npm-signatures` | Security | `npm` + lockfile | `npm audit signatures --json` |
| Snyk | `snyk` | Security | `snyk` in PATH or npx | `snyk test --json` |
| Socket.dev | `socket` | Security | `socket` in PATH or npx | npx @socketsecurity/cli scan --json |
| AuditJS | `auditjs` | Security | `auditjs` in PATH or npx | `auditjs ossi --json` |
| depcheck | `depcheck` | Dependencies | `depcheck` in node_modules | npx --yes depcheck |
| ts-prune | `ts-prune` | Dead code | `ts-prune` in PATH + tsconfig.json | npx ts-prune |
| ESLint | `eslint` | Code quality | `eslint` in PATH + config file | npx eslint |
| dependency-cruiser | `depcruise` | Architecture | `depcruise` in PATH | npx depcruise |
| dependency-check | `dependency-check` | Configuration | Always (built-in) | Internal |
| license-check | `license-check` | License | Always (built-in) | Internal |
| lockfile-analysis | `lockfile-analysis` | Dependencies | Always (built-in) | Internal |
| secret-scanning | `secret-scanning` | Security | Always (built-in) | Internal |
| pkg-lint | `pkg-lint` | Configuration | Always (built-in) | Internal |
| architect | `architect` | Architecture | Always (built-in) | Internal |
| knip | `knip` | Dead code | `knip` in PATH + tsconfig.json | npx knip |

> **Zero-config**: tools not installed are silently skipped. Add `--verbose` to see skip reasons.
>
> **No results is normal**: many tools report 0 issues on well-maintained projects. dependency-cruiser (no circular deps), Socket.dev (requires API key), and AuditJS (requires OSS Index account) may show "(via npx)" with 0 results if the CLI is not configured — this is expected. Install the CLI + authenticate for full results.

---

## CLI reference

### Flags

| Flag | Description |
|---|---|---|
| `[project-path]` | Project to audit (default: `.`) |
| `-t, --tools <tools...>` | Run only these tools (`--tools npm-audit eslint`) |
| `-s, --skip <tools...>` | Skip these tools (`--skip ts-prune depcruise`) |
| `-j, --json` | Output JSON to stdout |
| `-o, --output <file>` | Write JSON report to file |
| `--html` | Output HTML to stdout |
| `--html-output <file>` | Write HTML report to file |
| `--sarif` | Output SARIF 2.1.0 to stdout |
| `--sarif-output <file>` | Write SARIF to file (GitHub Code Scanning / GitLab SAST) |
| `--sbom` | Output SPDX 2.3 SBOM to stdout |
| `--sbom-output <file>` | Write SPDX 2.3 SBOM to file |
| `-v, --verbose` | Show raw tool output and skip reasons |
| `--fix` | Auto-fix fixable issues (npm audit fix, npm update, package.json fixes, lockfile dedupe) |
| `--timeout <ms>` | Per-tool timeout (default: 120000) |
| `--fast` | Built-in tools only (architect, secret-scanning, lockfile-analysis, dependency-check, license-check, pkg-lint) — no npx, no network |
| `--strict` | Exit code 1 if severity-weighted health score < 15 (configurable in `.goodjobrc`) |
| `--dry-run` | Load tool results from pre-recorded snapshots — no real tool execution |
| `--record` | Run real tools and save results as snapshots for future `--dry-run` |

### Subcommands

| Command | Description |
|---|---|
| `init [path]` | Scaffold `.goodjobrc` for a project (detects Angular/React/Node) |
| `init [path] --ci` | Same + create GitHub Actions + GitLab CI workflows |
| `clean [path]` | Remove `.goodjob-data/` (history, runs, snapshots) + `.goodjob-cache/` |
| `clean [path] --all` | Same + remove `.goodjobrc` configuration file |
| `baseline store [path] [--file]` | Store current audit as baseline snapshot |
| `baseline diff [path] [--file]` | Diff current audit against stored baseline (includes CVE detection, category regressions, trend) |
| `baseline trend [path]` | Show health score trend from auto-saved run history |
| `pre-commit install` | Install git pre-commit hook (secret-scanning + lockfile) |
| `pre-commit` | Run pre-commit checks manually |
| `pr-comment [path]` | Generate + post PR comment to GitHub/GitLab |
| `dashboard [options]` | Multi-project dashboard — run audits across all configured projects |
| `serve [options]` | Start web dashboard server with live audit and history timeline |
| `tui [path]` | Interactive terminal UI (arrow keys, Enter for details) |

---

## Auto-fix (`--fix`)

The `--fix` flag runs an automated fix engine after the audit completes. It can resolve common issues automatically:

| Fixer | What it fixes |
|---|---|
| **npm audit fix** | Fixes known vulnerabilities (safe fixes only — semver-compatible updates) |
| **npm update** | Updates outdated packages within semver range |
| **package.json** | Adds missing `engines.node`, removes duplicate deps (same dep in both `dependencies` and `devDependencies`), sets `private: true` for workspace roots |
| **Lockfile** | Regenerates missing `package-lock.json`, runs `npm dedupe` to remove duplicates |
| **Config files** | Converts JSONC to valid JSON for `tsconfig.json` (strips comments, trailing commas) |

```bash
npx npm-goodjob . --fix
```

Output includes a fix results section:
```
  ── Fix Results ──────────────────────────
  ✓ npm audit fix: fixed 3 of 5 vulnerabilities
  ✓ npm update: completed (deps updated within semver range)
  ✓ package.json: Added "engines.node": ">=20"
  ✓ lockfile: npm dedupe completed
  ──────────────────────────────────────────
```

### Monorepo support

npm-goodjob auto-detects npm/yarn/pnpm workspaces from `package.json workspaces` or `pnpm-workspace.yaml`. When a monorepo is detected, it audits the root + all workspace packages in a single command:

```bash
npx npm-goodjob .
```

Output includes a monorepo summary showing per-package results:
```
  Monorepo: 4 packages audited
  Packages: (root) (12 issues), app (5 issues), lib (0 issues), shared (8 issues)
```

Workspace package results are prefixed with the package name (e.g. `app/npm-audit`, `shared/eslint`).

### Dependency drift detection

The built-in `dependency-check` tool compares dependency versions declared in `package.json` against their resolved versions in `package-lock.json`. It detects:

- **Missing dependencies**: dep declared in `package.json` but absent from lockfile (merge conflict residue)
- **Version mismatches**: exact version in `package.json` doesn't match lockfile (e.g. `"lodash": "4.17.21"` but lockfile has `4.17.20`)

This check runs automatically as part of every audit — no config needed.

## Output formats

### Console (default)

Colorized terminal output with per-tool sections, severity-colored issues, and health gauge:

```
╔══════════════════════════════════════════════════╗
║         npm-goodjob — Audit Report              ║
╚══════════════════════════════════════════════════╝

  Project: my-app  Path: /Users/me/my-app  Duration: 3.2s
  Health: 14/20 ████████████░░░░░░ 70%

  Results: 12 issues · 1 error · 4 warnings · 7 info

  ✓ npm audit v10.8.2 (2)
    ERROR CRITIC  lodash: Prototype Pollution → fix to 4.17.21
    WARN  HIGH   axios: Server-Side Request Forgery

  ✓ ESLint v8.57.0 (3)
    WARN  MEDIUM no-eval: eval can be harmful
```

### JSON

Full structured data for CI pipelines and custom tooling. Fields: `summary`, `tools`, `metadata`, `healthScore`.

```bash
npx npm-goodjob . --json | jq '.summary'
```

### HTML

Standalone HTML report with health circle chart, **SVG donut chart** (severity breakdown), **SVG bar chart** (category breakdown), severity-weighted score, and per-tool expandable issue lists. Generated via `--html-output`.

### SARIF 2.1.0

Standard format for GitHub Code Scanning and GitLab SAST. CVEs mapped to SARIF `relatedLocations` with fingerprints.

```bash
npx npm-goodjob . --sarif-output results.sarif
```

---

## Health score

Two scores are computed for every audit:

### Flat score (/20)

Composite /20 score calculated from four dimensions (5 points each):

| Dimension | Default weight | Sources |
|---|---|---|
| Security | /5 | npm audit, secret-scanning, Snyk, Socket.dev, AuditJS, npm-signatures |
| Dependencies | /5 | npm outdated, depcheck, lockfile-analysis |
| Code quality | /5 | ESLint, ts-prune, dependency-cruiser |
| Project health | /5 | dependency-check, license-check, config validation |

### Severity-weighted score (/20)

Penalty model that accounts for issue severity: starts at 20, subtracts penalties per issue, floored at 0.

| Severity | Penalty |
|---|---|
| Critical | -3 points |
| High | -2 points |
| Medium | -1 point |
| Low | -0.5 point |

Example: a report with 3 critical + 2 high issues → `20 - (3×3 + 2×2) = 20 - 13 = 7/20`.

The weighted score and top 5 penalties appear in both console and HTML output.

### Strict mode (`--strict`)

Exit code 1 if the severity-weighted score falls below a threshold (default: 15/20). Useful for CI gates:

```bash
npx npm-goodjob . --strict        # exit 1 if weighted score < 15
npx npm-goodjob . --strict --fast # quick CI gate, built-in tools only
```

### Configuration

Configurable via `.goodjobrc`:

```json
{
  "healthScore": {
    "weights": { "security": 8, "dependencies": 4, "codeQuality": 4, "projectHealth": 4 },
    "thresholds": {
      "good": 18,
      "warning": 14,
      "strict": 15
    }
  }
}
```

The `strict` threshold is only used by `--strict`. The `good` and `warning` thresholds control display coloring only.

---

## Policy as Code

Define rules that fail (exit 1) or warn when conditions are breached. Rules use the format `<field> <operator> <value>`.

### Supported fields

| Field | Type | Example |
|---|---|---|
| `health` | number (0-20) | `health < 14` |
| `severity.critical` | number | `severity.critical > 0` |
| `severity.high` | number | `severity.high > 5` |
| `severity.medium` | number | `severity.medium > 10` |
| `total` | number | `total > 50` |
| `<tool-name>.*` | number | `npm-audit.critical > 3` |
| `<tool-name>.count` | number | `eslint.count > 20` |

### Example `.goodjobrc`

```json
{
  "policy": {
    "error": [
      { "rule": "severity.critical > 0", "description": "No critical issues allowed" },
      { "rule": "health < 12", "description": "Minimum health score" }
    ],
    "warning": [
      { "rule": "severity.high > 5", "description": "Too many high-severity issues" },
      { "rule": "npm-audit.critical > 0", "description": "Critical npm advisories" }
    ]
  }
}
```

Policy violations appear as a `policy` meta-tool in reports, affecting exit code and summary counts.

---

## SBOM (SPDX 2.3)

Generate a Software Bill of Materials compliant with EU Cyber Resilience Act and US Executive Order 14028:

```bash
npx npm-goodjob . --sbom-output sbom.json
```

Output is SPDX 2.3 JSON with:
- Package names, versions, suppliers
- PURL package URLs
- License info from `license-check`
- `SPDXRef-Package` relationships
- Relationship to the root package
- `creationInfo` with tool name and timestamp

---

## Baseline & Diff

Track audit results over time. Detect regressions before they reach production.

```bash
# Store baseline after a clean audit
npx npm-goodjob baseline store . --file project-baseline.json

# Compare current state against baseline
npx npm-goodjob baseline diff . --file project-baseline.json
```

Diff output shows:
- **Health change**: `14/20 → 12/20 (▼ -2)`
- **Severity changes**: `4 → 5 critical (▲ +1)`
- **Tool changes**: new tools, tool errors, issue counts
- **New CVEs**: CVEs present in current run but absent from baseline
- **Category regressions**: per-category issue increase (e.g. `security: +3`)
- **Trend sparkline**: weighted score evolution over last 10 runs: `15 → 16 → 14 → 17`
- **New issues**: first occurrence since baseline

### Auto-saved run history

Every audit is automatically saved to `.goodjob-data/history/` (last 30 runs kept).

```bash
# Show trend from auto-saved history
npx npm-goodjob baseline trend .

# Example output:
#   2026-06-14 12:30  15/20  42 issues
#   2026-06-14 12:35  17/20  38 issues
#   2026-06-14 12:40  16/20  41 issues
#   Direction: ↗ +1
```

---

## Multi-Project Dashboard

Oversee quality across all your projects at once — run audits on every configured project and get a unified view.

```bash
npx npm-goodjob dashboard
```

### Configuration

Add a `projects` array to your `.goodjobrc`:

```json
{
  "projects": [
    { "name": "App Front Office", "path": "../angular-sandbox" },
    { "name": "Back Office",      "path": "../react-backoffice" },
    { "name": "Auth Service",     "path": "/absolute/path/to/auth" }
  ]
}
```

Relative paths are resolved from the `.goodjobrc` location.

### Output

**Console** — table with project name, health score, issue count, and status:

```
┌──────────────────┬───────┬────────┬──────────┐
│ Project          │ Health│ Issues │ Status   │
├──────────────────┼───────┼────────┼──────────┤
│ Auth Service     │ 12/20 │   47   │ ⚠ 5 err  │
│ App Front Office │ 16/20 │   23   │ ✓ OK     │
│ Back Office      │ 18/20 │    5   │ ✓ OK     │
└──────────────────┴───────┴────────┴──────────┘
```

Sorted by worst health first. Failed projects (no `package.json`, audit crash) shown at the top with `✗ ERROR`.

**HTML** — responsive dashboard with project cards, health circles, severity bars, collapsible drill-down per project, and a **Team** tab:

| Team view section | Description |
|---|---|
| **Git blame** | Top 10 developers by total issue weight (severity × count) |
| **Top flops** | Worst offending files ranked by aggregated severity score |
| **By developer** | Full issue list grouped by committer from git blame |
| **Regressions** | Issues that appeared or worsened since the last recorded audit |

```bash
npx npm-goodjob dashboard --html-output dashboard.html
```

### Options

| Flag | Description |
|---|---|
| `--html-output <file>` | Write HTML dashboard to file |
| `--timeout <ms>` | Per-project tool timeout (default: 180000) |

---

## Web Dashboard Server

Start a persistent web dashboard with audit history timeline, health gauge, multi-project overview, and auto-refresh:

```bash
npx npm-goodjob serve --port 3333 --open
```

The dashboard server:
- Runs the full audit on startup and stores results in `.goodjob-data/history/`
- Shows a **health gauge** (circular Chart.js doughnut) with current score
- **Timeline chart** — health score trend over time (last 50 runs)
- **Run history table** — click "Run Audit" to trigger a new audit on demand
- **Multi-project view** — when configured with the `projects` array in `.goodjob-data/`, shows all projects
- **Auto-refresh** every 30 seconds
- **Export PDF** — built-in browser `window.print()` support
- REST API at `/api/status`, `/api/history`, `/api/run`, `/api/dashboard`

### API endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | GET | Server info, version, configured projects |
| `/api/history` | GET | All past audit runs (lightweight index) |
| `/api/run` | POST | Trigger a new audit, save to history |
| `/api/dashboard` | GET | Current dashboard state with projects |
| `/api/history/:id` | GET | Full audit report for a specific run |

### Options

| Flag | Description |
|---|---|
| `--port <number>` | Server port (default: 3333) |
| `--open` | Open browser automatically |

### History storage

Audit runs are stored in `.goodjob-data/`:
- `history-idx.json` — lightweight index of all runs (timestamps, health score, counts)
- `runs/{id}.json` — full `AuditReport` per run (max 100 kept)

---

## Interactive TUI

Browse issues with keyboard navigation — zero external dependencies:

```bash
npx npm-goodjob tui .
```

| Key | Action |
|---|---|
| ↑ / k | Scroll up |
| ↓ / j | Scroll down |
| Enter | Show issue detail |
| Page Up | Page up |
| Page Down | Page down |
| Home | Jump to top |
| End | Jump to bottom |
| q / Esc | Quit |

Detail panel shows severity, category, tool, package, fix version, file path, CVE, and full description.

---

## Pre-commit hook

Install a git pre-commit hook that runs secret-scanning + lockfile-analysis before every commit:

```bash
npx npm-goodjob pre-commit install
```

Fast checks (< 1s typical) that block commits with:
- Hardcoded secrets (API keys, tokens, passwords)
- Invalid lockfiles (corrupt package-lock.json, missing integrity hashes)
- Duplicate dependencies in lockfile

Skip with `git commit --no-verify`.

---

## PR / MR comments

Generate formatted audit summaries for pull requests. Auto-posted via `gh` CLI (GitHub) or `curl` (GitLab):

```bash
npx npm-goodjob pr-comment .
```

Output includes:
- Health score with color badge
- Severity breakdown table
- Top 5 most critical issues
- Per-tool summary

In GitHub Actions, set `GITHUB_TOKEN` environment variable for automatic posting.

---

## CI integration

### GitHub Actions (`npx npm-goodjob init --ci`)

```yaml
name: npm-goodjob Audit
on: [pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - name: Store baseline
        continue-on-error: true
        run: npx npm-goodjob baseline store --file baseline.json
      - name: Run audit with SARIF
        run: npx npm-goodjob --sarif-output results.sarif
      - name: Compare with baseline
        if: success()
        run: npx npm-goodjob baseline diff --file baseline.json
      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
```

### GitLab CI

```yaml
goodjob-audit:
  stage: test
  script:
    - npm ci
    - npx npm-goodjob --sarif-output results.sarif
  artifacts:
    reports:
      sast: results.sarif
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
```

---

## Configuration (`.goodjobrc`)

Create a `.goodjobrc`, `.goodjobrc.json`, or `goodjob.config.json` in your project root. Or use `npx npm-goodjob init` to scaffold one.

### Full reference

```jsonc
{
  // Policy rules (optional — uncomment to enforce)
  // "policy": {
  //   "error": [
  //     { "rule": "severity.critical > 0", "description": "No critical issues" },
  //     { "rule": "health < 12", "description": "Health must be ≥12/20" }
  //   ],
  //   "warning": [
  //     { "rule": "health < 16", "description": "Health should be ≥16/20" }
  //   ]
  // },

  // Disable specific tools
  "tools": {
    "disabled": ["ts-prune", "depcruise"]
  },

  // License blocklist/whitelist
  "license": {
    "blocklist": ["gpl", "agpl", "proprietary", "sspl"]
  },

  // Health score configuration
  "healthScore": {
    "weights": {
      "security": 5,
      "dependencies": 5,
      "codeQuality": 5,
      "projectHealth": 5
    },
    "thresholds": {
      "good": 16,
      "warning": 12
    }
  },

  // Secret scanning customization
  "secretScanning": {
    "excludePaths": ["dist", "coverage", ".angular", ".next"],
    "extraPatterns": [
      {
        "name": "My Internal API Key",
        "pattern": "my-internal-api-key-[A-Za-z0-9]+",
        "severity": "high"
      }
    ]
  },

  // Issue exclusions — suppress known false positives by tool, package, message, severity, or category
  "issues": {
    "ignored": [
      // Suppress depcheck's "unused tslib" (used by Angular compiler, not directly imported)
      { "tool": "depcheck", "message": "tslib", "reason": "Used by Angular compiler internally" },
      // Suppress a specific npm audit advisory by package name
      { "tool": "npm-audit", "package": "@angular-devkit/build-angular", "reason": "Dev-only, not exploitable in our context" },
      // Suppress all low-severity issues from a tool
      { "tool": "depcheck", "severity": "low", "reason": "Depcheck low severity are devDependency hints" }
    ]
  }
}
```

### Issue exclusions

The `issues.ignored` array lets you suppress known false positives. Each exclusion can match by:

| Field | Description |
|---|---|
| `tool` | Tool name (e.g. `"depcheck"`, `"npm-audit"`) |
| `package` | Package name (exact match) |
| `message` | Text match (case-insensitive substring) |
| `severity` | Severity level (`"critical"`, `"high"`, `"medium"`, `"low"`) |
| `category` | Issue category (e.g. `"security"`, `"unused-dependency"`) |
| `reason` | Human-readable reason (optional, appears in verbose mode) |

Example — suppress Angular-specific false positives:
```json
{
  "issues": {
    "ignored": [
      { "tool": "depcheck", "package": "tslib", "reason": "Used by Angular compiler" },
      { "tool": "depcheck", "package": "@angular/compiler-cli", "reason": "Build tool, not a runtime dep" },
      { "tool": "depcheck", "severity": "low", "reason": "Only info-level hints" }
    ]
  }
}
```

Config is **cached** per project path. Call `clearConfigCache()` programmatically to reload.

---

## Programmatic API

```typescript
import {
  runAudit,
  loadConfig,
  getDefaultConfig,
  clearConfigCache,
  registerTool,
  getTool,
  getAllTools,
  evaluatePolicy,
  consoleReporter,
  jsonReporter,
  htmlReporter,
  sarifReporter,
  writeJsonFile,
  writeHtmlFile,
  writeSarifFile,
} from 'npm-goodjob';

// Run full audit
const report = await runAudit({
  projectPath: './my-project',
  tools: ['npm-audit', 'eslint'],   // optional filter
  skipTools: ['ts-prune'],           // optional skip
  verbose: false,
  toolTimeoutMs: 120_000,
  onToolStart(name, label) { console.log(`Starting ${label}...`); },
  onToolComplete(name, label, status, ms, count) { console.log(`${label}: ${status} (${count} issues)`); },
});

// Use report
console.log(report.summary);         // { total, errors, warnings, info, bySeverity, byCategory }
console.log(report.healthScore);     // { total, max, security, dependencies, codeQuality, projectHealth }
console.log(report.tools['npm-audit']); // ToolResult with issues[]

// Generate output
consoleReporter.write(report);       // colorized terminal
await writeHtmlFile(report, 'audit.html');
writeSarifFile(report, 'results.sarif');

// Config
const config = loadConfig('./my-project');
```

### Types

```typescript
interface AuditReport {
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    bySeverity: Record<Severity, number>;
    byCategory: Record<IssueCategory, number>;
  };
  tools: Record<string, ToolResult>;
  metadata: {
    projectName: string;
    projectPath: string;
    timestamp: string;
    durationMs: number;
    nodeVersion: string;
    npmVersion: string;
    goodjobVersion: string;
  };
  healthScore?: HealthScore;
}

interface Issue {
  level: 'error' | 'warning' | 'info';
  tool: string;
  category: IssueCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  detail?: string;
  file?: string;
  line?: number;
  column?: number;
  package?: string;
  version?: string;
  fixVersion?: string;
  cve?: string;
  cvss?: number;
  advisory?: string;
}
```

---

## Extensibility

Add custom audit tools via `registerTool()`:

```typescript
import { registerTool, type ToolRunner, type ToolOptions, type ToolResult } from 'npm-goodjob';

const myCustomTool: ToolRunner = {
  name: 'my-checker',
  label: 'My Custom Checker',
  version: '1.0.0',
  isAvailable(cwd: string) {
    // Check if prerequisites exist
    return true;
  },
  async run(options: ToolOptions): Promise<ToolResult> {
    const issues = [];
    // ... your audit logic
    return {
      tool: 'my-checker',
      label: 'My Custom Checker',
      version: '1.0.0',
      status: 'success',
      durationMs: 42,
      issues,
    };
  },
};

registerTool(myCustomTool);
```

Your tool is now auto-discovered by `runAudit()` and appears in all output formats.

---

## Comparison: why npm-goodjob?

| Feature | npm audit | snyk | socket.dev | **npm-goodjob** |
|---|---|---|---|---|
| npm audit | ✓ | | | ✓ |
| OSA vulnerabilities | | ✓ | | — |
| Unused dependencies | | | | ✓ (depcheck) |
| Dead TypeScript exports | | | | ✓ (ts-prune) |
| ESLint integration | | | | ✓ |
| Circular dependencies | | | | ✓ (depcruise) |
| License compliance | | | | ✓ |
| Secret scanning | | | ✓ | ✓ |
| Lockfile integrity | | | | ✓ |
| Health score | | ✓ | ✓ | ✓ |
| Policy as Code | | | ✓ | ✓ |
| SARIF output | | | | ✓ |
| SBOM (SPDX 2.3) | | | | ✓ |
| Baseline / Diff | | | | ✓ |
| Interactive TUI | | | | ✓ |
| PR comments | | | | ✓ |
| Pre-commit hook | | | | ✓ |
| CI templates | | | | ✓ |
| Offline / no phone-home | ✓ | | | ✓ |
| Open source | | | | ✓ MIT |
| **Snyk integration** | | ✓ | | ✓ |
| **Socket.dev integration** | | | ✓ | ✓ |
| **AuditJS / OSS Index** | | | | ✓ |
| **npm audit signatures** | ✓ | | | ✓ |
| **Web dashboard server** | | | | ✓ |
| **Audit history** | | | | ✓ |
| **Single command** | ✓ | ✓ | ✓ | ✓ (17 tools) |

---

## Framework support

npm-goodjob auto-detects your framework and adjusts tool defaults:

| Framework | Detection | Smart defaults |
|---|---|---|
| Angular | `@angular/core` dependency | Disables depcruise by default (Angular module system), keeps ts-prune on |
| React / Next.js | `react` or `next` dependency | All tools enabled |
| Node.js | No framework detected | All tools enabled |

---

## Requirements

- **Node.js >= 20**
- npm (for audit tools)
- Optional tools (depcheck, eslint, ts-prune, depcruise, snyk, socket, auditjs) — auto-skipped if missing, fall back to npx when possible

---

## Migrating from existing tools

| From | To npm-goodjob |
|---|---|
| `npm audit` | `npx npm-goodjob . --tools npm-audit` |
| `npx depcheck` | `npx npm-goodjob . --tools depcheck` |
| `npx ts-prune` | `npx npm-goodjob . --tools ts-prune` |
| `npx eslint .` | `npx npm-goodjob . --tools eslint` |
| `snyk test` | `npx npm-goodjob .` (includes Snyk runner) |
| `socket.dev scan` | `npx npm-goodjob .` (includes Socket.dev runner) |
| `auditjs ossi` | `npx npm-goodjob .` (includes AuditJS runner) |
| `npm audit signatures` | `npx npm-goodjob .` (includes npm-signatures runner) |
| Web dashboard | `npx npm-goodjob serve --open` |
| All combined | `npx npm-goodjob . --html-output report.html --sarif --sbom` |

---

## Performance

| Project size | Tools run | Typical time |
|---|---|---|
| Small (< 50 deps) | All 15 | 2-8s |
| Medium (50-200 deps) | All 15 | 5-20s |
| Large (200+ deps) | All 15 | 10-40s |

Timeouts: per-tool timeout is 120s by default. Use `--timeout 300000` for very large projects. npm audit can be slow on slow networks — tools run in parallel so total time = slowest single tool.

---

## License

MIT

---

## Author

Eric Reboisson — Developer Architect in a bank, auditing Angular and React applications for production readiness.
