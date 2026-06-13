// ---------------------------------------------------------------------------
// npm-goodjob — SBOM Generator (SPDX 2.3)
// Generates Software Bill of Materials from package-lock.json.
// Regulatory compliance: EU CRA, US Executive Order.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuditReport } from './types.js';

// ---------------------------------------------------------------------------
// Lockfile types (npm v3+)
// ---------------------------------------------------------------------------

interface NpmLockPackage {
  version: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  dependencies?: Record<string, string>;
}

interface NpmLockfile {
  name: string;
  version: string;
  lockfileVersion: number;
  packages?: Record<string, NpmLockPackage>;
}

// ---------------------------------------------------------------------------
// Public: generate SPDX SBOM from lockfile
// ---------------------------------------------------------------------------

export function generateSpdxSbom(
  projectPath: string,
  report?: AuditReport,
): string {
  const lockfilePath = resolve(projectPath, 'package-lock.json');
  const pkgJsonPath = resolve(projectPath, 'package.json');

  let projectName = 'unknown';
  try {
    if (existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      projectName = pkg.name ?? 'unknown';
    }
  } catch {
    // ignore
  }

  let lockData: NpmLockfile = { name: projectName, version: '0.0.0', lockfileVersion: 3 };
  try {
    if (existsSync(lockfilePath)) {
      lockData = JSON.parse(readFileSync(lockfilePath, 'utf-8')) as NpmLockfile;
    }
  } catch {
    // ignore
  }

  // License enrichment from report (license-check tool)
  const reportLicenses = extractLicensesFromReport(report);

  const rootSpdxId = 'SPDXRef-RootPackage';
  const packages: Array<Record<string, unknown>> = [
    {
      SPDXID: rootSpdxId,
      name: lockData.name || projectName,
      versionInfo: lockData.version || '0.0.0',
      supplier: 'NOASSERTION',
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
    },
  ];
  const relationships: Array<{ spdxElementId: string; relatedSpdxElement: string; relationshipType: string }> = [];

  const lockPackages = lockData.packages ?? {};
  for (const [pkgPath, pkgData] of Object.entries(lockPackages)) {
    if (pkgPath === '') continue;

    const name = pkgNameFromPath(pkgPath);
    if (!name) continue;

    const version = pkgData.version || '0.0.0';

    let license = 'NOASSERTION';
    if (pkgData.license) {
      license = pkgData.license;
    } else if (reportLicenses[name]) {
      license = reportLicenses[name];
    }

    const spdxId = spdxPackageId(name, version);

    const spdxPkg: Record<string, unknown> = {
      SPDXID: spdxId,
      name,
      versionInfo: version,
      supplier: 'NOASSERTION',
      downloadLocation: pkgData.resolved || 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: license,
      licenseDeclared: license,
      copyrightText: 'NOASSERTION',
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: `pkg:npm/${purlEncode(name)}@${version}`,
        },
      ],
    };
    packages.push(spdxPkg);

    relationships.push({
      spdxElementId: rootSpdxId,
      relatedSpdxElement: spdxId,
      relationshipType: 'DEPENDS_ON',
    });
  }

  const doc = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${projectName}-sbom-${new Date().toISOString().split('T')[0]}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ['Tool: npm-goodjob'],
    },
    packages,
    relationships,
  };

  return JSON.stringify(doc, null, 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pkgNameFromPath(pkgPath: string): string | null {
  const parts = pkgPath.split('node_modules/');
  const last = parts[parts.length - 1];
  return last || null;
}

function spdxPackageId(name: string, version: string): string {
  const safeName = name.replace(/^@/, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `SPDXRef-Package-${safeName}-${version}`;
}

function purlEncode(name: string): string {
  return name.replace(/@/g, '%40').replace(/\//g, '%2F');
}

function extractLicensesFromReport(report?: AuditReport): Record<string, string> {
  const licenses: Record<string, string> = {};
  if (!report) return licenses;

  const licenseTool = report.tools['license-check'];
  if (!licenseTool) return licenses;

  for (const issue of licenseTool.issues) {
    if (issue.message) {
      const pkgMatch = issue.message.match(/(?:package:|for)\s+(\S+)/);
      if (pkgMatch) {
        const name = pkgMatch[1].split('@')[0];
        const licMatch = issue.message.match(/License:\s+(\S+)/i) || issue.message.match(/license\s+(\S+)/i);
        if (licMatch) {
          licenses[name] = licMatch[1];
        }
      }
    }
  }

  return licenses;
}

export function formatSbomOutput(projectPath: string, report?: AuditReport): string {
  return generateSpdxSbom(projectPath, report);
}
