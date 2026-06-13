import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, clearConfigCache } from '../config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `goodjob-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  clearConfigCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  clearConfigCache();
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const cfg = loadConfig(tmpDir);
    expect(cfg).toBeDefined();
    expect(cfg.license?.blocklist).toBeDefined();
    expect(cfg.license?.blocklist?.length).toBeGreaterThan(0);
    expect(cfg.healthScore?.weights?.security).toBe(5);
    expect(cfg.secretScanning?.disabled).toBe(false);
  });

  it('loads .goodjobrc from project path', () => {
    writeFileSync(
      join(tmpDir, '.goodjobrc'),
      JSON.stringify({
        license: { blocklist: ['gpl', 'agpl'] },
        tools: { disabled: ['eslint'] },
      }),
      'utf-8',
    );
    const cfg = loadConfig(tmpDir);
    expect(cfg.license?.blocklist).toEqual(['gpl', 'agpl']);
    expect(cfg.tools?.disabled).toEqual(['eslint']);
  });

  it('merges with defaults for missing fields', () => {
    writeFileSync(
      join(tmpDir, '.goodjobrc'),
      JSON.stringify({
        license: { blocklist: ['gpl'] },
      }),
      'utf-8',
    );
    const cfg = loadConfig(tmpDir);
    expect(cfg.license?.blocklist).toEqual(['gpl']);
    // Defaults should remain for other fields
    expect(cfg.healthScore?.weights?.security).toBe(5);
    expect(cfg.secretScanning?.disabled).toBe(false);
  });

  it('reads .goodjobrc.json as alternative', () => {
    writeFileSync(
      join(tmpDir, '.goodjobrc.json'),
      JSON.stringify({
        secretScanning: { disabled: true },
      }),
      'utf-8',
    );
    const cfg = loadConfig(tmpDir);
    expect(cfg.secretScanning?.disabled).toBe(true);
  });

  it('reads goodjob.config.json as third alternative', () => {
    writeFileSync(
      join(tmpDir, 'goodjob.config.json'),
      JSON.stringify({
        healthScore: { weights: { security: 10 } },
      }),
      'utf-8',
    );
    const cfg = loadConfig(tmpDir);
    expect(cfg.healthScore?.weights?.security).toBe(10);
  });

  it('healthScore thresholds are merged correctly', () => {
    writeFileSync(
      join(tmpDir, '.goodjobrc'),
      JSON.stringify({
        healthScore: {
          thresholds: { good: 14, warning: 10 },
        },
      }),
      'utf-8',
    );
    const cfg = loadConfig(tmpDir);
    expect(cfg.healthScore?.thresholds?.good).toBe(14);
    expect(cfg.healthScore?.thresholds?.warning).toBe(10);
  });

  it('handles malformed JSON gracefully', () => {
    writeFileSync(join(tmpDir, '.goodjobrc'), 'not-json', 'utf-8');
    const cfg = loadConfig(tmpDir);
    expect(cfg).toBeDefined();
    expect(cfg.healthScore?.weights?.security).toBe(5);
  });

  it('caches config per project path', () => {
    const cfg1 = loadConfig(tmpDir);
    const cfg2 = loadConfig(tmpDir);
    expect(cfg1).toBe(cfg2); // same reference
  });
});
