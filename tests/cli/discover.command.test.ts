import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDiscoverCommand } from "../../src/cli/commands/discover.command.js";
import type { DiscoveredDexPool } from "../../src/discovery/discovery.types.js";

vi.mock("../../src/discovery/uniswap-v3-rpc-discovery.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/discovery/uniswap-v3-rpc-discovery.js")
    >();

  return {
    ...actual,
    discoverTopUniswapV3Pools: vi.fn(),
  };
});

import { discoverTopUniswapV3Pools } from "../../src/discovery/uniswap-v3-rpc-discovery.js";

const mockDiscover = vi.mocked(discoverTopUniswapV3Pools);

const DISCOVERED_SWAP_COUNT: DiscoveredDexPool[] = [
  {
    rank: 1,
    metric: "swapCount",
    metricValue: "15342",
    pool: {
      id: "base-uniswap-v3-weth-usdc-500-d0b53d92",
      chain: "base",
      dex: "uniswap_v3",
      kind: "UNISWAP_V3_STYLE",
      poolAddress: "0xd0b53d9277642d899df5c87a3966a349a798f224",
      token0: {
        symbol: "WETH",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
      },
      token1: {
        symbol: "USDC",
        address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        decimals: 6,
      },
      baseToken: "token0",
      quoteToken: "token1",
      feeTier: 500,
      startBlock: "1371680",
    },
    discovery: {
      source: "uniswap_v3_rpc",
      snapshotAt: "2026-06-10T00:00:00.000Z",
      rank: 1,
      metric: "swapCount",
      metricValue: "15342",
      poolAddress: "0xd0b53d9277642d899df5c87a3966a349a798f224",
      feeTier: 500,
      pair: "WETH/USDC",
      swapCount: 15342,
      factoryAddress: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
      factoryDeploymentBlock: "1371680",
      fromBlock: "9000",
      toBlock: "10000",
    },
  },
];

const DISCOVERED_QUOTE_VOLUME: DiscoveredDexPool[] = [
  {
    ...DISCOVERED_SWAP_COUNT[0]!,
    metric: "quoteVolume",
    metricValue: "123456789.12",
    discovery: {
      ...DISCOVERED_SWAP_COUNT[0]!.discovery,
      metric: "quoteVolume",
      metricValue: "123456789.12",
      quoteSymbol: "USDC",
      quoteVolume: "123456789.12",
    },
  },
];

let stdoutCapture: string[] = [];
let stderrCapture: string[] = [];
let exitCode: number | undefined;
const tempDirs: string[] = [];
const originalBaseRpcUrl = process.env.BASE_RPC_URL;

beforeEach(() => {
  stdoutCapture = [];
  stderrCapture = [];
  exitCode = undefined;
  process.env.BASE_RPC_URL = "https://base-rpc.example";

  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdoutCapture.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrCapture.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(
    (code?: number | string | null) => {
      exitCode = typeof code === "number" ? code : 0;
      throw new Error(`process.exit(${String(code)})`);
    },
  );

  mockDiscover.mockResolvedValue(DISCOVERED_SWAP_COUNT);
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env.BASE_RPC_URL = originalBaseRpcUrl;

  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dex-pool-discover-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("discover command", () => {
  it("defaults to swapCount over a 7 day lookback and prints active wording", async () => {
    await expect(runDiscoverCommand({ chain: "base", top: "10" })).rejects.toThrow(
      "process.exit(0)",
    );

    const output = stdoutCapture.join("");
    expect(output).toContain(
      "Top active Uniswap v3 pools by swapCount over last 7 days",
    );
    expect(output).toContain("Swaps");
    expect(output).toContain("15342");
    expect(output).not.toContain("liquidity");
    expect(output).not.toContain("TVL");
    expect(mockDiscover).toHaveBeenCalledWith({
      source: "uniswap_v3_rpc",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      top: { by: "swapCount", limit: 10, lookbackDays: 7 },
      quote: undefined,
    });
    expect(exitCode).toBe(0);
  });

  it("outputs valid JSON", async () => {
    await expect(
      runDiscoverCommand({ chain: "base", json: true }),
    ).rejects.toThrow("process.exit(0)");

    const parsed = JSON.parse(stdoutCapture.join("")) as {
      chain: string;
      source: string;
      metric: string;
      lookbackDays: number;
      pools: DiscoveredDexPool[];
    };
    expect(parsed.chain).toBe("base");
    expect(parsed.source).toBe("uniswap_v3_rpc");
    expect(parsed.metric).toBe("swapCount");
    expect(parsed.lookbackDays).toBe(7);
    expect(parsed.pools).toHaveLength(1);
  });

  it("prints quoteVolume output with quote token label", async () => {
    mockDiscover.mockResolvedValue(DISCOVERED_QUOTE_VOLUME);

    await expect(
      runDiscoverCommand({
        chain: "base",
        by: "quoteVolume",
        quote: "USDC",
        lookbackDays: "7",
      }),
    ).rejects.toThrow("process.exit(0)");

    const output = stdoutCapture.join("");
    expect(output).toContain(
      "Top Uniswap v3 pools by quoteVolume(USDC) over last 7 days",
    );
    expect(output).toContain("QuoteVolume(USDC)");
    expect(output).toContain("123456789.12");
  });

  it("requires --quote for quoteVolume", async () => {
    await expect(
      runDiscoverCommand({ chain: "base", by: "quoteVolume" }),
    ).rejects.toThrow("process.exit(1)");

    expect(stderrCapture.join("")).toContain("DISCOVERY_QUOTE_REQUIRED");
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("writes a simple config with discovered pools", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "dex-pool.config.json");

    await expect(
      runDiscoverCommand({ chain: "base", writeConfig: file }),
    ).rejects.toThrow("process.exit(0)");

    const config = JSON.parse(await readFile(file, "utf8")) as {
      chain: string;
      rpc: string;
      pools: string[];
    };
    expect(config.chain).toBe("base");
    expect(config.rpc).toBe("env:BASE_RPC_URL");
    expect(config.pools).toEqual([
      "0xd0b53d9277642d899df5c87a3966a349a798f224",
    ]);
  });

  it("refuses to overwrite existing config", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "dex-pool.config.json");
    await writeFile(file, "{}\n", "utf8");

    await expect(
      runDiscoverCommand({ chain: "base", writeConfig: file }),
    ).rejects.toThrow("process.exit(1)");

    expect(stderrCapture.join("")).toContain("DISCOVERY_CONFIG_EXISTS");
  });
});
