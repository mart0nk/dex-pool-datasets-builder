import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDiscoverCommand } from "../../src/cli/commands/discover.command.js";
import type {
  DiscoveredDexPool,
  UniswapV3PoolCacheState,
} from "../../src/discovery/discovery.types.js";

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

vi.mock("../../src/discovery/uniswap-v3-factory-pool-cache.js", () => ({
  discoveryCacheExists: vi.fn(),
  getDiscoveryCacheStatus: vi.fn(),
  initializeDiscoveryCache: vi.fn(),
  isDiscoveryCacheMissingError: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.startsWith("DISCOVERY_CACHE_MISSING:") ||
      message.startsWith("DISCOVERY_CACHE_STATE_MISSING:")
    );
  },
  loadDiscoveryCache: vi.fn(),
}));

import { discoverTopUniswapV3Pools } from "../../src/discovery/uniswap-v3-rpc-discovery.js";
import {
  discoveryCacheExists,
  getDiscoveryCacheStatus,
  initializeDiscoveryCache,
  loadDiscoveryCache,
} from "../../src/discovery/uniswap-v3-factory-pool-cache.js";

const mockDiscover = vi.mocked(discoverTopUniswapV3Pools);
const mockCacheExists = vi.mocked(discoveryCacheExists);
const mockGetCacheStatus = vi.mocked(getDiscoveryCacheStatus);
const mockInitializeCache = vi.mocked(initializeDiscoveryCache);
const mockLoadCache = vi.mocked(loadDiscoveryCache);

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

const CACHE_STATE: UniswapV3PoolCacheState = {
  version: 1,
  chain: "base",
  factoryAddress: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  deploymentBlock: "1371680",
  scannedToBlock: "10000",
  safeLatestBlock: "10000",
  poolCount: 2,
  updatedAt: "2026-06-10T00:00:00.000Z",
};

const CACHE_ROWS = [
  {
    blockNumber: "1371680",
    blockHash: "0x".padEnd(66, "2") as `0x${string}`,
    transactionHash: "0x".padEnd(66, "3") as `0x${string}`,
    logIndex: "0",
    token0: "0x4200000000000000000000000000000000000006" as `0x${string}`,
    token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`,
    fee: 500,
    tickSpacing: 10,
    pool: "0xd0b53d9277642d899df5c87a3966a349a798f224" as `0x${string}`,
  },
  {
    blockNumber: "1371681",
    blockHash: "0x".padEnd(66, "4") as `0x${string}`,
    transactionHash: "0x".padEnd(66, "5") as `0x${string}`,
    logIndex: "1",
    token0: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as `0x${string}`,
    token1: "0x4200000000000000000000000000000000000006" as `0x${string}`,
    fee: 3000,
    tickSpacing: 60,
    pool: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  },
];

const CACHE_CANDIDATES = CACHE_ROWS.map((row) => ({
  token0: row.token0,
  token1: row.token1,
  feeTier: row.fee,
  poolAddress: row.pool,
}));

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
  mockCacheExists.mockResolvedValue(true);
  mockLoadCache.mockResolvedValue({
    state: CACHE_STATE,
    rows: CACHE_ROWS,
    candidates: CACHE_CANDIDATES,
    paths: {
      poolsPath: ".data/cache/base/uniswap-v3-pools.jsonl",
      statePath: ".data/cache/base/uniswap-v3-pools.state.json",
    },
  });
  mockGetCacheStatus.mockResolvedValue({
    state: CACHE_STATE,
    safeLatestBlock: 10_000n,
    lagBlocks: 0n,
    paths: {
      poolsPath: ".data/cache/base/uniswap-v3-pools.jsonl",
      statePath: ".data/cache/base/uniswap-v3-pools.state.json",
    },
  });
  mockInitializeCache.mockResolvedValue({
    state: CACHE_STATE,
    rows: CACHE_ROWS,
    paths: {
      poolsPath: ".data/cache/base/uniswap-v3-pools.jsonl",
      statePath: ".data/cache/base/uniswap-v3-pools.state.json",
    },
  });
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
    expect(output).toContain("Loaded discovery cache for base");
    expect(output).toContain("pools: 2");
    expect(output).toContain("Scoring recent Swap logs over last 7 days");
    expect(output).toContain("Swaps");
    expect(output).toContain("15342");
    expect(output).not.toContain("liquidity");
    expect(output).not.toContain("TVL");
    expect(mockDiscover).toHaveBeenCalledWith({
      source: "uniswap_v3_rpc",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      candidates: CACHE_CANDIDATES,
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
      factoryAddress: string;
      factoryDeploymentBlock: string;
      pools: DiscoveredDexPool[];
    };
    expect(parsed.chain).toBe("base");
    expect(parsed.source).toBe("uniswap_v3_rpc");
    expect(parsed.metric).toBe("swapCount");
    expect(parsed.lookbackDays).toBe(7);
    expect(parsed.factoryAddress).toBe(CACHE_STATE.factoryAddress);
    expect(parsed.factoryDeploymentBlock).toBe("1371680");
    expect(parsed.pools).toHaveLength(1);
  });

  it("fails explicitly when cache is missing", async () => {
    mockCacheExists.mockResolvedValue(false);
    mockLoadCache.mockRejectedValue(new Error("DISCOVERY_CACHE_MISSING:base"));

    await expect(
      runDiscoverCommand({ chain: "base", top: "10" }),
    ).rejects.toThrow("process.exit(1)");

    expect(stderrCapture.join("")).toContain("DISCOVERY_CACHE_MISSING:base");
    expect(stderrCapture.join("")).toContain(
      "dex-pool discover-cache init --chain base",
    );
    expect(mockInitializeCache).not.toHaveBeenCalled();
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("initializes missing cache with --init-cache before scoring", async () => {
    mockCacheExists.mockResolvedValue(false);

    await expect(
      runDiscoverCommand({ chain: "base", initCache: true }),
    ).rejects.toThrow("process.exit(0)");

    expect(mockInitializeCache).toHaveBeenCalledWith({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
    });
    expect(mockDiscover).toHaveBeenCalledOnce();
  });

  it("does not rebuild an existing cache with --init-cache", async () => {
    mockCacheExists.mockResolvedValue(true);

    await expect(
      runDiscoverCommand({ chain: "base", initCache: true }),
    ).rejects.toThrow("process.exit(0)");

    expect(mockInitializeCache).not.toHaveBeenCalled();
    expect(mockDiscover).toHaveBeenCalledOnce();
  });

  it("warns about stale cache but continues discovery", async () => {
    mockGetCacheStatus.mockResolvedValue({
      state: CACHE_STATE,
      safeLatestBlock: 30_001n,
      lagBlocks: 20_001n,
      paths: {
        poolsPath: ".data/cache/base/uniswap-v3-pools.jsonl",
        statePath: ".data/cache/base/uniswap-v3-pools.state.json",
      },
    });

    await expect(runDiscoverCommand({ chain: "base" })).rejects.toThrow(
      "process.exit(0)",
    );

    expect(stderrCapture.join("")).toContain(
      "Discovery cache is 20001 blocks behind latest safe block",
    );
    expect(mockDiscover).toHaveBeenCalledOnce();
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
