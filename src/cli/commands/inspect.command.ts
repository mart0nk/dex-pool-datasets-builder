import type { Command } from "commander";
import { createEvmJsonRpcClient } from "../../evm/evm-json-rpc-client.js";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import { readUniswapV3PoolConfig } from "../../simple/evm-contract-reader.js";
import {
  assertEvmAddress,
  resolveSimpleRpcUrl,
} from "../../simple/resolve-simple-build-config.js";
import { printError, printJson, printLine } from "../cli-output.js";

type InspectCommandOptions = {
  chain: string;
  pool: string;
  rpc?: string;
  rpcEnv?: string;
  base?: string;
  quote?: string;
  json?: boolean;
};

export async function runInspectCommand(
  options: InspectCommandOptions,
): Promise<void> {
  try {
    const preset = getSimpleChainPreset(options.chain);

    const rpcUrl = resolveSimpleRpcUrl({
      chain: options.chain,
      rpcUrl: options.rpc,
      rpcUrlEnv: options.rpcEnv,
    });

    const client = createEvmJsonRpcClient({ rpcUrl });

    const pool = await readUniswapV3PoolConfig({
      client,
      chain: preset.chain,
      dex: preset.defaultDex,
      poolAddress: assertEvmAddress(options.pool, "pool"),
      startBlock: "0",
      base: options.base,
      quote: options.quote,
    });

    if (options.json === true) {
      printJson(pool);
      return;
    }

    printLine(`Pool: ${pool.poolAddress}`);
    printLine(`Chain: ${pool.chain}`);
    printLine(`DEX: ${pool.dex}`);
    printLine(`Kind: ${pool.kind}`);
    printLine(`Fee tier: ${pool.feeTier ?? "(unknown)"}`);
    printLine(`Generated ID: ${pool.id}`);
    printLine("");
    printLine(
      `token0: ${pool.token0.symbol} ${pool.token0.address} decimals=${pool.token0.decimals}`,
    );
    printLine(
      `token1: ${pool.token1.symbol} ${pool.token1.address} decimals=${pool.token1.decimals}`,
    );
    printLine(
      `base/quote: ${pool[pool.baseToken].symbol}/${pool[pool.quoteToken].symbol}`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (options.json === true) {
      printJson({
        ok: false,
        error: message,
      });
    } else {
      printError(`Inspect failed: ${message}`);
    }

    process.exit(1);
  }
}

export function registerInspectCommand(program: Command): void {
  program
    .command("inspect")
    .description(
      "Inspect an on-chain Uniswap v3-style pool and print detected token metadata",
    )
    .requiredOption("--chain <chain>", "Chain, e.g. base")
    .requiredOption("--pool <address>", "Pool contract address")
    .option("--rpc <url>", "Direct RPC URL")
    .option("--rpc-env <env>", "RPC environment variable name")
    .option("--base <symbolOrAddress>", "Base token selector")
    .option("--quote <symbolOrAddress>", "Quote token selector")
    .option("--json", "Output JSON")
    .action(async (opts: InspectCommandOptions) => {
      await runInspectCommand(opts);
    });
}
