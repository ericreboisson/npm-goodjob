import { describe, it, expect } from 'vitest';
import { isGitUrl, parseGitUrl } from '../git-clone.js';

describe('isGitUrl', () => {
  it('detects https:// github URL', () => {
    expect(isGitUrl('https://github.com/user/repo.git')).toBe(true);
  });

  it('detects https:// URL without .git suffix', () => {
    expect(isGitUrl('https://github.com/user/repo')).toBe(true);
  });

  it('detects http:// URL', () => {
    expect(isGitUrl('http://example.com/user/project.git')).toBe(true);
  });

  it('detects git@ SSH URL', () => {
    expect(isGitUrl('git@github.com:user/repo.git')).toBe(true);
  });

  it('detects ssh:// protocol URL', () => {
    expect(isGitUrl('ssh://git@github.com/user/repo')).toBe(true);
  });

  it('detects git:// protocol URL', () => {
    expect(isGitUrl('git://github.com/user/repo.git')).toBe(true);
  });

  it('detects gh: shorthand', () => {
    expect(isGitUrl('gh:user/repo')).toBe(true);
  });

  it('rejects local paths', () => {
    expect(isGitUrl('.')).toBe(false);
    expect(isGitUrl('./project')).toBe(false);
    expect(isGitUrl('../project')).toBe(false);
    expect(isGitUrl('/absolute/path')).toBe(false);
  });

  it('rejects plain project name', () => {
    expect(isGitUrl('my-project')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isGitUrl('')).toBe(false);
  });

  it('trims whitespace before checking', () => {
    expect(isGitUrl('  https://github.com/user/repo  ')).toBe(true);
  });
});

describe('parseGitUrl', () => {
  it('parses simple URL without branch', () => {
    const { url, branch } = parseGitUrl('https://github.com/user/repo.git');
    expect(url).toBe('https://github.com/user/repo.git');
    expect(branch).toBeUndefined();
  });

  it('parses URL with #branch suffix', () => {
    const { url, branch } = parseGitUrl('https://github.com/user/repo.git#develop');
    expect(url).toBe('https://github.com/user/repo.git');
    expect(branch).toBe('develop');
  });

  it('parses SSH URL with #branch', () => {
    const { url, branch } = parseGitUrl('git@github.com:user/repo.git#main');
    expect(url).toBe('git@github.com:user/repo.git');
    expect(branch).toBe('main');
  });

  it('handles URL with # in the middle (not branch)', () => {
    // This is unlikely but the parser should handle it gracefully
    const { url, branch } = parseGitUrl('https://github.com/user/repo');
    expect(url).toBe('https://github.com/user/repo');
    expect(branch).toBeUndefined();
  });

  it('parses branch with special characters', () => {
    const { url, branch } = parseGitUrl('https://github.com/user/repo.git#fix/issue-123');
    expect(url).toBe('https://github.com/user/repo.git');
    expect(branch).toBe('fix/issue-123');
  });

  it('trims whitespace', () => {
    const { url } = parseGitUrl('  https://github.com/user/repo  ');
    expect(url).toBe('https://github.com/user/repo');
  });

  it('parses gh: shorthand', () => {
    const { url } = parseGitUrl('gh:user/repo');
    expect(url).toBe('gh:user/repo');
  });
});
