import { describe, it, expect } from 'vitest';
import { generateSpdxSbom } from '../sbom.js';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function withTempProject(fn: (projectPath: string) => void): void {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gj-sbom-'));
  mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });
  try {
    fn(tmpDir);
  } finally {
    // Cleanup
    for (const file of ['package.json', 'package-lock.json']) {
      const p = join(tmpDir, file);
      if (existsSync(p)) unlinkSync(p);
    }
  }
}

describe('SBOM generator', () => {
  it('generates valid SPDX 2.3 JSON with lockfile', () => {
    withTempProject((tmpDir) => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app', version: '1.0.0' }), 'utf-8');
      writeFileSync(join(tmpDir, 'package-lock.json'), JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
          '': { name: 'my-app', version: '1.0.0' },
          'node_modules/lodash': {
            version: '4.17.21',
            license: 'MIT',
            resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          },
          'node_modules/chalk': {
            version: '5.3.0',
            license: 'MIT',
            resolved: 'https://registry.npmjs.org/chalk/-/chalk-5.3.0.tgz',
          },
          'node_modules/@scope/foo': {
            version: '1.2.3',
            license: 'Apache-2.0',
          },
        },
      }), 'utf-8');

      const sbom = generateSpdxSbom(tmpDir);
      const doc = JSON.parse(sbom);

      expect(doc.spdxVersion).toBe('SPDX-2.3');
      expect(doc.dataLicense).toBe('CC0-1.0');
      expect(doc.SPDXID).toBe('SPDXRef-DOCUMENT');
      expect(doc.creationInfo.creators).toContain('Tool: npm-goodjob');

      // Packages: root + 3 deps
      expect(doc.packages).toHaveLength(4);

      // Root package
      const root = doc.packages[0];
      expect(root.name).toBe('my-app');
      expect(root.SPDXID).toBe('SPDXRef-RootPackage');

      // Dependencies
      const lodash = doc.packages.find((p: Record<string, unknown>) => p.name === 'lodash');
      expect(lodash).toBeDefined();
      expect(lodash.versionInfo).toBe('4.17.21');
      expect(lodash.licenseConcluded).toBe('MIT');
      expect(lodash.externalRefs[0].referenceLocator).toBe('pkg:npm/lodash@4.17.21');

      const scoped = doc.packages.find((p: Record<string, unknown>) => p.name === '@scope/foo');
      expect(scoped).toBeDefined();
      expect(scoped.versionInfo).toBe('1.2.3');
      expect(scoped.licenseConcluded).toBe('Apache-2.0');

      // Relationships
      expect(doc.relationships.length).toBeGreaterThanOrEqual(3);
      const rootRels = doc.relationships.filter((r: Record<string, unknown>) => r.spdxElementId === 'SPDXRef-RootPackage');
      expect(rootRels.length).toBe(3);
    });
  });

  it('generates minimal SBOM when no lockfile exists', () => {
    withTempProject((tmpDir) => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'empty-app' }), 'utf-8');

      const sbom = generateSpdxSbom(tmpDir);
      const doc = JSON.parse(sbom);

      expect(doc.spdxVersion).toBe('SPDX-2.3');
      expect(doc.packages).toHaveLength(1); // root only
      expect(doc.name).toContain('empty-app');
    });
  });

  it('uses license from lockfile when available', () => {
    withTempProject((tmpDir) => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
      writeFileSync(join(tmpDir, 'package-lock.json'), JSON.stringify({
        name: 'test',
        lockfileVersion: 3,
        packages: {
          'node_modules/express': {
            version: '4.18.2',
            license: 'MIT',
          },
          'node_modules/some-unlicensed': {
            version: '1.0.0',
          },
        },
      }), 'utf-8');

      const sbom = generateSpdxSbom(tmpDir);
      const doc = JSON.parse(sbom);

      const express = doc.packages.find((p: Record<string, unknown>) => p.name === 'express');
      expect(express.licenseConcluded).toBe('MIT');

      const unlicensed = doc.packages.find((p: Record<string, unknown>) => p.name === 'some-unlicensed');
      expect(unlicensed.licenseConcluded).toBe('NOASSERTION');
    });
  });

  it('includes PURL external refs for each package', () => {
    withTempProject((tmpDir) => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
      writeFileSync(join(tmpDir, 'package-lock.json'), JSON.stringify({
        name: 'test',
        lockfileVersion: 3,
        packages: {
          'node_modules/axios': {
            version: '1.6.0',
            license: 'MIT',
          },
        },
      }), 'utf-8');

      const sbom = generateSpdxSbom(tmpDir);
      const doc = JSON.parse(sbom);

      const axios = doc.packages.find((p: Record<string, unknown>) => p.name === 'axios');
      expect(axios.externalRefs).toHaveLength(1);
      expect(axios.externalRefs[0].referenceCategory).toBe('PACKAGE-MANAGER');
      expect(axios.externalRefs[0].referenceType).toBe('purl');
      expect(axios.externalRefs[0].referenceLocator).toBe('pkg:npm/axios@1.6.0');
    });
  });

  it('handles invalid lockfile gracefully', () => {
    withTempProject((tmpDir) => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
      writeFileSync(join(tmpDir, 'package-lock.json'), 'not valid json', 'utf-8');

      // Should not throw
      const sbom = generateSpdxSbom(tmpDir);
      const doc = JSON.parse(sbom);
      expect(doc.packages).toHaveLength(1); // root only
    });
  });
});
