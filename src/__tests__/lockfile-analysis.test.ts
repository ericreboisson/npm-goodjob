import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lockfileAnalysisRunner } from '../tools/lockfile-analysis.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `goodjob-test-la-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writePackageJson(deps: Record<string, string> = {}, devDeps: Record<string, string> = {}): void {
  writeFileSync(
    join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: deps, devDependencies: devDeps }),
    'utf-8',
  );
}

function writeLockfile(packages: Record<string, { version: string; dev?: boolean; dependencies?: Record<string, string> }>): void {
  // Mimic npm v7+ lockfile format v2
  const lockfile = {
    name: 'test',
    lockfileVersion: 2,
    packages: { '': { name: 'test' }, ...packages },
    dependencies: {} as Record<string, Record<string, unknown>>,
  };
  writeFileSync(join(tmpDir, 'package-lock.json'), JSON.stringify(lockfile), 'utf-8');
}

describe('lockfile-analysis', () => {
  it('returns skipped when no lockfile present', async () => {
    writePackageJson();
    const result = await lockfileAnalysisRunner.run({ projectPath: tmpDir, verbose: false });
    expect(result.status).toBe('skipped');
  });

  it('reports clean lockfile with no duplicates', async () => {
    writePackageJson({ express: '^4.18.0' });
    writeLockfile({
      'node_modules/express': { version: '4.18.2' },
      'node_modules/accepts': { version: '1.3.8' },
      'node_modules/array-flatten': { version: '1.1.1' },
    });
    const result = await lockfileAnalysisRunner.run({ projectPath: tmpDir, verbose: false });
    expect(result.status).toBe('success');
    const infoIssue = result.issues.find((i) => i.level === 'info');
    expect(infoIssue).toBeDefined();
    expect(infoIssue!.message).toContain('3 total');
    expect(infoIssue!.message).toContain('3 top-level');
    expect(infoIssue!.message).toContain('3 unique');
    expect(result.issues.filter((i) => i.category === 'duplicate' && i.level !== 'info')).toHaveLength(0);
  });

  it('detects duplicate packages at different versions', async () => {
    writePackageJson({ lodash: '^4.17.0' });
    writeLockfile({
      'node_modules/lodash': { version: '4.17.21' },
      'node_modules/express/node_modules/lodash': { version: '4.17.11' },
      'node_modules/express': { version: '4.18.2', dependencies: { lodash: '^4.17.0' } },
    });
    const result = await lockfileAnalysisRunner.run({ projectPath: tmpDir, verbose: false });
    expect(result.status).toBe('success');
    const dupIssues = result.issues.filter((i) => i.category === 'duplicate' && i.level !== 'info');
    expect(dupIssues.length).toBeGreaterThanOrEqual(1);
    expect(dupIssues.some((i) => i.message.includes('lodash'))).toBe(true);
  });

  it('correctly counts nested deps', async () => {
    writePackageJson({ express: '^4.18.0' });
    writeLockfile({
      'node_modules/express': { version: '4.18.2' },
      'node_modules/express/node_modules/accepts': { version: '1.3.8' },
      'node_modules/express/node_modules/debug': { version: '2.6.9' },
    });
    const result = await lockfileAnalysisRunner.run({ projectPath: tmpDir, verbose: false });
    const infoIssue = result.issues.find((i) => i.level === 'info');
    expect(infoIssue).toBeDefined();
    expect(infoIssue!.message).toContain('3 total');
    expect(infoIssue!.message).toContain('1 top-level');
    expect(infoIssue!.message).toContain('2 nested');
  });

  it('handles scoped packages (@scope/name)', async () => {
    writePackageJson({ '@angular/core': '^17.0.0' });
    writeLockfile({
      'node_modules/@angular/core': { version: '17.0.0' },
      'node_modules/@angular/common': { version: '17.0.0' },
      'node_modules/tslib': { version: '2.6.0' },
    });
    const result = await lockfileAnalysisRunner.run({ projectPath: tmpDir, verbose: false });
    expect(result.status).toBe('success');
    const infoIssue = result.issues.find((i) => i.level === 'info');
    expect(infoIssue!.message).toContain('3 total');
  });

  it('returns error for invalid JSON', async () => {
    writePackageJson();
    writeFileSync(join(tmpDir, 'package-lock.json'), 'not-json', 'utf-8');
    const result = await lockfileAnalysisRunner.run({ projectPath: tmpDir, verbose: false });
    expect(result.status).toBe('error');
  });

  it('detects multiple version duplicates (3+ versions)', async () => {
    writePackageJson({ lodash: '^4.0.0' });
    writeLockfile({
      'node_modules/lodash': { version: '4.17.21' },
      'node_modules/pkg-a/node_modules/lodash': { version: '4.17.11' },
      'node_modules/pkg-b/node_modules/lodash': { version: '4.17.9' },
      'node_modules/pkg-a': { version: '1.0.0' },
      'node_modules/pkg-b': { version: '2.0.0' },
    });
    const result = await lockfileAnalysisRunner.run({ projectPath: tmpDir, verbose: false });
    const dupIssues = result.issues.filter((i) => i.category === 'duplicate' && i.level !== 'info');
    const lodashIssue = dupIssues.find((i) => i.message.includes('lodash'));
    expect(lodashIssue).toBeDefined();
    expect(lodashIssue!.severity).toBe('medium'); // 3 versions → medium, 4+ would be high
  });
});
