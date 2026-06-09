import { access, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import {
  parsePairsList,
  parsePoolsList,
} from "../../simple/normalize-simple-pool-selections.js";
import { printError, printLine } from "../cli-output.js";

type InitCommandOptions = {
  file?: string;
  chain?: string;
  pool?: string;
  pools?: string;
  pair?: string;
  pairs?: string;
  fee?: string;
  from?: string;
  to?: string;
  base?: string;
  quote?: string;
  force?: boolean;
};

export async function runInitCommand(
  options: InitCommandOptions,
): Promise<void> {
  const file = options.file ?? "dex-pool.config.json";
  const chain = options.chain ?? "base";
  const preset = getSimpleChainPreset(chain);

  if (options.force !== true && (await exists(file))) {
    printError(`Config already exists: ${file}. Use --force to overwrite.`);
    process.exit(1);
  }

  const parsedPairs = parsePairsList(options.pairs);
  const parsedPools = parsePoolsList(options.pools);

  const baseConfig = {
    chain,
    rpc: `env:${preset.defaultRpcUrlEnv}`,
    from: options.from ?? "2024-01-01",
    to: options.to ?? "2024-01-02",
    timeframes: ["1m", "5m", "15m", "1h", "4h"],
    out: "./data/dex-pool-datasets",
  };

  const config =
    parsedPools !== undefined && parsedPools.length > 0
      ? {
          ...baseConfig,
          pools: parsedPools,
        }
      : options.pool !== undefined
        ? {
            ...baseConfig,
            pool: options.pool,
            ...(options.base !== undefined ? { base: options.base } : {}),
            ...(options.quote !== undefined ? { quote: options.quote } : {}),
          }
        : parsedPairs !== undefined && parsedPairs.length > 0
          ? {
              ...baseConfig,
              pairs: parsedPairs,
            }
          : {
              ...baseConfig,
              pairs: [
                {
                  pair: options.pair ?? "WETH/USDC",
                  fee: Number(options.fee ?? 500),
                },
              ],
            };

  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  printLine(`Created ${file}`);
  printLine("Next:");
  printLine(`  export ${preset.defaultRpcUrlEnv}="https://your-archive-rpc"`);
  printLine(`  dex-pool build --config ${file}`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a simple dex-pool.config.json")
    .option("--file <path>", "Config file to create")
    .option("--chain <chain>", "Chain, default base")
    .option("--pool <address>", "Pool contract address")
    .option("--pools <list>", "Comma-separated pool contract addresses")
    .option("--pair <pair>", "Pair selector, default WETH/USDC")
    .option(
      "--pairs <list>",
      "Comma-separated pair selectors, e.g. WETH/USDC,cbBTC/WETH:3000",
    )
    .option("--fee <fee>", "Fee tier, default 500")
    .option("--from <date>", "From date")
    .option("--to <date>", "Exclusive to date")
    .option(
      "--base <symbolOrAddress>",
      "Base token selector, only used with --pool",
    )
    .option(
      "--quote <symbolOrAddress>",
      "Quote token selector, only used with --pool",
    )
    .option("--force", "Overwrite existing config")
    .action(async (opts: InitCommandOptions) => {
      await runInitCommand(opts);
    });
}
