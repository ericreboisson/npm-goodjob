// ---------------------------------------------------------------------------
// npm-goodjob — Configuration loader
// Loads .goodjobrc (JSON) from the project root and merges with defaults.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GoodjobConfig } from './types.js';

const DEFAULT_CONFIG: GoodjobConfig = {
  // Policy is opt-in by default. Uncomment in .goodjobrc to enforce:
  // policy: {
  //   error: [
  //     { rule: 'severity.critical > 0', description: 'No critical severity issues allowed' },
  //     { rule: 'health < 12', description: 'Health score must be at least 12/20' },
  //   ],
  //   warning: [
  //     { rule: 'health < 16', description: 'Health score should be at least 16/20' },
  //   ],
  // },
  license: {
    blocklist: [
      'gpl', 'gpl-2.0', 'gpl-3.0',
      'agpl', 'agpl-1.0', 'agpl-3.0',
      'proprietary',
      'busl-1.0', 'sspl',
      'cpol',
      'cc-by-nc', 'cc-by-nc-nd', 'cc-by-nc-sa',
    ],
  },
  healthScore: {
    weights: {
      security: 5,
      dependencies: 5,
      codeQuality: 5,
      projectHealth: 5,
    },
    thresholds: {
      good: 16,
      warning: 12,
    },
  },
  secretScanning: {
    disabled: false,
    excludePaths: [],
  },
};

let _cachedConfig: GoodjobConfig | null = null;
let _cachedPath: string | null = null;

export function loadConfig(projectPath: string): GoodjobConfig {
  if (_cachedConfig && _cachedPath === projectPath) {
    return _cachedConfig;
  }

  const candidates = [
    resolve(projectPath, '.goodjobrc'),
    resolve(projectPath, '.goodjobrc.json'),
    resolve(projectPath, 'goodjob.config.json'),
  ];

  let loaded: Partial<GoodjobConfig> = {};
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        loaded = JSON.parse(raw) as Partial<GoodjobConfig>;
      } catch {
        // Ignore malformed config files
      }
      break;
    }
  }

  _cachedConfig = mergeConfig(DEFAULT_CONFIG, loaded);
  _cachedPath = projectPath;
  return _cachedConfig;
}

export function clearConfigCache(): void {
  _cachedConfig = null;
  _cachedPath = null;
}

function mergeConfig(defaults: GoodjobConfig, overrides: Partial<GoodjobConfig>): GoodjobConfig {
  return {
    policy: overrides.policy ?? defaults.policy,
    license: {
      ...defaults.license,
      ...overrides.license,
      whitelist: overrides.license?.whitelist ?? defaults.license?.whitelist,
      blocklist: overrides.license?.blocklist ?? defaults.license?.blocklist,
    },
    healthScore: {
      weights: {
        ...defaults.healthScore?.weights,
        ...overrides.healthScore?.weights,
      },
      thresholds: {
        ...defaults.healthScore?.thresholds,
        ...overrides.healthScore?.thresholds,
      },
    },
    tools: {
      disabled: overrides.tools?.disabled ?? defaults.tools?.disabled,
      options: {
        ...defaults.tools?.options,
        ...overrides.tools?.options,
      },
    },
    secretScanning: {
      ...defaults.secretScanning,
      ...overrides.secretScanning,
      excludePaths: overrides.secretScanning?.excludePaths ?? defaults.secretScanning?.excludePaths,
      extraPatterns: overrides.secretScanning?.extraPatterns ?? defaults.secretScanning?.extraPatterns,
    },
    pkgLint: overrides.pkgLint ?? defaults.pkgLint,
    projects: overrides.projects ?? defaults.projects,
    issues: overrides.issues ?? defaults.issues,
  };
}

/** Export default config for reference (used by license-check) */
export function getDefaultConfig(): GoodjobConfig {
  return DEFAULT_CONFIG;
}
