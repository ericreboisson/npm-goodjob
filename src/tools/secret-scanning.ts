// ---------------------------------------------------------------------------
// npm-goodjob — Built-in secret scanner
// Scans the project tree for hardcoded secrets (API keys, tokens, passwords,
// certificates) using regex patterns. Zero external dependencies, zero
// network calls. Respects .goodjobrc exclusions.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { ToolRunner, ToolResult, ToolOptions, Issue, GoodjobConfig } from '../types.js';
import { registerTool, buildResult, skippedResult } from './base.js';
import { loadConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface ScanPattern {
  name: string;
  severity: 'critical' | 'high' | 'medium';
  regex: RegExp;
  /** Only scan files with these extensions (undefined = all text files) */
  extensions?: string[];
  /** Minimum confidence to report */
  confidence: 'high' | 'medium';
}

const PATTERNS: ScanPattern[] = [
  // — AWS —
  {
    name: 'AWS Access Key ID',
    severity: 'critical',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    confidence: 'high',
  },
  {
    name: 'AWS Secret Access Key',
    severity: 'critical',
    regex: /(?:aws|amazon)(?:.{0,20})?['\"][0-9a-zA-Z\/+]{40}['\"]/gi,
    confidence: 'high',
  },

  // — GitHub —
  {
    name: 'GitHub Personal Access Token',
    severity: 'critical',
    regex: /\bghp_[0-9a-zA-Z]{36}\b/g,
    confidence: 'high',
  },
  {
    name: 'GitHub OAuth Access Token',
    severity: 'critical',
    regex: /\bgho_[0-9a-zA-Z]{36}\b/g,
    confidence: 'high',
  },
  {
    name: 'GitHub App Token',
    severity: 'critical',
    regex: /\bghs_[0-9a-zA-Z]{36}\b/g,
    confidence: 'high',
  },
  {
    name: 'GitHub Refresh Token',
    severity: 'critical',
    regex: /\bghr_[0-9a-zA-Z]{36}\b/g,
    confidence: 'high',
  },

  // — GitLab —
  {
    name: 'GitLab Personal Access Token',
    severity: 'critical',
    regex: /\bglpat-[0-9a-zA-Z\-_]{20,40}\b/g,
    confidence: 'high',
  },

  // — Slack —
  {
    name: 'Slack Bot Token',
    severity: 'high',
    regex: /\bxoxb-[0-9a-zA-Z\-_]{50,200}\b/g,
    confidence: 'high',
  },
  {
    name: 'Slack Webhook URL',
    severity: 'high',
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]{40,80}/g,
    confidence: 'high',
  },

  // — Discord —
  {
    name: 'Discord Bot Token',
    severity: 'high',
    regex: /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b/g,
    confidence: 'medium',
  },

  // — npm —
  {
    name: 'npm Access Token',
    severity: 'high',
    regex: /\bnpm_[0-9a-zA-Z]{36}\b/g,
    confidence: 'high',
  },

  // — Stripe —
  {
    name: 'Stripe Live API Key',
    severity: 'critical',
    regex: /\b(?:sk|pk)_live_[0-9a-zA-Z]{24,60}\b/g,
    confidence: 'high',
  },
  {
    name: 'Stripe Test API Key',
    severity: 'medium',
    regex: /\b(?:sk|pk)_test_[0-9a-zA-Z]{24,60}\b/g,
    confidence: 'high',
  },

  // — Twilio —
  {
    name: 'Twilio API Key',
    severity: 'high',
    regex: /\bSK[0-9a-fA-F]{32}\b/g,
    confidence: 'high',
  },

  // — Google —
  {
    name: 'Google API Key',
    severity: 'high',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    confidence: 'high',
  },
  {
    name: 'Google OAuth Client Secret',
    severity: 'high',
    regex: /\bGOCSPX-[0-9A-Za-z\-_]{20,40}\b/g,
    confidence: 'high',
  },

  // — Heroku —
  {
    name: 'Heroku API Key',
    severity: 'high',
    regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    confidence: 'medium',
  },

  // — Private keys —
  {
    name: 'RSA Private Key',
    severity: 'critical',
    regex: /-----BEGIN\s+RSA\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+RSA\s+PRIVATE\s+KEY-----/g,
    confidence: 'high',
    extensions: ['.key', '.pem', '.txt', '.md', '', '.json', '.yaml', '.yml', '.config', '.env'],
  },
  {
    name: 'SSH Private Key',
    severity: 'critical',
    regex: /-----BEGIN\s+(?:OPENSSH|EC)\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:OPENSSH|EC)\s+PRIVATE\s+KEY-----/g,
    confidence: 'high',
    extensions: ['.key', '.pem', '.txt', '.md', '', '.json', '.yaml', '.yml', '.config'],
  },
  {
    name: 'PGP Private Key',
    severity: 'critical',
    regex: /-----BEGIN\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----[\s\S]*?-----END\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----/g,
    confidence: 'high',
  },

  // — Generic password in code (high threshold to avoid noise) —
  {
    name: 'Hardcoded Password',
    severity: 'high',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['\"][^'\"\s]{8,}['\"]/gi,
    confidence: 'medium',
  },
  {
    name: 'Hardcoded Secret',
    severity: 'high',
    regex: /(?:secret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"\s]{16,}['\"]/gi,
    confidence: 'medium',
  },

  // — Connection strings —
  {
    name: 'MongoDB Connection String',
    severity: 'critical',
    regex: /mongodb(?:\+srv)?:\/\/[^\s]{8,80}:[^\s\/@]{3,80}@[^\s]{3,80}/g,
    confidence: 'high',
  },
  {
    name: 'MySQL/PostgreSQL Connection String',
    severity: 'high',
    regex: /(?:mysql|postgres|postgresql):\/\/[^\s]{3,80}:[^\s\/@]{3,80}@[^\s]{3,80}/g,
    confidence: 'high',
  },
  {
    name: 'Redis Connection String',
    severity: 'high',
    regex: /redis:\/\/[^\s]{3,80}:[^\s\/@]{3,80}@[^\s]{3,80}/g,
    confidence: 'high',
  },

  // — JWT (high entropy) —
  {
    name: 'JWT Token in Code',
    severity: 'high',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    confidence: 'medium',
  },

  // — .env file with secrets (flag the whole file) —
  {
    name: 'AWS Profile Keys in .env',
    severity: 'high',
    regex: /^AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\s*=/gm,
    confidence: 'high',
    extensions: ['.env'],
  },
];

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.next', '.nuxt',
  'dist', 'build', '.cache', 'coverage', '.nyc_output',
  '__pycache__', '.tox', 'vendor', '.gradle', 'target',
  'bin', 'obj', '.serverless', '.terraform',
  '.angular',
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.java', '.go', '.rs', '.php',
  '.json', '.yaml', '.yml', '.xml', '.toml', '.ini', '.cfg', '.conf',
  '.env', '.env.example', '.env.local',
  '.md', '.txt', '.rst', '.html', '.css', '.scss', '.less',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.yml', '.yaml',
  '.gradle', '.properties',
  '.dockerfile', 'dockerfile',
  '.key', '.pem', '.cert', '.crt', '.p12', '.pfx', '.jks',
]);

// Binary extension check
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp',
  '.ttf', '.woff', '.woff2', '.eot',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.o', '.so', '.dll', '.dylib', '.exe',
  '.map', '.min.js', '.min.css',
]);

function isBinaryExt(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isTextExt(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  // No extension or a known text extension
  return ext === '' || TEXT_EXTENSIONS.has(ext);
}

interface ScanMatch {
  pattern: ScanPattern;
  line: number;
  column: number;
  match: string;
}

function scanFile(filePath: string, patterns: ScanPattern[]): ScanMatch[] {
  const matches: ScanMatch[] = [];

  // Skip binary files early
  if (isBinaryExt(filePath)) return matches;

  // Skip known binary files by extension, read only text-like files
  if (!isTextExt(filePath)) return matches;

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    // Binary or unreadable
    return matches;
  }

  // Skip files larger than 500KB
  if (content.length > 500_000) return matches;

  const lines = content.split('\n');

  for (const pattern of patterns) {
    // For multiline regexes, run on full content
    if (pattern.regex.multiline === false || pattern.name.includes('Private Key') || pattern.name.includes('PGP')) {
      // Reset regex state
      pattern.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      // For multiline patterns, test on full content
      if (pattern.name.includes('Private Key') || pattern.name.includes('PGP')) {
        const fullContent = content;
        pattern.regex.lastIndex = 0;
        while ((m = pattern.regex.exec(fullContent)) !== null) {
          // Find line number — count newlines before match
          const beforeMatch = fullContent.slice(0, m.index);
          const line = (beforeMatch.match(/\n/g) || []).length + 1;
          const lastNewline = beforeMatch.lastIndexOf('\n');
          const column = lastNewline >= 0 ? m.index - lastNewline : m.index;
          matches.push({ pattern, line, column: column + 1, match: m[0].slice(0, 120) });
        }
      } else {
        // Line-by-line patterns
        for (let i = 0; i < lines.length; i++) {
          pattern.regex.lastIndex = 0;
          while ((m = pattern.regex.exec(lines[i])) !== null) {
            matches.push({
              pattern,
              line: i + 1,
              column: m.index + 1,
              match: m[0].slice(0, 120),
            });
          }
        }
      }
    } else {
      // Line-by-line scanning for single-line patterns
      for (let i = 0; i < lines.length; i++) {
        pattern.regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.regex.exec(lines[i])) !== null) {
          matches.push({
            pattern,
            line: i + 1,
            column: m.index + 1,
            match: m[0].slice(0, 120),
          });
        }
      }
    }
  }

  return matches;
}

function walkDir(
  dirPath: string,
  basePath: string,
  skipDirs: Set<string>,
): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (!skipDirs.has(entry)) {
        files.push(...walkDir(fullPath, basePath, skipDirs));
      }
    } else if (stat.isFile()) {
      // Skip by extension
      if (!isBinaryExt(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runSecretScan(options: ToolOptions): Promise<ToolResult> {
  const start = Date.now();
  const projectPath = options.projectPath;

  // Load config for exclusions / extra patterns
  let config: GoodjobConfig = {};
  try {
    config = loadConfig(projectPath);
  } catch {
    // Ignore — defaults are fine
  }

  // Build skip directories
  const skipDirs = new Set(DEFAULT_SKIP_DIRS);
  if (config.secretScanning?.excludePaths) {
    for (const p of config.secretScanning.excludePaths) {
      skipDirs.add(p);
    }
  }

  // Build pattern list
  let patterns = [...PATTERNS];

  // Add extra patterns from config
  if (config.secretScanning?.extraPatterns) {
    for (const ep of config.secretScanning.extraPatterns) {
      try {
        const regex = new RegExp(ep.pattern, 'g');
        patterns.push({
          name: ep.name,
          severity: ep.severity,
          regex,
          confidence: 'medium',
        });
      } catch {
        // Invalid regex, skip
      }
    }
  }

  // Check if whole scan is disabled
  if (config.secretScanning?.disabled) {
    return skippedResult(
      'secret-scanning',
      'Secret Scanning',
      'Disabled by .goodjobrc configuration',
    );
  }

  const files = walkDir(projectPath, projectPath, skipDirs);
  const issues: Issue[] = [];

  for (const filePath of files) {
    const relativePath = relative(projectPath, filePath);
    const fileMatches = scanFile(filePath, patterns);

    for (const fm of fileMatches) {
      const isCritical = fm.pattern.severity === 'critical';

      issues.push({
        level: isCritical ? 'error' : 'warning',
        tool: 'secret-scanning',
        category: 'security',
        severity: fm.pattern.severity,
        message: `${fm.pattern.name} detected — ${fm.match.slice(0, 60)}`,
        file: relativePath,
        line: fm.line,
        detail: `Pattern: ${fm.pattern.name} (confidence: ${fm.pattern.confidence}). ` +
          `Found at line ${fm.line}, column ${fm.column}. ` +
          (isCritical ? 'This should be revoked and removed from version control immediately.' : ''),
      });
    }
  }

  // Info if nothing found
  if (issues.length === 0) {
    issues.push({
      level: 'info',
      tool: 'secret-scanning',
      category: 'security',
      severity: 'low',
      message: 'No hardcoded secrets detected',
      detail: `Scanned ${files.length} files across the project tree.`,
    });
  }

  return buildResult('secret-scanning', 'Secret Scanning', 'built-in', issues, Date.now() - start);
}

export const secretScanningRunner: ToolRunner = {
  name: 'secret-scanning',
  label: 'Secret Scanning',
  isAvailable(_cwd: string): boolean {
    return true; // built-in, always available
  },
  async run(options: ToolOptions): Promise<ToolResult> {
    return runSecretScan(options);
  },
};

registerTool(secretScanningRunner);
