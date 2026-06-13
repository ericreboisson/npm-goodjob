// ---------------------------------------------------------------------------
// npm-goodjob — JSON reporter
// Writes the full report as pretty-printed JSON.
// ---------------------------------------------------------------------------

import type { AuditReport, Reporter } from '../types.js';

export const jsonReporter: Reporter = {
  write(report: AuditReport): void {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  },
};

/** Write report to a file path */
export async function writeJsonFile(report: AuditReport, filePath: string): Promise<void> {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(filePath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
}
