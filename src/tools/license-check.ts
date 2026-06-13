// ---------------------------------------------------------------------------
// npm-goodjob — License checker
// Uses npx license-checker --json to audit dependency licenses.
// Flags restricted licenses (GPL, AGPL, LGPL, Proprietary, SSPL, BUSL, etc.)
// ---------------------------------------------------------------------------

import type { ToolRunner, ToolResult, ToolOptions, Issue } from '../types.js';
import {
  registerTool,
  buildResult,
  runNpxToolCommand,
  isNpxAvailable,
} from './base.js';

// Default restricted license list — overridable via .goodjobrc
const DEFAULT_RESTRICTED = [
  'gpl', 'gpl-2.0', 'gpl-3.0',
  'agpl', 'agpl-1.0', 'agpl-3.0',
  'proprietary',
  'busl-1.0', 'sspl',
  'cpol',
  'cc-by-nc', 'cc-by-nc-nd', 'cc-by-nc-sa',
];

// These are commonly allowed in enterprise; flag only if explicitly blocked
const DEFAULT_WARN = new Set([
  'lgpl-2.0', 'lgpl-2.1', 'lgpl-3.0',
  'bsd-2-clause', 'bsd-3-clause', 'unlicense',
]);

interface LicenseEntry {
  licenses: string | string[];
  repository?: string;
  publisher?: string;
  email?: string;
  url?: string;
  path: string;
  licenseFile?: string;
}

type LicenseCheckerOutput = Record<string, LicenseEntry>;

async function runLicenseChecker(options: ToolOptions): Promise<ToolResult> {
  const start = Date.now();
  const out = await runNpxToolCommand('license-checker', ['--json'], options);

  if (!out) {
    return buildResult('license-check', 'License Check', 'via npx', [], Date.now() - start);
  }

  let data: LicenseCheckerOutput;
  try {
    data = JSON.parse(out.stdout) as LicenseCheckerOutput;
  } catch {
    return buildResult('license-check', 'License Check', 'via npx', [], Date.now() - start,
      'Failed to parse license-checker output');
  }

  // Build restricted set from config, falling back to defaults
  const config = options.config;
  const configBlocklist = config?.license?.blocklist;
  const configWhitelist = config?.license?.whitelist;

  let restrictedSet: Set<string>;
  if (configBlocklist) {
    restrictedSet = new Set(configBlocklist.map((l) => l.toLowerCase().trim()));
  } else {
    restrictedSet = new Set(DEFAULT_RESTRICTED);
  }

  // If a whitelist is provided, restricted = everything not in the whitelist
  const whitelistSet = configWhitelist
    ? new Set(configWhitelist.map((l) => l.toLowerCase().trim()))
    : null;

  const issues: Issue[] = [];

  for (const [key, entry] of Object.entries(data)) {
    // Extract package@version from key like "lodash@4.17.21"
    const atIdx = key.lastIndexOf('@');
    const pkgName = atIdx > 0 ? key.slice(0, atIdx) : key;
    const pkgVersion = atIdx > 0 ? key.slice(atIdx + 1) : '';

    const rawLicenses = entry.licenses ?? [];
    const licenseList = Array.isArray(rawLicenses) ? rawLicenses : [rawLicenses];

    for (const lic of licenseList) {
      const normalized = lic.toLowerCase().trim();

      if (normalized === 'unknown' || normalized === '') {
        issues.push({
          level: 'warning',
          tool: 'license-check',
          category: 'license',
          severity: 'medium',
          message: `${pkgName}@${pkgVersion} has unknown license`,
          package: pkgName,
          version: pkgVersion || undefined,
          detail: `License field is "${lic}". Project may need legal review.`,
        });
        continue;
      }

      // Whitelist mode: flag anything not in the whitelist
      if (whitelistSet && !whitelistSet.has(normalized)) {
        const isWarn = DEFAULT_WARN.has(normalized);
        issues.push({
          level: isWarn ? 'warning' : 'error',
          tool: 'license-check',
          category: 'license',
          severity: isWarn ? 'medium' : 'high',
          message: `${pkgName}@${pkgVersion} has ${lic} license`,
          package: pkgName,
          version: pkgVersion || undefined,
          detail: `License "${lic}" is not in the allowed list. ${isWarn ? 'Review if acceptable in enterprise.' : 'Blocked by policy.'}`,
        });
        continue;
      }

      // Blocklist mode: flag only if in restricted set
      if (restrictedSet.has(normalized)) {
        const isWarn = DEFAULT_WARN.has(normalized);
        issues.push({
          level: isWarn ? 'warning' : 'error',
          tool: 'license-check',
          category: 'license',
          severity: isWarn ? 'medium' : 'high',
          message: `${pkgName}@${pkgVersion} has ${lic} license`,
          package: pkgName,
          version: pkgVersion || undefined,
          detail: `License "${lic}" is restricted. ${isWarn ? 'May be allowed with legal review.' : 'Blocked by policy.'}`,
        });
      }
    }
  }

  if (issues.length === 0) {
    issues.push({
      level: 'info',
      tool: 'license-check',
      category: 'license',
      severity: 'low',
      message: 'All dependency licenses appear compatible',
      detail: `Checked ${Object.keys(data).length} packages — no restricted or unknown licenses found.`,
    });
  }

  return buildResult('license-check', 'License Check', 'via npx', issues, Date.now() - start);
}

export const licenseCheckRunner: ToolRunner = {
  name: 'license-check',
  label: 'License Check',
  isAvailable(_cwd: string): boolean {
    // license-checker always works via npx, no local install needed
    return isNpxAvailable();
  },
  async run(options: ToolOptions): Promise<ToolResult> {
    return runLicenseChecker(options);
  },
};

registerTool(licenseCheckRunner);
