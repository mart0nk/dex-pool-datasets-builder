import type { Command } from 'commander';
import { loadDexBuildConfig } from '../../config/load-dex-build-config.js';
import { resolveDexBuildConfig } from '../../config/resolve-dex-build-config.js';
import { buildDexPoolDataset } from '../../orchestrator/build-dex-pool-dataset.js';
import type { DexBuildRunReport } from '../../orchestrator/dex-build-result.types.js';
import type { DexPoolQualitySummary } from '../../types/dex-pool-dataset.types.js';
import { printLine, printError, printJson } from '../cli-output.js';

type BuildCommandOptions = {
  config: string;
  profile?: string;
  pool?: string;
  output?: string;
  json?: boolean;
  verbose?: boolean;
};

function formatQualityFailures(quality: DexPoolQualitySummary): string {
  const failures: string[] = [];
  if (quality.reorgConflicts > 0) failures.push(`reorgConflicts: ${quality.reorgConflicts}`);
  if (quality.invalidLogs > 0) failures.push(`invalidLogs: ${quality.invalidLogs}`);
  if (quality.duplicateLogs > 0) failures.push(`duplicateLogs: ${quality.duplicateLogs}`);
  if (quality.missingBlockTimestamps > 0) failures.push(`missingBlockTimestamps: ${quality.missingBlockTimestamps}`);
  if (quality.incompleteBlockRanges > 0) failures.push(`incompleteBlockRanges: ${quality.incompleteBlockRanges}`);
  if (quality.extremeWickCandles > 0) failures.push(`extremeWickCandles: ${quality.extremeWickCandles}`);
  if (quality.noTradeIntervals > 0) failures.push(`noTradeIntervals: ${quality.noTradeIntervals}`);
  return failures.join(', ');
}

export function formatRunReport(report: DexBuildRunReport, verbose: boolean): string {
  const lines: string[] = [];

  const hasErrors = report.status === 'failed';
  lines.push(hasErrors ? 'Dataset build completed with errors' : 'Dataset build completed');
  lines.push('');
  lines.push(`Dataset: ${report.datasetId}`);
  if (report.config.profile !== undefined) {
    lines.push(`Profile: ${report.config.profile}`);
  }
  lines.push(`Output: ${report.config.outputUri}`);

  if (report.pools.length > 0) {
    lines.push('');
    lines.push('Pools:');
    for (const pool of report.pools) {
      const qualityLabel = pool.quality.passed ? 'passed' : 'FAILED';
      const statusIcon = pool.quality.passed ? '✓' : '✗';
      lines.push(`  ${statusIcon} ${pool.poolId} (${pool.symbol})`);
      lines.push(`    Timeframes: ${pool.timeframes.join(', ')}`);
      if (pool.quality.passed) {
        lines.push(`    Quality: ${qualityLabel}`);
      } else {
        const failures = formatQualityFailures(pool.quality);
        lines.push(`    Quality: ${qualityLabel}${failures ? ` (${failures})` : ''}`);
      }
      if (pool.writtenObjects.length > 0) {
        lines.push(`    Objects:`);
        for (const obj of pool.writtenObjects) {
          // Show a short path (last two segments) to keep output tidy
          const parts = obj.key.split('/');
          const shortKey = parts.length >= 2 ? parts.slice(-2).join('/') : obj.key;
          lines.push(`      ${shortKey}`);
        }
      }
      if (verbose) {
        lines.push(`    Block range: ${pool.blockRange.fromBlock} – ${pool.blockRange.toBlock}`);
      }
    }
  }

  if (report.fatalErrors.length > 0) {
    lines.push('');
    lines.push('Fatal errors:');
    for (const err of report.fatalErrors) {
      lines.push(`  - [${err.code}] ${err.message}`);
    }
  }

  return lines.join('\n');
}

export async function runBuildCommand(options: BuildCommandOptions): Promise<void> {
  const { config: configPath, profile, pool: poolFilter, output: outputOverride, json, verbose } = options;

  // 1. Load config
  const rawConfig = await loadDexBuildConfig(configPath).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (json === true) {
      printJson({ error: message });
    } else {
      printError(`Error loading config: ${message}`);
    }
    process.exit(1);
  });

  // 2. Resolve config (merge profile, env, overrides)
  let resolved: ReturnType<typeof resolveDexBuildConfig>;
  try {
    resolved = resolveDexBuildConfig({ config: rawConfig, profile, outputOverride });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('CONFIG_UNKNOWN_PROFILE:')) {
      const profileName = message.replace('CONFIG_UNKNOWN_PROFILE:', '');
      printError(`Unknown profile: "${profileName}". Check your config file's profiles section.`);
    } else if (message.startsWith('CONFIG_RPC_ENV_MISSING:')) {
      const envName = message.replace('CONFIG_RPC_ENV_MISSING:', '');
      printError(`RPC environment variable not set: ${envName}. Export it before running build.`);
    } else {
      printError(`Error resolving config: ${message}`);
    }
    process.exit(1);
  }

  // 3. Apply --pool filter
  if (poolFilter !== undefined) {
    if (!resolved.build.pools.includes(poolFilter)) {
      printError(`Pool not found in config: "${poolFilter}". Available pools: ${resolved.build.pools.join(', ')}`);
      process.exit(1);
    }
    resolved.build.pools = [poolFilter];
  }

  // 4. Run build
  const { runReport, status } = await buildDexPoolDataset(resolved).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (json === true) {
      printJson({ error: message });
    } else {
      printError(`Build failed: ${message}`);
    }
    process.exit(1);
  });

  // 5. Print output
  if (json === true) {
    printJson(runReport);
  } else {
    printLine(formatRunReport(runReport, verbose === true));
  }

  // 6. Exit code
  process.exit(status === 'completed' ? 0 : 1);
}

export function registerBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Build DEX pool dataset')
    .requiredOption('-c, --config <path>', 'Path to dex-dataset.config.json')
    .option('--profile <name>', 'Config profile to use')
    .option('--pool <id>', 'Build only this pool ID (overrides config pools list)')
    .option('--output <uri>', 'Output URI override (local:// or s3://)')
    .option('--json', 'Output run report as JSON')
    .option('--verbose', 'Verbose output')
    .action(async (opts: BuildCommandOptions) => {
      await runBuildCommand(opts);
    });
}
