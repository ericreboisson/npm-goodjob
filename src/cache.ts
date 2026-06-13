// ---------------------------------------------------------------------------
// npm-goodjob — Cache engine
// Caches tool results per project based on content hash of inputs
// (package-lock.json, .goodjobrc, tsconfig, etc.)
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolResult } from './types.js';

const CACHE_DIR = '.goodjob-cache';

interface CacheEntry {
  key: string;
  timestamp: number;
  goodjobVersion: string;
  results: Record<string, ToolResult>;
}

/** Compute a deterministic cache key from project file hashes + tool selection */
export function computeCacheKey(projectPath: string, toolNames: string[]): string {
  const hash = createHash('sha256');

  const files = [
    'package-lock.json',
    'package.json',
    '.goodjobrc',
    '.goodjobrc.json',
    'goodjob.config.json',
    'tsconfig.json',
  ];
  for (const file of files) {
    const filePath = resolve(projectPath, file);
    if (existsSync(filePath)) {
      try {
        hash.update(readFileSync(filePath));
      } catch {
        // skip unreadable files
      }
    }
  }

  hash.update(toolNames.sort().join(','));
  return hash.digest('hex');
}

/** Load cached results for a given project state key. Returns null on miss. */
export function loadCachedResults(projectPath: string, key: string): Record<string, ToolResult> | null {
  const cachePath = resolve(projectPath, CACHE_DIR, `${key}.json`);
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);
    if (entry.key === key) return entry.results;
  } catch {
    // Corrupt cache — treat as miss
  }
  return null;
}

/** Persist tool results for a given project state key */
export function saveCachedResults(
  projectPath: string,
  key: string,
  results: Record<string, ToolResult>,
  goodjobVersion: string,
): void {
  const cacheDir = resolve(projectPath, CACHE_DIR);
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const entry: CacheEntry = {
    key,
    timestamp: Date.now(),
    goodjobVersion,
    results,
  };
  writeFileSync(resolve(cacheDir, `${key}.json`), JSON.stringify(entry));
}

/** Clear all cached results for a project */
export function clearCache(projectPath: string): void {
  const cacheDir = resolve(projectPath, CACHE_DIR);
  if (!existsSync(cacheDir)) return;
  for (const file of readdirSync(cacheDir)) {
    rmSync(resolve(cacheDir, file));
  }
}
