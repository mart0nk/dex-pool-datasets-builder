import { access, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import type { DiscoveryMetric } from "../../discovery/discovery.types.js";
import {
  discoverTopUniswapV3Pools,
  normalizeDiscoveryMetric,
} from "../../discovery/uniswap-v3-subgraph-discovery.js";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import type { DexChain } from "../../types/dex-pool-dataset.types.js";
import { printError, printJson, printLine } from "../cli-output.js";

type DiscoverCommandOptions = {
  chain?: string;
  top?: string;
  by?: string;
  minLiquidityUsd?: string;
  minVolumeUsd?: string;
  includeFees?: string;
  includePairs?: string;
  excludePairs?: string;
  subgraphUrl?: string;
  subgraphUrlEnv?: string;
  json?: boolean;
  writeConfig?: string;
};

export async function runDiscoverCommand(
  options: DiscoverCommandOptions,
): Promise<void> {
  let chain: DexChain;
  let metric: DiscoveryMetric;
  let pools: Awaited<ReturnType<typeof discoverTopUniswapV3Pools>>;

  try {
    chain = normalizeChain(options.chain);
    metric = normalizeDiscoveryMetric(options.by ?? "totalValueLockedUSD");
    const subgraphUrl = resolveSubgraphUrl({
      chain,
      subgraphUrl: options.subgraphUrl,
      subgraphUrlEnv: options.subgraphUrlEnv,
    });
    const top = parsePositiveInteger(options.top ?? "10", "top");
    pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_subgraph",
      chain,
      subgraphUrl,
      top: {
        by: metric,
        limit: top,
        minLiquidityUsd: parseOptionalNumber(
          options.minLiquidityUsd,
          "min-liquidity-usd",
        ),
        minVolumeUsd: parseOptionalNumber(
          options.minVolumeUsd,
          "min-volume-usd",
        ),
      },
      includeFees: parseOptionalIntegerList(
        options.includeFees,
        "include-fees",
      ),
      includePairs: parseOptionalStringList(options.includePairs),
      excludePairs: parseOptionalStringList(options.excludePairs),
    });

    if (options.writeConfig !== undefined) {
      await writeDiscoveredConfig({
        file: options.writeConfig,
        chain,
        pools: pools.map((pool) => pool.pool.poolAddress),
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (options.json === true) {
      printJson({ error: message });
    } else {
      printError(`Discovery failed: ${message}`);
    }

    process.exit(1);
  }

  if (options.json === true) {
    printJson({
      chain,
      source: "uniswap_v3_subgraph",
      metric,
      snapshotAt: pools[0]?.discovery.snapshotAt ?? new Date().toISOString(),
      pools,
    });
  } else {
    printLine(formatDiscoveredPoolsTable(pools, metric));

    if (options.writeConfig !== undefined) {
      printLine(`Wrote config: ${options.writeConfig}`);
    }
  }

  process.exit(0);
}

export function resolveSubgraphUrl(input: {
  chain: DexChain;
  subgraphUrl?: string;
  subgraphUrlEnv?: string;
}): string {
  if (input.subgraphUrl !== undefined && input.subgraphUrl.length > 0) {
    return input.subgraphUrl;
  }

  const envName = input.subgraphUrlEnv ?? defaultSubgraphUrlEnv(input.chain);
  const value = process.env[envName];

  if (value === undefined || value.length === 0) {
    throw new Error(`DISCOVERY_SUBGRAPH_URL_ENV_MISSING:${envName}`);
  }

  return value;
}

function defaultSubgraphUrlEnv(chain: DexChain): string {
  const preset = getSimpleChainPreset(chain);
  const prefix = preset.defaultRpcUrlEnv.replace(/_RPC_URL$/, "");
  return `${prefix}_UNISWAP_V3_SUBGRAPH_URL`;
}

function formatDiscoveredPoolsTable(
  pools: Awaited<ReturnType<typeof discoverTopUniswapV3Pools>>,
  metric: DiscoveryMetric,
): string {
  const rows = [
    ["Rank", "Pair", "Fee", "Pool", metric],
    ...pools.map((item) => [
      String(item.rank),
      item.discovery.pair,
      String(item.discovery.feeTier),
      item.discovery.poolAddress,
      item.metricValue,
    ]),
  ];
  const widths = rows[0]!.map((_, index) =>
    Math.max(...rows.map((row) => row[index]!.length)),
  );

  return rows
    .map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

async function writeDiscoveredConfig(input: {
  file: string;
  chain: DexChain;
  pools: string[];
}): Promise<void> {
  if (await exists(input.file)) {
    throw new Error(`DISCOVERY_CONFIG_EXISTS:${input.file}`);
  }

  const preset = getSimpleChainPreset(input.chain);
  const config = {
    chain: input.chain,
    rpc: `env:${preset.defaultRpcUrlEnv}`,
    pools: input.pools,
    from: "2024-01-01",
    to: "2024-01-02",
    timeframes: ["1m", "5m", "15m", "1h", "4h"],
    out: "./data/dex-pool-datasets",
  };

  await writeFile(input.file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function normalizeChain(chain: string | undefined): DexChain {
  if (chain === undefined || chain.length === 0) {
    throw new Error("DISCOVERY_CHAIN_REQUIRED");
  }

  return getSimpleChainPreset(chain).chain;
}

function parseOptionalStringList(
  value: string | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalIntegerList(
  value: string | undefined,
  field: string,
): number[] | undefined {
  const items = parseOptionalStringList(value);

  if (items === undefined) {
    return undefined;
  }

  return items.map((item) => parsePositiveInteger(item, field));
}

function parseOptionalNumber(
  value: string | undefined,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`DISCOVERY_NUMBER_INVALID:${field}:${value}`);
  }

  return parsed;
}

function parsePositiveInteger(value: string, field: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`DISCOVERY_INTEGER_INVALID:${field}:${value}`);
  }

  return parsed;
}

export function registerDiscoverCommand(program: Command): void {
  program
    .command("discover")
    .description("Discover top Uniswap v3 pools from a configured subgraph")
    .option("--chain <chain>", "Chain, e.g. base")
    .option("--top <n>", "Number of pools to return, default 10")
    .option(
      "--by <metric>",
      "Ranking metric: totalValueLockedUSD, volumeUSD, or liquidity",
    )
    .option("--min-liquidity-usd <amount>", "Minimum TVL in USD")
    .option("--min-volume-usd <amount>", "Minimum volume in USD")
    .option("--include-fees <list>", "Comma-separated fee tiers")
    .option("--include-pairs <list>", "Comma-separated pairs to include")
    .option("--exclude-pairs <list>", "Comma-separated pairs to exclude")
    .option("--subgraph-url <url>", "Direct Uniswap v3 subgraph GraphQL URL")
    .option("--subgraph-url-env <env>", "Environment variable for subgraph URL")
    .option("--json", "Output JSON")
    .option(
      "--write-config <path>",
      "Write simple config with discovered pools",
    )
    .action(async (opts: DiscoverCommandOptions) => {
      await runDiscoverCommand(opts);
    });
}
