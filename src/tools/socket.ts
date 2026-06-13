import type { ToolRunner, Issue, ToolOptions, ToolResult } from '../types.js';
import {
  registerTool,
  isBinaryAvailable,
  isNpxAvailable,
  runToolCommand,
  runNpxToolCommand,
  buildResult,
  skippedResult,
  getBinaryVersion,
} from './base.js';

interface SocketAlert {
  key: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  pkg: { name: string; version?: string };
  file?: string;
  details?: string;
}

interface SocketScanJson {
  alerts?: SocketAlert[];
  errors?: Array<{ pkg: string; message: string }>;
}

export const socketRunner: ToolRunner = {
  name: 'socket',
  label: 'Socket.dev',

  isAvailable(cwd: string): boolean {
    return isBinaryAvailable('socket', cwd) || isNpxAvailable();
  },

  async run(options: ToolOptions): Promise<ToolResult> {
    const start = Date.now();

    if (!this.isAvailable(options.projectPath)) {
      return skippedResult(
        'socket', 'Socket.dev',
        'socket CLI not found and npx is unavailable',
      );
    }

    const hasLocal = isBinaryAvailable('socket', options.projectPath);
    const useNpx = !hasLocal && isNpxAvailable();

    // socket scan needs --json output flag
    const result = useNpx
      ? await runNpxToolCommand('@socketsecurity/cli', ['scan', '--json'], options)
      : await runToolCommand('socket', ['scan', '--json'], options);

    if (!result) {
      return {
        tool: 'socket',
        label: 'Socket.dev',
        version: 'N/A',
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: 'Failed to run socket — binary not found or not executable',
      };
    }

    if (result.exitCode !== 0 && !result.stdout.trim()) {
      return {
        tool: 'socket',
        label: 'Socket.dev',
        version: useNpx ? 'via npx' : getBinaryVersion('socket', options.projectPath),
        status: 'error',
        durationMs: Date.now() - start,
        issues: [],
        errorMessage: (result.stderr || 'Non-zero exit code').slice(0, 500),
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout) {
      return buildResult('socket', 'Socket.dev', useNpx ? 'via npx' : getBinaryVersion('socket', options.projectPath), [], Date.now() - start);
    }

    let parsed: SocketScanJson;
    try {
      parsed = JSON.parse(stdout) as SocketScanJson;
    } catch {
      return buildResult('socket', 'Socket.dev', useNpx ? 'via npx' : getBinaryVersion('socket', options.projectPath), [], Date.now() - start);
    }

    const alerts = parsed.alerts ?? [];
    const issues: Issue[] = alerts.map((a) => ({
      level: a.severity === 'critical' || a.severity === 'high' ? 'error' : 'warning',
      tool: 'socket',
      category: 'security' as const,
      severity: a.severity === 'critical' ? 'critical' as const
        : a.severity === 'high' ? 'high' as const
        : a.severity === 'medium' ? 'medium' as const
        : 'low' as const,
      message: a.pkg ? `${a.pkg.name}: ${a.title}` : a.title,
      detail: a.details ?? a.category,
      package: a.pkg?.name,
      version: a.pkg?.version,
      file: a.file,
    }));

    const version = useNpx ? 'via npx' : getBinaryVersion('socket', options.projectPath);
    return buildResult('socket', 'Socket.dev', version, issues, Date.now() - start);
  },
};

registerTool(socketRunner);
