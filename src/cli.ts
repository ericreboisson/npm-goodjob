// ---------------------------------------------------------------------------
// npm-goodjob — CLI entry point
// ---------------------------------------------------------------------------

import { program } from 'commander';
import { existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { runAudit, GOODJOB_VERSION } from './runner.js';
import { consoleReporter } from './reporters/console-reporter.js';
import { jsonReporter, writeJsonFile } from './reporters/json-reporter.js';
import { htmlReporter, writeHtmlFile } from './reporters/html-reporter.js';
import { sarifReporter, writeSarifFile } from './reporters/sarif-reporter.js';
import { storeBaseline, loadBaseline, computeDiff, formatDiff, baselineSummary } from './baseline.js';
import { formatSbomOutput } from './sbom.js';
import { postPrComment, formatPrComment } from './pr-comment.js';
import { runTui } from './tui.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_RED = '\x1b[31m';

// ---------------------------------------------------------------------------
// CI workflow templates
// ---------------------------------------------------------------------------

const GITHUB_CI_TEMPLATE = `name: npm-goodjob Audit
on:
  pull_request:
    branches: [main, master, develop]
jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - name: Store baseline (first run)
        id: baseline
        continue-on-error: true
        run: npx npm-goodjob baseline store --file goodjob-baseline.json
      - name: Run npm-goodjob audit with SARIF
        run: npx npm-goodjob --sarif-output goodjob-results.sarif
      - name: Compare with baseline
        if: steps.baseline.outcome == 'success'
        run: npx npm-goodjob baseline diff --file goodjob-baseline.json
      - name: Upload SARIF to GitHub Code Scanning
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: goodjob-results.sarif
`;

const GITLAB_CI_TEMPLATE = `goodjob-audit:
  stage: test
  script:
    - npm ci
    - npx npm-goodjob --sarif-output goodjob-results.sarif
  artifacts:
    reports:
      sast: goodjob-results.sarif
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
`;

// ---------------------------------------------------------------------------
// npm-goodjob init — project scaffolding
// ---------------------------------------------------------------------------

async function runInit(projectPath: string, options: { ci?: boolean }): Promise<void> {
  console.error(`\n  ${BOLD}npm-goodjob init${RESET} — ${projectPath}\n`);

  // Read package.json
  const pkgPath = join(projectPath, 'package.json');
  let deps: Record<string, string> = {};
  let devDeps: Record<string, string> = {};
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      deps = pkg.dependencies ?? {};
      devDeps = pkg.devDependencies ?? {};
    } catch {
      // ignore
    }
  }

  // Detect framework
  let framework = 'node';
  if (deps['@angular/core'] || devDeps['@angular/core']) {
    framework = 'angular';
  } else if (deps.react || deps['next'] || devDeps.react) {
    framework = 'react';
  }

  const allDeps = { ...deps, ...devDeps };
  const hasTypescript = !!allDeps['typescript'];
  const hasEslint = !!allDeps['eslint'];
  const hasDepcheck = !!allDeps['depcheck'];

  // Build .goodjobrc content
  const config: Record<string, unknown> = {
    // Uncomment to enforce policy rules (exit code 1 on violation):
    // "policy": {
    //   "error": [
    //     { "rule": "severity.critical > 0", "description": "No critical issues allowed" },
    //     { "rule": "health < 12", "description": "Health score must be at least 12/20" }
    //   ],
    //   "warning": [
    //     { "rule": "health < 16", "description": "Health score should be at least 16/20" }
    //   ]
    // },
    tools: {
      disabled: [],
    },
    license: {
      blocklist: ['gpl', 'agpl', 'proprietary', 'sspl'],
    },
    secretScanning: {
      excludePaths: ['dist', 'coverage', '.angular', '.next'],
    },
  };

  // Disable tools not applicable
  if (!hasTypescript) {
    (config.tools as Record<string, unknown>).disabled = [
      ...(config.tools as Record<string, string[]>).disabled,
      'ts-prune',
    ];
  }

  // Detect Angular-specific config
  if (framework === 'angular') {
    (config.tools as Record<string, unknown>).disabled = [
      ...(config.tools as Record<string, string[]>).disabled,
      'depcruise',
    ];
  }

  // Write .goodjobrc
  const rcPath = join(projectPath, '.goodjobrc');
  if (existsSync(rcPath)) {
    console.error(`  ${FG_YELLOW}⚠ .goodjobrc already exists, skipping${RESET}`);
  } else {
    writeFileSync(rcPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.error(`  ${FG_GREEN}✓${RESET} Created ${BOLD}.goodjobrc${RESET}`);
  }

  // Write CI workflows
  if (options.ci) {
    const ghDir = join(projectPath, '.github', 'workflows');
    const ghPath = join(ghDir, 'goodjob.yml');
    if (!existsSync(ghDir)) {
      mkdirSync(ghDir, { recursive: true });
    }
    writeFileSync(ghPath, GITHUB_CI_TEMPLATE, 'utf-8');
    console.error(`  ${FG_GREEN}✓${RESET} Created ${BOLD}.github/workflows/goodjob.yml${RESET}`);

    const glPath = join(projectPath, '.gitlab-ci.yml');
    // Append to existing .gitlab-ci.yml or create new
    if (existsSync(glPath)) {
      const existing = readFileSync(glPath, 'utf-8');
      if (!existing.includes('goodjob-audit')) {
        writeFileSync(glPath, existing + '\n' + GITLAB_CI_TEMPLATE, 'utf-8');
        console.error(`  ${FG_GREEN}✓${RESET} Appended to ${BOLD}.gitlab-ci.yml${RESET}`);
      } else {
        console.error(`  ${DIM}→ goodjob-audit already in .gitlab-ci.yml${RESET}`);
      }
    } else {
      writeFileSync(glPath, GITLAB_CI_TEMPLATE, 'utf-8');
      console.error(`  ${FG_GREEN}✓${RESET} Created ${BOLD}.gitlab-ci.yml${RESET}`);
    }
  }

  // Summary
  console.error(`\n  ${BOLD}Summary${RESET}`);
  console.error(`  ${DIM}Project type:${RESET} ${framework}${hasTypescript ? ' + TypeScript' : ''}`);
  console.error(`  ${DIM}Tools${RESET}`);
  const allTools = [
    { name: 'npm-audit', ok: true },
    { name: 'npm-outdated', ok: true },
    { name: 'secret-scanning', ok: true },
    { name: 'lockfile-analysis', ok: true },
    { name: 'license-check', ok: true },
    { name: 'dependency-check', ok: true },
    { name: 'depcheck', ok: hasDepcheck },
    { name: 'eslint', ok: hasEslint },
    { name: 'ts-prune', ok: hasTypescript },
  ];
  for (const t of allTools) {
    const icon = t.ok ? `${FG_GREEN}✓${RESET}` : `${DIM}–${RESET}`;
    const note = t.ok ? '' : ` ${DIM}(not installed, runs via npx if available)${RESET}`;
    console.error(`    ${icon} ${t.name}${note}`);
  }

  console.error(`\n  ${FG_GREEN}${BOLD}  npm-goodjob init complete${RESET}`);
  console.error(`  Run ${BOLD}npx npm-goodjob .${RESET} to audit the project.\n`);
}

// ---------------------------------------------------------------------------
// npm-goodjob pre-commit install — install git pre-commit hook
// ---------------------------------------------------------------------------

function runPreCommitInstall(): void {
  const gitDir = resolve(process.cwd(), '.git');
  const hooksDir = join(gitDir, 'hooks');
  const hookPath = join(hooksDir, 'pre-commit');

  if (!existsSync(gitDir)) {
    console.error(`\n  ${FG_RED}✗${RESET} Not a git repository (no .git directory found)\n`);
    process.exit(1);
    return;
  }

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  if (existsSync(hookPath)) {
    console.error(`\n  ${FG_YELLOW}⚠${RESET} Pre-commit hook already exists at ${BOLD}.git/hooks/pre-commit${RESET}`);
    console.error(`  Delete it first, or add npm-goodjob manually.\n`);
    return;
  }

  const hookScript = `#!/bin/sh
# npm-goodjob pre-commit hook — fast audit before every commit
# Installed by: npx npm-goodjob pre-commit install
# Skip with: git commit --no-verify

GOODJOB="npx --yes npm-goodjob"
PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"

if [ -z "$PROJECT_DIR" ]; then
    echo "npm-goodjob: not a git repository, skipping"
    exit 0
fi

cd "$PROJECT_DIR" || exit 1

# Run fast checks: secret-scanning + lockfile-analysis
$GOODJOB . --tools secret-scanning lockfile-analysis 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo "  ! npm-goodjob: pre-commit checks failed"
    echo "  Commit blocked. Run 'npx npm-goodjob pre-commit' to see details."
    echo "  Use 'git commit --no-verify' to bypass."
    echo ""
    exit 1
fi

exit 0
`;

  writeFileSync(hookPath, hookScript, 'utf-8');
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // ignore
  }

  console.error(`\n  ${FG_GREEN}✓${RESET} Pre-commit hook installed: ${BOLD}.git/hooks/pre-commit${RESET}`);
  console.error(`  Runs: secret-scanning, lockfile-analysis`);
  console.error(`  The hook will block commits that introduce secrets or invalid lockfiles.\n`);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export async function runCLI(): Promise<void> {
  // Handle 'init' subcommand manually before commander
  if (process.argv[2] === 'init') {
    // Remove 'init' from argv so commander doesn't get confused
    const projectPath = resolve(process.cwd(), process.argv[3] ?? '.');
    const ci = process.argv.includes('--ci');
    await runInit(projectPath, { ci });
    return;
  }

  // Handle 'pre-commit' subcommand
  if (process.argv[2] === 'pre-commit') {
    const sub = process.argv[3]; // 'install' or run (no sub = run)
    if (sub === 'install') {
      runPreCommitInstall();
      return;
    }
    // Run pre-commit audit (fast tools only)
    const projectPath = resolve(process.cwd(), '.');
    const report = await runAudit({
      projectPath,
      tools: ['secret-scanning', 'lockfile-analysis'],
      verbose: false,
      onToolStart(_name, label) {
        process.stderr.write(`  ${label} ...\n`);
      },
      onToolComplete(_name, label, status, _durationMs, _issueCount) {
        const icon = status === 'success' ? '✓' : status === 'skipped' ? '–' : '✗';
        process.stderr.write(`  ${icon} ${label}\n`);
      },
    });

    // Show results
    const blocked = report.summary.errors > 0;
    const secretTool = report.tools['secret-scanning'];
    if (secretTool) {
      for (const issue of secretTool.issues) {
        if (issue.level === 'info') continue;
        process.stdout.write(`  ${issue.level === 'error' ? '✗' : '⚠'} ${issue.message}`);
        if (issue.file) process.stdout.write(` (${issue.file}:${issue.line})`);
        process.stdout.write('\n');
      }
    }

    if (blocked) {
      process.stderr.write('\n  \x1b[31m✗ npm-goodjob: pre-commit checks failed\x1b[0m\n');
      process.stderr.write('  Use \x1b[2mgit commit --no-verify\x1b[0m to skip.\n\n');
      process.exit(1);
    } else {
      process.stderr.write('  \x1b[32m✓ npm-goodjob: pre-commit checks passed\x1b[0m\n\n');
      process.exit(0);
    }
    return;
  }

  // Handle 'pr-comment' subcommand
  if (process.argv[2] === 'pr-comment') {
    const projectPath = resolve(process.cwd(), process.argv[3] ?? '.');
    const report = await runAudit({ projectPath, toolTimeoutMs: 180_000 });
    const posted = postPrComment(report);

    if (!posted) {
      // Print comment to stdout so it can be captured
      process.stdout.write(formatPrComment(report) + '\n');
    }
    return;
  }

  // Handle 'tui' subcommand
  if (process.argv[2] === 'tui') {
    const projectPath = resolve(process.cwd(), process.argv[3] ?? '.');
    const report = await runAudit({ projectPath, toolTimeoutMs: 180_000 });
    runTui(report);
    return;
  }

  // Handle 'baseline' subcommand
  if (process.argv[2] === 'baseline') {
    const sub = process.argv[3]; // 'store' or 'diff'
    const fileIdx = process.argv.indexOf('--file');
    const baselineFile = fileIdx >= 0 ? process.argv[fileIdx + 1] : 'goodjob-baseline.json';
    const projectPath = resolve(process.cwd(), process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : '.');

    if (sub === 'store') {
      const report = await runAudit({ projectPath });
      storeBaseline(report, resolve(projectPath, baselineFile));
      console.error(`\n  ${FG_GREEN}✓${RESET} Baseline stored: ${BOLD}${baselineFile}${RESET}`);
      console.error(`  ${baselineSummary(report)}`);
      console.error('');
      return;
    }

    if (sub === 'diff') {
      const bPath = resolve(projectPath, baselineFile);
      const baseline = loadBaseline(bPath);
      if (!baseline) {
        console.error(`\n  ${FG_RED}✗${RESET} Baseline not found: ${BOLD}${bPath}${RESET}`);
        console.error(`  Run ${BOLD}npx npm-goodjob baseline store${RESET} first.\n`);
        process.exit(1);
        return;
      }
      const report = await runAudit({ projectPath });
      const diff = computeDiff(report, baseline);
      process.stdout.write(formatDiff(diff));
      return;
    }

    console.error(`\n  Usage: npx npm-goodjob baseline <store|diff> [--file <path>] [project-path]\n`);
    return;
  }

  program
    .name('npm-goodjob')
    .description(
      'Unified NPM project audit aggregator — run npm audit, depcheck, ESLint,\n' +
        'ts-prune, dependency-cruiser, OSV-Scanner and more in one shot.',
    )
    .version(GOODJOB_VERSION)
    .argument('[project-path]', 'Path to the project to audit', '.')
    .option('-t, --tools <tools...>', 'Only run specific tools (e.g. --tools npm-audit eslint)')
    .option('-s, --skip <tools...>', 'Skip specific tools (e.g. --skip ts-prune)')
    .option('-j, --json', 'Output JSON report instead of console')
    .option('-o, --output <file>', 'Write JSON report to a file')
    .option('--html', 'Output HTML report')
    .option('--html-output <file>', 'Write HTML report to a file')
    .option('--sarif', 'Output SARIF report (GitHub Code Scanning / GitLab SAST)')
    .option('--sarif-output <file>', 'Write SARIF report to a file')
    .option('--sbom', 'Output SPDX 2.3 SBOM (Bill of Materials)')
    .option('--sbom-output <file>', 'Write SPDX 2.3 SBOM to a file')
    .option('-v, --verbose', 'Include raw tool output in report')
    .option('--timeout <ms>', 'Per-tool timeout in milliseconds', '120000')
    .parse(process.argv);

  const opts = program.opts();
  const projectPath = resolve(process.cwd(), program.args[0] ?? '.');

  const report = await runAudit({
    projectPath,
    tools: opts.tools,
    skipTools: opts.skip,
    verbose: opts.verbose ?? false,
    toolTimeoutMs: parseInt(opts.timeout, 10) || 120_000,
    onToolStart(_name, label) {
      console.error(`  ${BOLD}${label}${RESET} ${DIM}...${RESET}`);
    },
    onToolComplete(_name, label, status, durationMs, issueCount) {
      const elapsed = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
      const tag =
        status === 'success'
          ? `${FG_GREEN}✓${RESET}`
          : status === 'skipped'
            ? `${DIM}–${RESET}`
            : `${FG_RED}✗${RESET}`;
      const countInfo = issueCount > 0 ? ` ${FG_YELLOW}(${issueCount})${RESET}` : '';
      console.error(`  ${tag} ${BOLD}${label}${RESET} ${DIM}${elapsed}${RESET}${countInfo}`);
    },
  });

  // Route output format
  const jsonOutputFile = opts.output as string | undefined;
  const htmlOutputFile = opts.htmlOutput as string | undefined;
  const sarifOutputFile = opts.sarifOutput as string | undefined;
  const sbomOutputFile = opts.sbomOutput as string | undefined;

  if (sbomOutputFile) {
    const sbomJson = formatSbomOutput(projectPath, report);
    writeFileSync(resolve(process.cwd(), sbomOutputFile), sbomJson, 'utf-8');
    console.error(`\n\u{1F4CB} SBOM written to: ${sbomOutputFile}\n`);
  } else if (opts.sbom) {
    process.stdout.write(formatSbomOutput(projectPath, report) + '\n');
  } else if (sarifOutputFile) {
    writeSarifFile(report, resolve(process.cwd(), sarifOutputFile));
    console.error(`\n🔬 SARIF report written to: ${sarifOutputFile}\n`);
  } else if (opts.sarif) {
    sarifReporter.write(report);
  } else if (htmlOutputFile) {
    await writeHtmlFile(report, resolve(process.cwd(), htmlOutputFile));
    console.error(`\n📄 HTML report written to: ${htmlOutputFile}\n`);
  } else if (opts.html) {
    htmlReporter.write(report);
  } else if (opts.json || jsonOutputFile) {
    if (jsonOutputFile) {
      await writeJsonFile(report, resolve(process.cwd(), jsonOutputFile));
      console.error(`\n📄 JSON report written to: ${jsonOutputFile}\n`);
    } else {
      jsonReporter.write(report);
    }
  } else {
    consoleReporter.write(report);
  }

  // Exit code: error-level issues → exit 1
  if (report.summary.errors > 0) {
    process.exit(1);
  }
}
