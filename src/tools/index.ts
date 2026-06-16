// ---------------------------------------------------------------------------
// npm-goodjob — Tool runner barrel
// Importing this module ensures all built-in tools are registered.
// ---------------------------------------------------------------------------

export { registerTool, getAllTools, getTool } from './base.js';
export type { PackageJson } from './base.js';

// Register all tools by importing them (side-effect registration)
export { npmAuditRunner } from './npm-audit.js';
export { depcheckRunner } from './depcheck.js';
export { npmOutdatedRunner } from './npm-outdated.js';
export { tsPruneRunner } from './ts-prune.js';
export { eslintRunner } from './eslint.js';
export { depcruiseRunner } from './depcruise.js';
export { dependencySanityRunner } from './dependency-check.js';
export { licenseCheckRunner } from './license-check.js';
export { lockfileAnalysisRunner } from './lockfile-analysis.js';
export { secretScanningRunner } from './secret-scanning.js';
export { npmSignaturesRunner } from './npm-signatures.js';
export { pkgLintRunner } from './pkg-lint.js';
export { architectRunner } from './architect.js';
export { knipRunner } from './knip.js';
