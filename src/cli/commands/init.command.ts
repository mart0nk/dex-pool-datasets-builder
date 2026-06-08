import { access, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import { printError, printLine } from "../cli-output.js";

type InitCommandOptions = {
  file?: string;
  chain?: string;
  pool?: string;
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

  const config = {
    chain,
    rpc: `env:${preset.defaultRpcUrlEnv}`,
    pool: options.pool ?? "0x0000000000000000000000000000000000000000",
    from: options.from ?? "2024-01-01",
    to: options.to ?? "2024-02-01",
    ...(options.base !== undefined ? { base: options.base } : {}),
    ...(options.quote !== undefined ? { quote: options.quote } : {}),
    timeframes: ["1m", "5m", "15m", "1h"],
    out: "./data/dex-pool-datasets",
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
    .option("--from <date>", "From date")
    .option("--to <date>", "Exclusive to date")
    .option("--base <symbolOrAddress>", "Base token selector")
    .option("--quote <symbolOrAddress>", "Quote token selector")
    .option("--force", "Overwrite existing config")
    .action(async (opts: InitCommandOptions) => {
      await runInitCommand(opts);
    });
}
