import type { Command } from "commander";
import type { Timeframe } from "../../contracts/timeframe.js";
import { loadDexBuildConfig } from "../../config/load-dex-build-config.js";
import { resolveDexBuildConfig } from "../../config/resolve-dex-build-config.js";
import type {
  DexBuildConfig,
  ResolvedDexBuildConfig,
} from "../../config/dex-build-config.types.js";
import { resolveSimpleDexBuildConfig } from "../../simple/resolve-simple-build-config.js";
import type { SimpleDexBuildInput } from "../../simple/simple-build.types.js";
import { buildDexPoolDataset } from "../../orchestrator/build-dex-pool-dataset.js";
import type { DexBuildProgressEvent } from "../../orchestrator/dex-build-progress.types.js";
import type { DexBuildRunReport } from "../../orchestrator/dex-build-result.types.js";
import type { DexPoolQualitySummary } from "../../types/dex-pool-dataset.types.js";
import { printLine, printError, printJson } from "../cli-output.js";

type BuildCommandOptions = {
  config?: string;
  profile?: string;
  pool?: string;
  output?: string;
  json?: boolean;
  verbose?: boolean;

  chain?: string;
  pair?: string;
  fee?: string;
  token0?: string;
  token1?: string;
  from?: string;
  to?: string;
  days?: string;
  rpc?: string;
  rpcEnv?: string;
  out?: string;
  base?: string;
  quote?: string;
  timeframes?: string;
  baseTimeframe?: string;
  chunkSize?: string;
  datasetId?: string;
};

function formatQualityFailures(quality: DexPoolQualitySummary): string {
  const failures: string[] = [];

  if (quality.reorgConflicts > 0) {
    failures.push(`reorgConflicts: ${quality.reorgConflicts}`);
  }

  if (quality.invalidLogs > 0) {
    failures.push(`invalidLogs: ${quality.invalidLogs}`);
  }

  if (quality.duplicateLogs > 0) {
    failures.push(`duplicateLogs: ${quality.duplicateLogs}`);
  }

  if (quality.missingBlockTimestamps > 0) {
    failures.push(`missingBlockTimestamps: ${quality.missingBlockTimestamps}`);
  }

  if (quality.incompleteBlockRanges > 0) {
    failures.push(`incompleteBlockRanges: ${quality.incompleteBlockRanges}`);
  }

  if (quality.extremeWickCandles > 0) {
    failures.push(`extremeWickCandles: ${quality.extremeWickCandles}`);
  }

  return failures.join(", ");
}

function printProgressEvent(event: DexBuildProgressEvent): void {
  switch (event.type) {
    case "build_start":
      printLine(`Starting build: ${event.datasetId}`);
      break;

    case "pool_start":
      printLine(`Processing pool ${event.poolId} (${event.poolAddress})`);
      break;

    case "logs_read_start":
      printLine(
        `Reading logs: ${event.chunks} chunks, blocks ${event.fromBlock} – ${event.toBlock}`,
      );
      break;

    case "logs_chunk_start":
      printLine(
        `Reading logs chunk ${event.index}/${event.total}: ${event.fromBlock} – ${event.toBlock}`,
      );
      break;

    case "logs_chunk_done":
      printLine(
        `Logs chunk ${event.index}/${event.total} done: ${event.logCount} logs`,
      );
      break;

    case "timestamps_progress":
      printLine(
        `Fetching timestamps: ${event.done}${event.total > 0 ? `/${event.total}` : ""} ` +
          `(cache hits=${event.cacheHits}, misses=${event.cacheMisses})`,
      );
      break;

    case "swaps_decoded":
      printLine(`Decoded swaps: ${event.swaps}`);
      break;

    case "candles_build_start":
      printLine(`Building ${event.timeframe} candles...`);
      break;

    case "candles_fill_done":
      printLine(`Filled no-trade intervals: ${event.filledNoTradeIntervals}`);
      break;

    case "timeframe_aggregate_done":
      printLine(`Aggregated ${event.timeframe}: ${event.candles} candles`);
      break;

    case "write_start":
      printLine(`Writing output for ${event.poolId}...`);
      break;

    case "write_done":
      printLine(`Wrote ${event.objects} objects for ${event.poolId}`);
      break;

    case "build_done":
      printLine(`Build ${event.status}: ${event.datasetId}`);
      break;
  }
}

export function formatRunReport(
  report: DexBuildRunReport,
  verbose: boolean,
): string {
  const lines: string[] = [];
  const hasErrors = report.status === "failed";

  lines.push(
    hasErrors
      ? "Dataset build completed with errors"
      : "Dataset build completed",
  );
  lines.push("");
  lines.push(`Dataset: ${report.datasetId}`);

  if (report.config.profile !== undefined) {
    lines.push(`Profile: ${report.config.profile}`);
  }

  lines.push(`Output: ${report.config.outputUri}`);

  if (report.pools.length > 0) {
    lines.push("");
    lines.push("Pools:");

    for (const pool of report.pools) {
      const qualityLabel = pool.quality.passed ? "passed" : "FAILED";
      const statusIcon = pool.quality.passed ? "✓" : "✗";

      lines.push(` ${statusIcon} ${pool.poolId} (${pool.symbol})`);
      lines.push(`   Timeframes: ${pool.timeframes.join(", ")}`);

      if (pool.quality.passed) {
        lines.push(`   Quality: ${qualityLabel}`);

        if (pool.quality.noTradeIntervals > 0) {
          lines.push(
            `   Filled no-trade intervals: ${pool.quality.noTradeIntervals}`,
          );
        }
      } else {
        const failures = formatQualityFailures(pool.quality);
        lines.push(
          `   Quality: ${qualityLabel}${failures ? ` (${failures})` : ""}`,
        );

        if (pool.quality.noTradeIntervals > 0) {
          lines.push(
            `   Filled no-trade intervals: ${pool.quality.noTradeIntervals}`,
          );
        }
      }

      if (pool.writtenObjects.length > 0) {
        lines.push("   Objects:");

        for (const obj of pool.writtenObjects) {
          const parts = obj.key.split("/");
          const shortKey =
            parts.length >= 2 ? parts.slice(-2).join("/") : obj.key;
          lines.push(`     ${shortKey}`);
        }
      }

      if (verbose) {
        lines.push(
          `   Block range: ${pool.blockRange.fromBlock} – ${pool.blockRange.toBlock}`,
        );
      }
    }
  }

  if (report.fatalErrors.length > 0) {
    lines.push("");
    lines.push("Fatal errors:");

    for (const err of report.fatalErrors) {
      lines.push(` - [${err.code}] ${err.message}`);
    }
  }

  return lines.join("\n");
}

export async function runBuildCommand(
  options: BuildCommandOptions,
): Promise<void> {
  const { json, verbose } = options;
  let resolved: ResolvedDexBuildConfig;

  try {
    resolved =
      options.config !== undefined
        ? await resolveBuildConfigFromFile(options)
        : await resolveSimpleBuildConfigFromCli(options);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (json === true) {
      printJson({ error: message });
    } else {
      printError(`Error resolving build: ${message}`);
    }

    process.exit(1);
  }

  try {
    const { runReport, status } = await buildDexPoolDataset(resolved, {
      onProgress: verbose === true ? printProgressEvent : undefined,
    });

    if (json === true) {
      printJson(runReport);
    } else {
      printLine(formatRunReport(runReport, verbose === true));
    }

    process.exit(status === "completed" ? 0 : 1);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (json === true) {
      printJson({ error: message });
    } else {
      printError(`Build failed: ${message}`);
    }

    process.exit(1);
  }
}

async function resolveBuildConfigFromFile(
  options: BuildCommandOptions,
): Promise<ResolvedDexBuildConfig> {
  if (options.config === undefined) {
    throw new Error("CONFIG_PATH_REQUIRED");
  }

  const rawConfig = (await loadDexBuildConfig(options.config)) as unknown;

  if (isAdvancedDexBuildConfig(rawConfig)) {
    const resolved = resolveDexBuildConfig({
      config: rawConfig,
      profile: options.profile,
      outputOverride: options.output,
    });

    if (options.pool !== undefined) {
      if (!resolved.build.pools.includes(options.pool)) {
        throw new Error(
          `POOL_NOT_FOUND_IN_CONFIG:${options.pool}:${resolved.build.pools.join(",")}`,
        );
      }

      resolved.build.pools = [options.pool];
    }

    return resolved;
  }

  return resolveSimpleDexBuildConfig(simpleInputFromConfig(rawConfig, options));
}

async function resolveSimpleBuildConfigFromCli(
  options: BuildCommandOptions,
): Promise<ResolvedDexBuildConfig> {
  if (options.chain === undefined) {
    throw new Error("SIMPLE_CHAIN_REQUIRED");
  }

  if (options.from === undefined) {
    throw new Error("SIMPLE_FROM_REQUIRED");
  }

  return resolveSimpleDexBuildConfig({
    chain: options.chain,
    pool: options.pool,
    pair: options.pair,
    fee: options.fee,
    token0: options.token0,
    token1: options.token1,
    from: options.from,
    to: options.to,
    days: options.days !== undefined ? Number(options.days) : undefined,
    rpcUrl: options.rpc,
    rpcUrlEnv: options.rpcEnv,
    out: options.out ?? options.output,
    base: options.base,
    quote: options.quote,
    datasetId: options.datasetId,
    baseTimeframe: options.baseTimeframe,
    timeframes: parseTimeframes(options.timeframes),
    chunkSize: options.chunkSize,
    failFast: true,
  });
}

function simpleInputFromConfig(
  rawConfig: unknown,
  options: BuildCommandOptions,
): SimpleDexBuildInput {
  if (!isRecord(rawConfig)) {
    throw new Error("SIMPLE_CONFIG_NOT_OBJECT");
  }

  const rpc = typeof rawConfig.rpc === "string" ? rawConfig.rpc : undefined;

  return {
    chain: options.chain ?? requiredString(rawConfig.chain, "chain"),

    pool: options.pool ?? optionalString(rawConfig.pool),
    pair: options.pair ?? optionalString(rawConfig.pair),
    fee: options.fee ?? optionalStringOrNumber(rawConfig.fee),
    token0: options.token0 ?? optionalString(rawConfig.token0),
    token1: options.token1 ?? optionalString(rawConfig.token1),

    from: options.from ?? requiredString(rawConfig.from, "from"),
    to: options.to ?? optionalString(rawConfig.to),
    days:
      options.days !== undefined
        ? Number(options.days)
        : optionalNumber(rawConfig.days),

    rpcUrl:
      options.rpc ??
      (rpc !== undefined && !rpc.startsWith("env:") ? rpc : undefined),
    rpcUrlEnv:
      options.rpcEnv ??
      (rpc?.startsWith("env:")
        ? rpc.slice("env:".length)
        : optionalString(rawConfig.rpcUrlEnv)),

    out: options.out ?? options.output ?? optionalString(rawConfig.out),

    base: options.base ?? optionalString(rawConfig.base),
    quote: options.quote ?? optionalString(rawConfig.quote),

    datasetId: options.datasetId ?? optionalString(rawConfig.datasetId),

    baseTimeframe:
      options.baseTimeframe ?? optionalString(rawConfig.baseTimeframe),
    timeframes:
      parseTimeframes(options.timeframes) ??
      (Array.isArray(rawConfig.timeframes)
        ? rawConfig.timeframes.map((value) => String(value))
        : undefined),

    chunkSize: options.chunkSize ?? optionalStringOrNumber(rawConfig.chunkSize),

    failFast:
      typeof rawConfig.failFast === "boolean" ? rawConfig.failFast : true,
  };
}

function parseTimeframes(value: string | undefined): Timeframe[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as Timeframe[];
}

function isAdvancedDexBuildConfig(value: unknown): value is DexBuildConfig {
  return (
    isRecord(value) &&
    typeof value.datasetId === "string" &&
    isRecord(value.registry) &&
    isRecord(value.network) &&
    isRecord(value.build) &&
    isRecord(value.output)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`SIMPLE_CONFIG_FIELD_REQUIRED:${field}`);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringOrNumber(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export function registerBuildCommand(program: Command): void {
  program
    .command("build")
    .description(
      "Build DEX pool dataset. Use --config for config mode, or --chain/--pair/--from/--to for simple mode.",
    )
    .option("-c, --config <path>", "Path to config file")
    .option("--profile <profile>", "Advanced config profile to use")
    .option(
      "--pool <pool>",
      "Simple mode pool address, or advanced mode pool ID",
    )
    .option("--pair <pair>", "Simple mode pair selector, e.g. WETH/USDC")
    .option("--fee <fee>", "Simple mode Uniswap v3 fee tier, e.g. 500")
    .option(
      "--token0 <address>",
      "Simple mode token0/tokenA address for factory.getPool",
    )
    .option(
      "--token1 <address>",
      "Simple mode token1/tokenB address for factory.getPool",
    )
    .option("--output <uri>", "Output URI override, local:// or s3://")
    .option("--json", "Output run report as JSON")
    .option("--verbose", "Verbose output")
    .option("--chain <chain>", "Simple mode chain, e.g. base")
    .option("--from <date>", "Simple mode from date/time, e.g. 2024-01-01")
    .option(
      "--to <date>",
      "Simple mode exclusive to date/time, e.g. 2024-02-01",
    )
    .option(
      "--days <days>",
      "Simple mode duration in days when --to is omitted",
    )
    .option("--rpc <url>", "Simple mode direct RPC URL")
    .option("--rpc-env <env>", "Simple mode RPC environment variable name")
    .option("--out <pathOrUri>", "Simple mode output path or URI")
    .option("--base <symbolOrAddress>", "Base token selector, e.g. WETH")
    .option("--quote <symbolOrAddress>", "Quote token selector, e.g. USDC")
    .option(
      "--timeframes <list>",
      "Comma-separated timeframes, e.g. 1m,5m,15m,1h",
    )
    .option("--base-timeframe <timeframe>", "Base timeframe, default 1m")
    .option("--chunk-size <blocks>", "eth_getLogs chunk size in blocks")
    .option("--dataset-id <id>", "Dataset ID override")
    .action(async (opts: BuildCommandOptions) => {
      await runBuildCommand(opts);
    });
}
