import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { secretScanningRunner } from '../tools/secret-scanning.js';
import { clearConfigCache } from '../config.js';

let tmpDir: string;
const goodjobBin = join(tmpdir(), `goodjob-test-bin-${Date.now()}-${Math.random().toString(36).slice(2)}`);

beforeEach(() => {
  tmpDir = join(tmpdir(), `goodjob-test-ss-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  clearConfigCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  clearConfigCache();
});

function writeFixture(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

describe('secret-scanner', () => {
  it('is always available', () => {
    expect(secretScanningRunner.isAvailable('/tmp')).toBe(true);
  });

  it('returns clean on empty project', async () => {
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    expect(result.status).toBe('success');
    expect(result.issues.some((i) => i.level === 'info')).toBe(true);
  });

  it('detects AWS Access Key in a .js file', async () => {
    writeFixture('config.js', `
      const aws = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };
    `);
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const awsKeyIssues = result.issues.filter((i) => i.message.includes('AWS Access Key ID'));
    expect(awsKeyIssues.length).toBeGreaterThanOrEqual(1);
    expect(awsKeyIssues[0].severity).toBe('critical');
    expect(awsKeyIssues[0].level).toBe('error');
    expect(awsKeyIssues[0].file).toBe('config.js');
  });

  it('detects GitHub PAT in a .ts file', async () => {
    // Must be exactly 36 hex chars after ghp_
    writeFixture('app.ts', `
      const token = 'ghp_abcdefghijklmnopqrstuvwxyz012345abcd';
    `);
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const ghIssues = result.issues.filter((i) => i.message.includes('GitHub Personal Access Token'));
    expect(ghIssues.length).toBeGreaterThanOrEqual(1);
  });

  it('detects private RSA key in a .key file', async () => {
    writeFixture('server.key', `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Oc4Az0w3Y0cOqFJ+EG0G
-----END RSA PRIVATE KEY-----`);
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const keyIssues = result.issues.filter((i) => i.message.includes('RSA Private Key'));
    expect(keyIssues.length).toBeGreaterThanOrEqual(1);
  });

  it('detects MongoDB connection string', async () => {
    writeFixture('db.js', `
      const uri = 'mongodb://adminuser:supersecret123@cluster0.mongodb.net:27017/myapp';
    `);
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const mongoIssues = result.issues.filter((i) => i.message.includes('MongoDB Connection String'));
    expect(mongoIssues.length).toBeGreaterThanOrEqual(1);
  });

  it('detects Slack webhook URL', async () => {
    writeFixture('notif.js', `
      const webhook = 'https://hooks.slack.com/services/T00/B00/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0';
    `);
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const slackIssues = result.issues.filter((i) => i.message.includes('Slack Webhook URL'));
    expect(slackIssues.length).toBeGreaterThanOrEqual(1);
  });

  it('skips binary files', async () => {
    writeFixture('image.png', 'GIF89a');
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const binaryIssues = result.issues.filter((i) => i.file === 'image.png');
    expect(binaryIssues.length).toBe(0);
  });

  it('skips node_modules directory', async () => {
    const nmDir = join(tmpDir, 'node_modules', 'some-package');
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(join(nmDir, 'index.js'), "const key = 'AKIAIOSFODNN7EXAMPLE';", 'utf-8');
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const nmIssues = result.issues.filter((i) => i.file && i.file.includes('node_modules'));
    expect(nmIssues.length).toBe(0);
  });

  it('reports the correct file path', async () => {
    const subDir = join(tmpDir, 'src', 'config');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'secrets.ts'), "const ghp = 'ghp_abcdefghijklmnopqrstuvwxyz012345abcd';", 'utf-8');
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const issue = result.issues.find((i) => i.message.includes('GitHub Personal Access Token'));
    expect(issue).toBeDefined();
    expect(issue!.file).toMatch(/src\/config\/secrets\.ts$/);
  });

  it('reports line numbers', async () => {
    writeFixture('test.js', '// line 1\n// line 2\nconst key = "AKIAIOSFODNN7EXAMPLE";\n');
    const result = await secretScanningRunner.run({ projectPath: tmpDir, verbose: false });
    const issue = result.issues.find((i) => i.message.includes('AWS Access Key ID'));
    expect(issue).toBeDefined();
    expect(issue!.line).toBe(3);
  });
});
