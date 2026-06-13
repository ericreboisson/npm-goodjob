declare module 'depcheck' {
  interface DepcheckResult {
    dependencies: string[];
    devDependencies: string[];
    missing: Record<string, string[]>;
    using: Record<string, string[]>;
    invalidFiles: Record<string, string>;
    invalidDirs: Record<string, string>;
  }

  interface DepcheckOptions {
    ignoreBinPackage?: boolean;
    skipMissing?: boolean;
    ignoreMatches?: string[];
    /** @deprecated */
    ignoreDirs?: string[];
    parsers?: Record<string, unknown>;
    detectors?: Record<string, unknown>;
    specials?: Array<Record<string, unknown>>;
  }

  export default function depcheck(
    rootDir: string,
    options?: DepcheckOptions,
  ): Promise<DepcheckResult>;
}
