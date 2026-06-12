import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runDiscoverCacheInitCommand,
  runDiscoverCacheRefreshCommand,
  runDiscoverCacheStatusCommand,
} from "../../src/cli/commands/discover-cache.command.js";
import type { UniswapV3PoolCacheState } from "../../src/discovery/discovery.types.js";

vi.mock("../../src/discovery/uniswap-v3-factory-pool-cache.js", () => ({
  getDiscoveryCachePaths: vi.fn(),
  getDiscoveryCacheStatus: vi.fn(),
  initializeDiscoveryCache: vi.fn(),
  refreshDiscoveryCache: vi.fn(),
}));

import {
  getDiscoveryCachePaths,
  getDiscoveryCacheStatus,
  initializeDiscoveryCache,
  refreshDiscoveryCache,
} from "../../src/discovery/uniswap-v3-factory-pool-cache.js";

const mockGetPaths = vi.mocked(getDiscoveryCachePaths);
const mockGetStatus = vi.mocked(getDiscoveryCacheStatus);
const mockInitialize = vi.mocked(initializeDiscoveryCache);
const mockRefresh = vi.mocked(refreshDiscoveryCache);

const STATE: UniswapV3PoolCacheState = {
  version: 1,
  chain: "base",
  factoryAddress: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  deploymentBlock: "1371680",
  scannedToBlock: "23890500",
  safeLatestBlock: "23890500",
  poolCount: 18432,
  updatedAt: "2026-06-10T12:00:00.000Z",
};

let stdoutCapture: string[] = [];
let stderrCapture: string[] = [];
let exitCode: number | undefined;
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

  mockGetPaths.mockReturnValue({
    poolsPath: ".data/cache/base/uniswap-v3-pools.jsonl",
    statePath: ".data/cache/base/uniswap-v3-pools.state.json",
  });
  mockInitialize.mockResolvedValue({
    state: STATE,
    rows: [],
    paths: {
      poolsPath: ".data/cache/base/uniswap-v3-pools.jsonl",
      statePath: ".data/cache/base/uniswap-v3-pools.state.json",
    },
  });
  mockRefresh.mockResolvedValue({
    state: STATE,
    rows: [],
    paths: {
      poolsPath: ".data/cache/base/uniswap-v3-pools.jsonl",
      statePath: ".data/cache/base/uniswap-v3-pools.state.json",
    },
  });
  mockGetStatus.mockResolvedValue({
    state: STATE,
    safeLatestBlock: 23_890_900n,
    lagBlocks: 400n,
    paths: {
      poolsPath: ".data/cache/base/uniswap-v3-pools.jsonl",
      statePath: ".data/cache/base/uniswap-v3-pools.state.json",
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.BASE_RPC_URL = originalBaseRpcUrl;
});

describe("discover-cache command", () => {
  it("initializes cache and prints scan status", async () => {
    await expect(
      runDiscoverCacheInitCommand({ chain: "base" }),
    ).rejects.toThrow("process.exit(0)");

    expect(mockInitialize).toHaveBeenCalledWith({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      onProgress: expect.any(Function),
    });
    expect(stdoutCapture.join("")).toContain(
      "Initializing Uniswap v3 factory pool cache for base",
    );
    expect(stdoutCapture.join("")).toContain("Found pools: 18432");
    expect(exitCode).toBe(0);
  });

  it("refreshes cache and prints pool count", async () => {
    await expect(
      runDiscoverCacheRefreshCommand({ chain: "base" }),
    ).rejects.toThrow("process.exit(0)");

    expect(mockRefresh).toHaveBeenCalledWith({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      onProgress: expect.any(Function),
    });
    expect(stdoutCapture.join("")).toContain(
      "Refreshing Uniswap v3 factory pool cache for base",
    );
    expect(stdoutCapture.join("")).toContain("Pools cached: 18432");
  });

  it("prints cache status", async () => {
    await expect(
      runDiscoverCacheStatusCommand({ chain: "base" }),
    ).rejects.toThrow("process.exit(0)");

    expect(stdoutCapture.join("")).toContain(
      "Uniswap v3 discovery cache for base",
    );
    expect(stdoutCapture.join("")).toContain("Pools cached: 18432");
    expect(stdoutCapture.join("")).toContain("Scanned to block: 23890500");
    expect(stdoutCapture.join("")).toContain("Lag: 400 blocks");
  });

  it("exits 1 when status cache is missing", async () => {
    mockGetStatus.mockRejectedValue(new Error("DISCOVERY_CACHE_MISSING:base"));

    await expect(
      runDiscoverCacheStatusCommand({ chain: "base" }),
    ).rejects.toThrow("process.exit(1)");

    expect(stderrCapture.join("")).toContain("DISCOVERY_CACHE_MISSING:base");
    expect(exitCode).toBe(1);
  });
});
