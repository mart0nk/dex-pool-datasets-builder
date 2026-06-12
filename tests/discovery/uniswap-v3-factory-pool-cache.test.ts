import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EvmBlock,
  EvmJsonRpcClient,
} from "../../src/evm/evm-json-rpc-client.js";
import {
  getDiscoveryCachePaths,
  getDiscoveryCacheStatus,
  initializeDiscoveryCache,
  loadDiscoveryCache,
  refreshDiscoveryCache,
} from "../../src/discovery/uniswap-v3-factory-pool-cache.js";
import { UNISWAP_V3_POOL_CREATED_TOPIC } from "../../src/discovery/uniswap-v3-pool-created-decoder.js";

const FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7C32D4f71b54bdA02913";
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const POOL_A = "0xd0b53d9277642d899df5c87a3966a349a798f224";
const POOL_B = "0x0000000000000000000000000000000000000001";

vi.mock("../../src/evm/evm-json-rpc-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/evm/evm-json-rpc-client.js")>();

  return {
    ...actual,
    createEvmJsonRpcClient: vi.fn(),
  };
});

import { createEvmJsonRpcClient } from "../../src/evm/evm-json-rpc-client.js";

const mockCreateClient = vi.mocked(createEvmJsonRpcClient);
const tempDirs: string[] = [];

beforeEach(() => {
  mockCreateClient.mockReset();
});

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("Uniswap v3 factory pool cache", () => {
  it("initializes from deployment block and writes versioned state plus JSONL rows", async () => {
    const cacheDir = await makeTempDir();
    const getLogs = vi.fn(async () => [
      poolCreatedLog({
        token0: WETH,
        token1: USDC,
        fee: 500,
        pool: POOL_A,
        blockNumber: 1_371_680n,
        logIndex: 0n,
      }),
    ]);
    mockCreateClient.mockReturnValue(makeClient({ getLogs, latestBlock: 1_371_700n }));

    const result = await initializeDiscoveryCache({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      cacheDir,
    });
    const paths = getDiscoveryCachePaths({ chain: "base", cacheDir });
    const state = JSON.parse(await readFile(paths.statePath, "utf8")) as {
      version: number;
      deploymentBlock: string;
      scannedToBlock: string;
      poolCount: number;
    };
    const rows = (await readFile(paths.poolsPath, "utf8")).trim().split("\n");

    expect(getLogs).toHaveBeenCalledWith({
      address: FACTORY,
      fromBlock: 1_371_680n,
      toBlock: 1_371_700n,
      topics: [UNISWAP_V3_POOL_CREATED_TOPIC],
    });
    expect(state).toMatchObject({
      version: 1,
      deploymentBlock: "1371680",
      scannedToBlock: "1371700",
      poolCount: 1,
    });
    expect(JSON.parse(rows[0]!)).toMatchObject({
      blockNumber: "1371680",
      blockHash: "0x".padEnd(66, "2"),
      transactionHash: "0x".padEnd(66, "3"),
      logIndex: "0",
      pool: POOL_A.toLowerCase(),
    });
    expect(result.rows).toHaveLength(1);
  });

  it("refreshes from scannedToBlock + 1, appends new pools, and dedupes runtime candidates", async () => {
    const cacheDir = await makeTempDir();
    mockCreateClient.mockReturnValue(
      makeClient({
        getLogs: vi.fn(async () => [
          poolCreatedLog({
            token0: WETH,
            token1: USDC,
            fee: 500,
            pool: POOL_A,
            blockNumber: 1_371_680n,
            logIndex: 0n,
          }),
        ]),
        latestBlock: 1_371_700n,
      }),
    );
    await initializeDiscoveryCache({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      cacheDir,
    });

    const getLogs = vi.fn(async () => [
      poolCreatedLog({
        token0: WETH,
        token1: USDC,
        fee: 500,
        pool: POOL_A,
        blockNumber: 1_371_701n,
        logIndex: 1n,
      }),
      poolCreatedLog({
        token0: CBBTC,
        token1: WETH,
        fee: 3000,
        pool: POOL_B,
        blockNumber: 1_371_702n,
        logIndex: 2n,
      }),
    ]);
    mockCreateClient.mockReturnValue(makeClient({ getLogs, latestBlock: 1_371_710n }));

    const result = await refreshDiscoveryCache({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      cacheDir,
    });
    const loaded = await loadDiscoveryCache({ chain: "base", cacheDir });

    expect(getLogs).toHaveBeenCalledWith({
      address: FACTORY,
      fromBlock: 1_371_701n,
      toBlock: 1_371_710n,
      topics: [UNISWAP_V3_POOL_CREATED_TOPIC],
    });
    expect(result.state).toMatchObject({
      scannedToBlock: "1371710",
      poolCount: 2,
    });
    expect(loaded.rows).toHaveLength(2);
    expect(loaded.candidates.map((candidate) => candidate.poolAddress)).toEqual([
      POOL_A.toLowerCase(),
      POOL_B.toLowerCase(),
    ]);
  });

  it("resumes init from the last successfully persisted chunk", async () => {
    const cacheDir = await makeTempDir();
    const firstGetLogs = vi
      .fn()
      .mockResolvedValueOnce([
        poolCreatedLog({
          token0: WETH,
          token1: USDC,
          fee: 500,
          pool: POOL_A,
          blockNumber: 1_371_680n,
          logIndex: 0n,
        }),
      ])
      .mockRejectedValueOnce(new Error("RPC_DOWN"));
    mockCreateClient.mockReturnValue(
      makeClient({ getLogs: firstGetLogs, latestBlock: 1_391_700n }),
    );

    await expect(
      initializeDiscoveryCache({
        chain: "base",
        rpcUrl: "https://base-rpc.example",
        cacheDir,
      }),
    ).rejects.toThrow("RPC_DOWN");

    const paths = getDiscoveryCachePaths({ chain: "base", cacheDir });
    const partialState = JSON.parse(
      await readFile(paths.statePath, "utf8"),
    ) as { scannedToBlock: string; poolCount: number };
    expect(partialState).toMatchObject({
      scannedToBlock: "1381679",
      poolCount: 1,
    });

    const secondGetLogs = vi.fn(async () => [
      poolCreatedLog({
        token0: CBBTC,
        token1: WETH,
        fee: 3000,
        pool: POOL_B,
        blockNumber: 1_381_680n,
        logIndex: 1n,
      }),
    ]);
    mockCreateClient.mockReturnValue(
      makeClient({ getLogs: secondGetLogs, latestBlock: 1_391_700n }),
    );

    const resumed = await initializeDiscoveryCache({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      cacheDir,
    });

    expect(secondGetLogs.mock.calls[0]![0]).toMatchObject({
      fromBlock: 1_381_680n,
      toBlock: 1_391_679n,
    });
    expect(resumed.state).toMatchObject({
      scannedToBlock: "1391700",
      poolCount: 2,
    });
    expect(resumed.rows.map((row) => row.pool)).toEqual([
      POOL_B.toLowerCase(),
    ]);
    const loaded = await loadDiscoveryCache({ chain: "base", cacheDir });
    expect(loaded.rows.map((row) => row.pool)).toEqual([
      POOL_A.toLowerCase(),
      POOL_B.toLowerCase(),
    ]);
  });

  it("does not update state when refresh scan fails", async () => {
    const cacheDir = await makeTempDir();
    mockCreateClient.mockReturnValue(
      makeClient({
        getLogs: vi.fn(async () => [
          poolCreatedLog({
            token0: WETH,
            token1: USDC,
            fee: 500,
            pool: POOL_A,
            blockNumber: 1_371_680n,
            logIndex: 0n,
          }),
        ]),
        latestBlock: 1_371_700n,
      }),
    );
    await initializeDiscoveryCache({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      cacheDir,
    });
    const paths = getDiscoveryCachePaths({ chain: "base", cacheDir });
    const before = await readFile(paths.statePath, "utf8");
    mockCreateClient.mockReturnValue(
      makeClient({
        getLogs: vi.fn(async () => {
          throw new Error("RPC_DOWN");
        }),
        latestBlock: 1_371_710n,
      }),
    );

    await expect(
      refreshDiscoveryCache({
        chain: "base",
        rpcUrl: "https://base-rpc.example",
        cacheDir,
      }),
    ).rejects.toThrow("RPC_DOWN");

    expect(await readFile(paths.statePath, "utf8")).toBe(before);
  });

  it("status reports pool count, scanned block, and lag", async () => {
    const cacheDir = await makeTempDir();
    mockCreateClient.mockReturnValue(
      makeClient({
        getLogs: vi.fn(async () => [
          poolCreatedLog({
            token0: WETH,
            token1: USDC,
            fee: 500,
            pool: POOL_A,
            blockNumber: 1_371_680n,
            logIndex: 0n,
          }),
        ]),
        latestBlock: 1_371_700n,
      }),
    );
    await initializeDiscoveryCache({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      cacheDir,
    });
    mockCreateClient.mockReturnValue(
      makeClient({ getLogs: vi.fn(async () => []), latestBlock: 1_371_750n }),
    );

    const status = await getDiscoveryCacheStatus({
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      cacheDir,
    });

    expect(status.state.poolCount).toBe(1);
    expect(status.state.scannedToBlock).toBe("1371700");
    expect(status.safeLatestBlock).toBe(1_371_750n);
    expect(status.lagBlocks).toBe(50n);
  });

  it("fails explicitly when cache is missing", async () => {
    const cacheDir = await makeTempDir();

    await expect(loadDiscoveryCache({ chain: "base", cacheDir })).rejects.toThrow(
      "DISCOVERY_CACHE_STATE_MISSING:base",
    );
  });

  it("preserves the original cause for invalid state JSON", async () => {
    const cacheDir = await makeTempDir();
    const paths = getDiscoveryCachePaths({ chain: "base", cacheDir });
    await mkdir(join(cacheDir, "base"), { recursive: true });
    await writeFile(paths.statePath, "{invalid", "utf8");
    await writeFile(paths.poolsPath, "", "utf8");

    await expect(loadDiscoveryCache({ chain: "base", cacheDir })).rejects.toMatchObject({
      message: `DISCOVERY_CACHE_STATE_INVALID:${paths.statePath}`,
      cause: expect.any(SyntaxError),
    });
  });

  it("rejects structurally invalid JSONL rows", async () => {
    const cacheDir = await makeTempDir();
    const paths = getDiscoveryCachePaths({ chain: "base", cacheDir });
    await mkdir(join(cacheDir, "base"), { recursive: true });
    await writeFile(
      paths.statePath,
      `${JSON.stringify({
        version: 1,
        chain: "base",
        factoryAddress: FACTORY,
        deploymentBlock: "1371680",
        scannedToBlock: "1371700",
        safeLatestBlock: "1371700",
        poolCount: 1,
        updatedAt: "2026-06-10T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    await writeFile(
      paths.poolsPath,
      `${JSON.stringify({
        blockNumber: "1371680",
        blockHash: "0x".padEnd(66, "2"),
        transactionHash: "0x".padEnd(66, "3"),
        logIndex: "0",
        token0: WETH.toLowerCase(),
        token1: USDC.toLowerCase(),
        fee: "500",
        tickSpacing: 10,
        pool: POOL_A.toLowerCase(),
      })}\n`,
      "utf8",
    );

    await expect(loadDiscoveryCache({ chain: "base", cacheDir })).rejects.toThrow(
      `DISCOVERY_CACHE_STATE_INVALID:${paths.poolsPath}:1:fee`,
    );
  });

  it("dedupes duplicate JSONL rows by pool address when loading candidates", async () => {
    const cacheDir = await makeTempDir();
    const paths = getDiscoveryCachePaths({ chain: "base", cacheDir });
    await mkdir(join(cacheDir, "base"), { recursive: true });
    await writeFile(
      paths.statePath,
      `${JSON.stringify({
        version: 1,
        chain: "base",
        factoryAddress: FACTORY,
        deploymentBlock: "1371680",
        scannedToBlock: "1371700",
        safeLatestBlock: "1371700",
        poolCount: 2,
        updatedAt: "2026-06-10T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    const row = {
      blockNumber: "1371680",
      blockHash: "0x".padEnd(66, "2"),
      transactionHash: "0x".padEnd(66, "3"),
      logIndex: "0",
      token0: WETH.toLowerCase(),
      token1: USDC.toLowerCase(),
      fee: 500,
      tickSpacing: 10,
      pool: POOL_A.toLowerCase(),
    };
    await writeFile(
      paths.poolsPath,
      `${JSON.stringify(row)}\n${JSON.stringify({ ...row, logIndex: "1" })}\n`,
      "utf8",
    );

    const loaded = await loadDiscoveryCache({ chain: "base", cacheDir });

    expect(loaded.rows).toHaveLength(1);
    expect(loaded.candidates).toHaveLength(1);
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dex-pool-cache-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeClient(input: {
  getLogs: EvmJsonRpcClient["getLogs"];
  latestBlock: bigint;
}): EvmJsonRpcClient {
  return {
    getLogs: input.getLogs,
    getLatestBlockNumber: async () => input.latestBlock,
    getBlockByNumber: async (blockNumber: bigint) =>
      ({
        number: toHex(blockNumber),
        hash: "0x".padEnd(66, "1"),
        timestamp: toHex(1_700_000_000n + blockNumber),
      }) satisfies EvmBlock,
    getChainId: async () => 8453n,
    call: vi.fn(),
  };
}

function poolCreatedLog(input: {
  token0: string;
  token1: string;
  fee: number;
  pool: string;
  blockNumber: bigint;
  logIndex: bigint;
}) {
  return {
    address: FACTORY,
    topics: [
      UNISWAP_V3_POOL_CREATED_TOPIC,
      topicAddress(input.token0),
      topicAddress(input.token1),
      toTopic(BigInt(input.fee)),
    ],
    data: `0x${word(10n)}${addressWord(input.pool)}`,
    blockNumber: toHex(input.blockNumber),
    blockHash: "0x".padEnd(66, "2"),
    transactionHash: "0x".padEnd(66, "3"),
    transactionIndex: "0x0",
    logIndex: toHex(input.logIndex),
  } as const;
}

function topicAddress(address: string): `0x${string}` {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function addressWord(address: string): string {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

function toTopic(value: bigint): `0x${string}` {
  return `0x${word(value)}`;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function toHex(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}
