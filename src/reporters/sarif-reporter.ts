// ---------------------------------------------------------------------------
// npm-goodjob — SARIF reporter
// Transforms AuditReport into SARIF 2.1.0 format for GitHub Code Scanning
// and GitLab SAST integration.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import type { AuditReport, Reporter } from '../types.js';

export const sarifReporter: Reporter = {
  write(report: AuditReport): void {
    process.stdout.write(JSON.stringify(toSarif(report), null, 2));
  },
};

export function writeSarifFile(report: AuditReport, filePath: string): void {
  writeFileSync(filePath, JSON.stringify(toSarif(report), null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// SARIF 2.1.0 types
// ---------------------------------------------------------------------------

interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
  invocations: SarifInvocation[];
  properties?: Record<string, unknown>;
}

interface SarifDriver {
  name: string;
  version: string;
  informationUri?: string;
  rules: SarifRule[];
}

interface SarifRule {
  id: string;
  name?: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  help?: { text: string; markdown?: string };
  properties?: {
    category?: string;
    severity?: string;
    precision?: string;
  };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number; startColumn?: number };
  };
}

interface SarifInvocation {
  executionSuccessful: boolean;
  startTimeUtc?: string;
  endTimeUtc?: string;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export function toSarif(report: AuditReport): SarifLog {
  const rules = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const [, toolResult] of Object.entries(report.tools)) {
    for (const issue of toolResult.issues) {
      if (issue.level === 'info') {
        continue; // SARIF has no "info" level; skip
      }

      const ruleId = `${toolResult.tool}/${issue.category}/${issue.severity}`;
      if (!rules.has(ruleId)) {
        rules.set(ruleId, {
          id: ruleId,
          name: issue.message.slice(0, 100),
          shortDescription: { text: issue.message },
          fullDescription: issue.detail ? { text: issue.detail } : undefined,
          properties: {
            category: issue.category,
            severity: issue.severity,
            precision: 'high',
          },
        });
      }

      const location: SarifLocation = {
        physicalLocation: {
          artifactLocation: { uri: issue.file ?? report.metadata.projectPath },
        },
      };
      if (issue.line) {
        location.physicalLocation.region = {
          startLine: issue.line,
          ...(issue.column ? { startColumn: issue.column } : {}),
        };
      }

      results.push({
        ruleId,
        ruleIndex: Array.from(rules.keys()).indexOf(ruleId),
        level: issue.level === 'error' ? 'error' : 'warning',
        message: { text: issue.detail ? `${issue.message}: ${issue.detail}` : issue.message },
        locations: [location],
        partialFingerprints: issue.cve
          ? { cveId: issue.cve }
          : issue.package
            ? { packageKey: `${issue.package}@${issue.version ?? 'unknown'}` }
            : undefined,
      });
    }
  }

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'goodjob',
            version: report.metadata.goodjobVersion,
            informationUri: 'https://github.com/ericreboisson/npm-goodjob',
            rules: Array.from(rules.values()),
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: report.summary.errors === 0,
            startTimeUtc: report.metadata.timestamp,
            endTimeUtc: new Date().toISOString(),
          },
        ],
        properties: {
          projectName: report.metadata.projectName,
          projectPath: report.metadata.projectPath,
        },
      },
    ],
  };
}
