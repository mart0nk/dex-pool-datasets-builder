import { access, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import type { DiscoveryMetric } from "../../discovery/discovery.types.js";
import {
  discoverTopUniswapV3Pools,
  normalizeDiscoveryMetric,
} from "../../discovery/uniswap-v3-rpc-discovery.js";
import {
  discoveryCacheExists,
  getDiscoveryCacheStatus,
  initializeDiscoveryCache,
  isDiscoveryCacheMissingError,
  loadDiscoveryCache,
} from "../../discovery/uniswap-v3-factory-pool-cache.js";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import { resolveSimpleRpcUrl } from "../../simple/resolve-simple-build-config.js";
import type { DexChain } from "../../types/dex-pool-dataset.types.js";
import { printError, printJson, printLine } from "../cli-output.js";

type DiscoverCommandOptions = {
  chain?: string;
  top?: string;
  by?: string;
  lookbackDays?: string;
  quote?: string;
  initCache?: boolean;
  json?: boolean;
  writeConfig?: string;
};

export async function runDiscoverCommand(
  options: DiscoverCommandOptions,
): Promise<void> {
  let chain: DexChain;
  let metric: DiscoveryMetric;
  let lookbackDays: number;
  let pools: Awaited<ReturnType<typeof discoverTopUniswapV3Pools>>;
  let cache: Awaited<ReturnType<typeof loadDiscoveryCache>>;
  let cacheLagBlocks: bigint | undefined;

  try {
    chain = normalizeChain(options.chain);
    metric = normalizeDiscoveryMetric(options.by ?? "swapCount");
    lookbackDays = parsePositiveInteger(
      options.lookbackDays ?? "7",
      "lookback-days",
    );

    if (metric === "quoteVolume" && options.quote === undefined) {
      throw new Error(
        "DISCOVERY_QUOTE_REQUIRED: --quote is required when --by quoteVolume",
      );
    }

    const top = parsePositiveInteger(options.top ?? "10", "top");
    const rpcUrl = resolveSimpleRpcUrl({ chain });
    const cacheExists = await discoveryCacheExists({ chain });

    if (!cacheExists && options.initCache === true) {
      await initializeDiscoveryCache({ chain, rpcUrl });
    }

    try {
      cache = await loadDiscoveryCache({ chain });
    } catch (error: unknown) {
      if (isDiscoveryCacheMissingError(error)) {
        throw new Error(formatCacheMissingError(chain, top));
      }

      throw error;
    }

    const status = await getDiscoveryCacheStatus({ chain, rpcUrl });
    cacheLagBlocks = status.lagBlocks;
    pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_rpc",
      chain,
      rpcUrl,
      candidates: cache.candidates,
      top: {
        by: metric,
        limit: top,
        lookbackDays,
      },
      quote: options.quote,
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
      source: "uniswap_v3_rpc",
      metric,
      lookbackDays,
      quote: options.quote,
      factoryAddress: cache.state.factoryAddress,
      factoryDeploymentBlock: cache.state.deploymentBlock,
      blockRange:
        pools[0] !== undefined
          ? {
              fromBlock: pools[0].discovery.fromBlock,
              toBlock: pools[0].discovery.toBlock,
            }
          : undefined,
      snapshotAt: pools[0]?.discovery.snapshotAt ?? new Date().toISOString(),
      pools,
    });
  } else {
    if (cacheLagBlocks !== undefined && cacheLagBlocks > 10_000n) {
      printError(
        `Discovery cache is ${cacheLagBlocks.toString()} blocks behind latest safe block. Run: dex-pool discover-cache refresh --chain ${chain}`,
      );
    }

    printLine(
      `Loaded discovery cache for ${chain}:\n  pools: ${cache.rows.length}\n  scannedToBlock: ${cache.state.scannedToBlock}\n`,
    );
    printLine(`Scoring recent Swap logs over last ${lookbackDays} days...\n`);
    printLine(
      formatDiscoveredPoolsTable({
        pools,
        metric,
        lookbackDays,
        quote: options.quote,
      }),
    );

    if (options.writeConfig !== undefined) {
      printLine(`Wrote config: ${options.writeConfig}`);
    }
  }

  process.exit(0);
}

function formatDiscoveredPoolsTable(input: {
  pools: Awaited<ReturnType<typeof discoverTopUniswapV3Pools>>;
  metric: DiscoveryMetric;
  lookbackDays: number;
  quote: string | undefined;
}): string {
  const header =
    input.metric === "quoteVolume"
      ? `Top Uniswap v3 pools by quoteVolume(${input.quote}) over last ${input.lookbackDays} days`
      : `Top active Uniswap v3 pools by swapCount over last ${input.lookbackDays} days`;
  const valueHeader =
    input.metric === "quoteVolume"
      ? `QuoteVolume(${input.quote})`
      : "Swaps";
  const rows = [
    ["Rank", "Pair", "Fee", valueHeader, "Pool"],
    ...input.pools.map((item) => [
      String(item.rank),
      item.discovery.pair,
      String(item.discovery.feeTier),
      item.metricValue,
      item.discovery.poolAddress,
    ]),
  ];
  const widths = rows[0]!.map((_, index) =>
    Math.max(...rows.map((row) => row[index]!.length)),
  );
  const table = rows
    .map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");

  return `${header}\n\n${table}`;
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
    .description("Discover active Uniswap v3 pools from recent RPC logs")
    .option("--chain <chain>", "Chain, e.g. base")
    .option("--top <n>", "Number of pools to return, default 10")
    .option(
      "--by <metric>",
      "Discovery metric: swapCount or quoteVolume. Default: swapCount.",
    )
    .option(
      "--lookback-days <n>",
      "Recent lookback window for activity scoring. Default: 7.",
    )
    .option(
      "--quote <symbol>",
      "Quote token used for quoteVolume, e.g. USDC.",
    )
    .option("--init-cache", "Initialize missing discovery cache before scoring")
    .option("--json", "Output JSON")
    .option("--write-config <path>", "Write simple config with discovered pools")
    .action(async (opts: DiscoverCommandOptions) => {
      await runDiscoverCommand(opts);
    });
}

function formatCacheMissingError(chain: DexChain, top: number): string {
  return (
    `DISCOVERY_CACHE_MISSING:${chain}\n\n` +
    "Initialize the Uniswap v3 discovery cache first:\n" +
    `  dex-pool discover-cache init --chain ${chain}\n\n` +
    "Or run discovery with:\n" +
    `  dex-pool discover --chain ${chain} --top ${top} --init-cache`
  );
}
