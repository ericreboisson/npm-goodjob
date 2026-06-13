// ---------------------------------------------------------------------------
// npm-goodjob — Git repository cloning utility
// Detects remote git URLs, shallow-clones to a temp directory,
// and auto-cleanups up on process exit.
// ---------------------------------------------------------------------------

import { execSync, execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

// Matches: https://, http://, git@, ssh://, git://, gh:
const GIT_URL_RE = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/|gh:)/;

const _tempDirs: string[] = [];

function _cleanupAll(): void {
  for (const dir of _tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

process.on('exit', _cleanupAll);

export interface CloneResult {
  /** Absolute path to the cloned repository */
  path: string;
  /** URL that was cloned */
  url: string;
  /** Remove the temporary directory */
  cleanup(): void;
}

/**
 * Check whether a string looks like a remote git URL.
 *
 * Supports:
 *   https://github.com/user/repo.git
 *   git@github.com:user/repo.git
 *   ssh://git@github.com/user/repo
 *   git://github.com/user/repo
 *   gh:user/repo
 */
export function isGitUrl(input: string): boolean {
  return GIT_URL_RE.test(input.trim());
}

/**
 * Parse a git URL with optional `#branch` suffix.
 *
 * Examples:
 *   parseGitUrl('https://github.com/user/repo.git')            → { url: 'https://...', branch: undefined }
 *   parseGitUrl('https://github.com/user/repo.git#develop')    → { url: 'https://...', branch: 'develop' }
 *   parseGitUrl('git@github.com:user/repo.git')                → { url: 'git@...', branch: undefined }
 */
export function parseGitUrl(input: string): { url: string; branch?: string } {
  const trimmed = input.trim();
  const hashIdx = trimmed.lastIndexOf('#');
  if (hashIdx > 0) {
    return { url: trimmed.slice(0, hashIdx), branch: trimmed.slice(hashIdx + 1) || undefined };
  }
  return { url: trimmed };
}

/**
 * Clone a git repository to a temporary directory.
 *
 * @param input - Git URL, optionally with `#branch` suffix
 * @param options - Clone options (depth, branch override)
 * @returns CloneResult with the temp path and a cleanup function
 *
 * The temp directory is automatically cleaned up on process exit.
 * Call `cleanup()` explicitly to remove it sooner.
 */
export function cloneRepo(input: string, options?: { depth?: number; branch?: string }): CloneResult {
  const parsed = parseGitUrl(input);
  const url = parsed.url;
  const branch = options?.branch ?? parsed.branch;
  const depth = options?.depth ?? 1;

  // Verify git is available
  try {
    execSync('git --version', { stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    throw new Error(
      'Git is not installed or not found in PATH.\n' +
        'Install git: https://git-scm.com/downloads',
    );
  }

  const tmpDir = mkdtempSync(`${tmpdir()}${sep}npm-goodjob-`);
  _tempDirs.push(tmpDir);

  const args = ['clone'];
  if (depth > 0) args.push('--depth', String(depth));
  if (branch) args.push('--branch', branch);
  args.push(url, tmpDir);

  try {
    execSync(`git ${args.join(' ')}`, { stdio: 'pipe', timeout: 120_000, encoding: 'utf-8' });
  } catch (err) {
    // Clean up temp dir on clone failure
    const idx = _tempDirs.indexOf(tmpDir);
    if (idx !== -1) _tempDirs.splice(idx, 1);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }

    if (err instanceof Error) {
      // Extract stderr from execSync error for a cleaner message
      const msg = err.message.replace(/^Command failed:.+?\n/, '').trim() || `Failed to clone ${url}`;
      throw new Error(msg);
    }
    throw err;
  }

  // Auto-install so tools can run (stdio pipe — caller may add logging)
  if (existsSync(resolve(tmpDir, 'package.json')) && !existsSync(resolve(tmpDir, 'node_modules'))) {
    const installer = existsSync(resolve(tmpDir, 'package-lock.json')) ? 'npm ci' : 'npm install';
    try {
      execSync(installer, { cwd: tmpDir, stdio: 'pipe', timeout: 300_000, encoding: 'utf-8' });
    } catch {
      // If install fails, individual tools will skip gracefully
    }
  }

  return {
    path: tmpDir,
    url,
    cleanup: () => {
      const idx = _tempDirs.indexOf(tmpDir);
      if (idx !== -1) _tempDirs.splice(idx, 1);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

/**
 * Async clone with progress callback. The progress callback receives
 * status lines from git (written to stderr by git clone --progress).
 */
export async function cloneRepoAsync(
  input: string,
  onProgress?: (line: string) => void,
  options?: { depth?: number; branch?: string },
): Promise<CloneResult> {
  const parsed = parseGitUrl(input);
  const url = parsed.url;
  const branch = options?.branch ?? parsed.branch;
  const depth = options?.depth ?? 1;

  // Verify git is available
  try {
    execSync('git --version', { stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    throw new Error(
      'Git is not installed or not found in PATH.\n' +
        'Install git: https://git-scm.com/downloads',
    );
  }

  const tmpDir = mkdtempSync(`${tmpdir()}${sep}npm-goodjob-`);
  _tempDirs.push(tmpDir);

  const args = ['clone'];
  if (depth > 0) args.push('--depth', String(depth));
  if (branch) args.push('--branch', branch);
  args.push('--progress', url, tmpDir);

  return new Promise<CloneResult>((resolve, reject) => {
    const child = execFile('git', args, { timeout: 120_000, encoding: 'utf-8' });

    // Capture progress lines from stderr
    let stderrBuf = '';
    if (child.stderr) {
      child.stderr.on('data', (chunk: string) => {
        stderrBuf += chunk;
        // Each line has \r — extract the latest progress line
        const lines = stderrBuf.split('\r');
        const last = lines[lines.length - 1]?.trim();
        if (last && onProgress) onProgress(last);
        // Keep only the last line for next frame
        stderrBuf = lines[lines.length - 1] ?? '';
      });
    }

    child.on('error', (err) => {
      const idx = _tempDirs.indexOf(tmpDir);
      if (idx !== -1) _tempDirs.splice(idx, 1);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        const idx = _tempDirs.indexOf(tmpDir);
        if (idx !== -1) _tempDirs.splice(idx, 1);
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
        reject(new Error(stderrBuf.trim() || `git clone failed with exit code ${code}`));
        return;
      }

      resolve({
        path: tmpDir,
        url,
        cleanup: () => {
          const idx = _tempDirs.indexOf(tmpDir);
          if (idx !== -1) _tempDirs.splice(idx, 1);
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        },
      });
    });
  });
}

/**
 * Resolve a project path argument.
 *
 * If the input is a remote git URL, it is cloned to a temp directory
 * and the temp path is returned. Otherwise the input is resolved
 * relative to the current working directory.
 *
 * @param input - Path or git URL (defaults to '.')
 * @returns Absolute local path
 */
export function resolveProjectPath(input?: string): string {
  const trimmed = (input ?? '.').trim();
  if (isGitUrl(trimmed)) {
    return cloneRepo(trimmed).path;
  }
  return resolve(process.cwd(), trimmed);
}
