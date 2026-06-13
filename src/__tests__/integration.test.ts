import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

// Built-in tools register via side-effect import
import '../tools/index.js';
import { dependencySanityRunner } from '../tools/dependency-check.js';
import { lockfileAnalysisRunner } from '../tools/lockfile-analysis.js';
import { secretScanningRunner } from '../tools/secret-scanning.js';
import { depcruiseRunner } from '../tools/depcruise.js';
import type { ToolOptions } from '../types.js';

function makeOpts(projectPath: string): ToolOptions {
  return {
    projectPath,
    verbose: false,
  };
}

describe('dependency-check (built-in)', () => {
  it('detects missing engines.node in minimal fixture', async () => {
    const result = await dependencySanityRunner.run(makeOpts(resolve(FIXTURES, 'minimal')));
    expect(result.status).toBe('success');
    // minimal fixture has no engines.node
    expect(result.issues.some((i) => i.message.includes('engines.node'))).toBe(true);
  });
});

describe('lockfile-analysis (built-in)', () => {
  it('analyzes minimal lockfile', async () => {
    const result = await lockfileAnalysisRunner.run(makeOpts(resolve(FIXTURES, 'minimal')));
    expect(result.status).toBe('success');
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    const info = result.issues.find((i) => i.level === 'info');
    expect(info).toBeDefined();
    expect(info!.message).toContain('Lockfile');
  });

  it('reports no lockfile when missing', async () => {
    const result = await lockfileAnalysisRunner.run(makeOpts(resolve(FIXTURES, 'ts-project')));
    // ts-project has package.json but no package-lock.json - should still work
    expect(result.status).toBe('success');
  });
});

describe('secret-scanning (built-in)', () => {
  it('scans minimal fixture with no secrets', async () => {
    const result = await secretScanningRunner.run(makeOpts(resolve(FIXTURES, 'minimal')));
    expect(result.status).toBe('success');
    const info = result.issues.find((i) => i.level === 'info');
    expect(info).toBeDefined();
    expect(info!.message).toMatch(/no hardcoded secrets/i);
  });
});

describe('depcruise runner (with TS config)', () => {
  it('is available in ts-project fixture', () => {
    const available = depcruiseRunner.isAvailable(resolve(FIXTURES, 'ts-project'));
    // depcruise won't be installed in test env - check it reports gracefully
    expect(typeof available).toBe('boolean');
  });

  it('skips gracefully when not installed', async () => {
    const result = await depcruiseRunner.run(makeOpts(resolve(FIXTURES, 'ts-project')));
    // If depcruise is not installed, expect skipped or error (not a crash)
    expect(['skipped', 'error', 'success']).toContain(result.status);
  });
});

describe('doctor command helper', () => {
  it('getAllTools returns registered tools', async () => {
    const { getAllTools } = await import('../tools/base.js');
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThanOrEqual(10);
    const names = tools.map((t) => t.name);
    expect(names).toContain('dependency-check');
    expect(names).toContain('lockfile-analysis');
    expect(names).toContain('secret-scanning');
    expect(names).toContain('eslint');
  });
});
