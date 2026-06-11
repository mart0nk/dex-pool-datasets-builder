import { mkdir, readFile, rename, stat, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createEvmJsonRpcClient,
  hexToBigInt,
  type EvmJsonRpcClient,
} from "../evm/evm-json-rpc-client.js";
import { planBlockRanges } from "../evm/block-range-planner.js";
import { getUniswapV3FactoryPreset } from "../simple/uniswap-v3-factory-presets.js";
import type { DexChain } from "../types/dex-pool-dataset.types.js";
import type {
  UniswapV3PoolCacheRow,
  UniswapV3PoolCacheState,
  UniswapV3PoolCandidate,
} from "./discovery.types.js";
import {
  decodeUniswapV3PoolCreatedLog,
  poolCreatedRowToCandidate,
  UNISWAP_V3_POOL_CREATED_TOPIC,
} from "./uniswap-v3-pool-created-decoder.js";

const CACHE_VERSION = 1;
const DEFAULT_CACHE_DIR = ".data/cache";
const DEFAULT_FACTORY_SCAN_CHUNK_SIZE = 10_000n;

export type DiscoveryCachePaths = {
  poolsPath: string;
  statePath: string;
};

export type DiscoveryCacheProgressEvent =
  | {
      type: "scan_start";
      chunks: number;
      fromBlock: bigint;
      toBlock: bigint;
    }
  | {
      type: "scan_chunk";
      index: number;
      total: number;
      fromBlock: bigint;
      toBlock: bigint;
    }
  | { type: "scan_done"; foundPools: number; scannedToBlock: bigint };

export type DiscoveryCacheStatus = {
  state: UniswapV3PoolCacheState;
  safeLatestBlock: bigint;
  lagBlocks: bigint;
  paths: DiscoveryCachePaths;
};

export type DiscoveryCacheInitResult = {
  state: UniswapV3PoolCacheState;
  rows: UniswapV3PoolCacheRow[];
  paths: DiscoveryCachePaths;
};

export function getDiscoveryCachePaths(input: {
  chain: DexChain;
  cacheDir?: string;
}): DiscoveryCachePaths {
  const root = input.cacheDir ?? DEFAULT_CACHE_DIR;
  const dir = join(root, input.chain);

  return {
    poolsPath: join(dir, "uniswap-v3-pools.jsonl"),
    statePath: join(dir, "uniswap-v3-pools.state.json"),
  };
}

export async function discoveryCacheExists(input: {
  chain: DexChain;
  cacheDir?: string;
}): Promise<boolean> {
  const paths = getDiscoveryCachePaths(input);

  try {
    await stat(paths.statePath);
    await stat(paths.poolsPath);
    return true;
  } catch {
    return false;
  }
}

export async function initializeDiscoveryCache(input: {
  chain: DexChain;
  rpcUrl: string;
  cacheDir?: string;
  onProgress?: (event: DiscoveryCacheProgressEvent) => void;
}): Promise<DiscoveryCacheInitResult> {
  const client = createEvmJsonRpcClient({ rpcUrl: input.rpcUrl });
  const latestBlock = await client.getLatestBlockNumber();
  const factoryPreset = getUniswapV3FactoryPreset(input.chain);
  const paths = getDiscoveryCachePaths(input);
  const rows = await scanPoolCreatedRows({
    client,
    factoryAddress: factoryPreset.factoryAddress,
    fromBlock: factoryPreset.deploymentBlock,
    toBlock: latestBlock,
    onProgress: input.onProgress,
  });
  const dedupedRows = dedupeRowsByPool(rows);
  const state = buildState({
    chain: input.chain,
    factoryAddress: factoryPreset.factoryAddress,
    deploymentBlock: factoryPreset.deploymentBlock,
    scannedToBlock: latestBlock,
    safeLatestBlock: latestBlock,
    poolCount: dedupedRows.length,
  });

  await mkdir(dirname(paths.poolsPath), { recursive: true });
  await writeFile(paths.poolsPath, rowsToJsonl(dedupedRows), "utf8");
  await writeStateFile(paths.statePath, state);

  input.onProgress?.({
    type: "scan_done",
    foundPools: dedupedRows.length,
    scannedToBlock: latestBlock,
  });

  return {
    state,
    rows: dedupedRows,
    paths,
  };
}

export async function refreshDiscoveryCache(input: {
  chain: DexChain;
  rpcUrl: string;
  cacheDir?: string;
  onProgress?: (event: DiscoveryCacheProgressEvent) => void;
}): Promise<DiscoveryCacheInitResult> {
  const client = createEvmJsonRpcClient({ rpcUrl: input.rpcUrl });
  const latestBlock = await client.getLatestBlockNumber();
  const factoryPreset = getUniswapV3FactoryPreset(input.chain);
  const paths = getDiscoveryCachePaths(input);
  const current = await loadDiscoveryCache({
    chain: input.chain,
    cacheDir: input.cacheDir,
  });
  const startBlock = BigInt(current.state.scannedToBlock) + 1n;
  const newRows =
    startBlock <= latestBlock
      ? await scanPoolCreatedRows({
          client,
          factoryAddress: factoryPreset.factoryAddress,
          fromBlock: startBlock,
          toBlock: latestBlock,
          onProgress: input.onProgress,
        })
      : [];
  const existingPools = new Set(
    current.rows.map((row) => row.pool.toLowerCase()),
  );
  const appendRows = newRows.filter((row) => {
    const key = row.pool.toLowerCase();

    if (existingPools.has(key)) {
      return false;
    }

    existingPools.add(key);
    return true;
  });
  const allRows = [...current.rows, ...appendRows];
  const state = buildState({
    chain: input.chain,
    factoryAddress: factoryPreset.factoryAddress,
    deploymentBlock: factoryPreset.deploymentBlock,
    scannedToBlock: latestBlock,
    safeLatestBlock: latestBlock,
    poolCount: allRows.length,
  });

  if (appendRows.length > 0) {
    await appendFile(paths.poolsPath, rowsToJsonl(appendRows), "utf8");
  }

  await writeStateFile(paths.statePath, state);

  input.onProgress?.({
    type: "scan_done",
    foundPools: appendRows.length,
    scannedToBlock: latestBlock,
  });

  return {
    state,
    rows: allRows,
    paths,
  };
}

export async function getDiscoveryCacheStatus(input: {
  chain: DexChain;
  rpcUrl: string;
  cacheDir?: string;
}): Promise<DiscoveryCacheStatus> {
  const cache = await loadDiscoveryCache({
    chain: input.chain,
    cacheDir: input.cacheDir,
  });
  const client = createEvmJsonRpcClient({ rpcUrl: input.rpcUrl });
  const safeLatestBlock = await client.getLatestBlockNumber();
  const scannedToBlock = BigInt(cache.state.scannedToBlock);

  return {
    state: {
      ...cache.state,
      poolCount: cache.rows.length,
    },
    safeLatestBlock,
    lagBlocks:
      safeLatestBlock > scannedToBlock ? safeLatestBlock - scannedToBlock : 0n,
    paths: cache.paths,
  };
}

export async function loadDiscoveryCache(input: {
  chain: DexChain;
  cacheDir?: string;
}): Promise<{
  state: UniswapV3PoolCacheState;
  rows: UniswapV3PoolCacheRow[];
  candidates: UniswapV3PoolCandidate[];
  paths: DiscoveryCachePaths;
}> {
  const paths = getDiscoveryCachePaths(input);
  let state: UniswapV3PoolCacheState;
  let rawRows: string;

  try {
    state = parseState(paths.statePath, await readFile(paths.statePath, "utf8"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`DISCOVERY_CACHE_STATE_MISSING:${input.chain}`);
    }

    throw error;
  }

  try {
    rawRows = await readFile(paths.poolsPath, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`DISCOVERY_CACHE_MISSING:${input.chain}`);
    }

    throw error;
  }

  validateStateMatchesFactory({
    chain: input.chain,
    state,
  });

  const rows = dedupeRowsByPool(parseRows(rawRows, paths.poolsPath));

  return {
    state,
    rows,
    candidates: rows.map(poolCreatedRowToCandidate),
    paths,
  };
}

export function isDiscoveryCacheMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("DISCOVERY_CACHE_MISSING:") ||
    message.startsWith("DISCOVERY_CACHE_STATE_MISSING:")
  );
}

async function scanPoolCreatedRows(input: {
  client: EvmJsonRpcClient;
  factoryAddress: `0x${string}`;
  fromBlock: bigint;
  toBlock: bigint;
  onProgress?: (event: DiscoveryCacheProgressEvent) => void;
}): Promise<UniswapV3PoolCacheRow[]> {
  const ranges = planBlockRanges(
    input.fromBlock,
    input.toBlock,
    DEFAULT_FACTORY_SCAN_CHUNK_SIZE,
  );
  const rows: UniswapV3PoolCacheRow[] = [];

  input.onProgress?.({
    type: "scan_start",
    chunks: ranges.length,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock,
  });

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;

    input.onProgress?.({
      type: "scan_chunk",
      index: index + 1,
      total: ranges.length,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    });

    const logs = await input.client.getLogs({
      address: input.factoryAddress,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      topics: [UNISWAP_V3_POOL_CREATED_TOPIC],
    });

    for (const log of logs) {
      rows.push(decodeUniswapV3PoolCreatedLog(log));
    }
  }

  return rows;
}

function buildState(input: {
  chain: DexChain;
  factoryAddress: `0x${string}`;
  deploymentBlock: bigint;
  scannedToBlock: bigint;
  safeLatestBlock: bigint;
  poolCount: number;
}): UniswapV3PoolCacheState {
  return {
    version: CACHE_VERSION,
    chain: input.chain,
    factoryAddress: input.factoryAddress,
    deploymentBlock: input.deploymentBlock.toString(),
    scannedToBlock: input.scannedToBlock.toString(),
    safeLatestBlock: input.safeLatestBlock.toString(),
    poolCount: input.poolCount,
    updatedAt: new Date().toISOString(),
  };
}

async function writeStateFile(
  statePath: string,
  state: UniswapV3PoolCacheState,
): Promise<void> {
  const tempPath = `${statePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}

function parseState(path: string, raw: string): UniswapV3PoolCacheState {
  try {
    const parsed = JSON.parse(raw) as UniswapV3PoolCacheState;

    if (parsed.version !== CACHE_VERSION) {
      throw new Error("version");
    }

    return parsed;
  } catch {
    throw new Error(`DISCOVERY_CACHE_STATE_INVALID:${path}`);
  }
}

function validateStateMatchesFactory(input: {
  chain: DexChain;
  state: UniswapV3PoolCacheState;
}): void {
  const preset = getUniswapV3FactoryPreset(input.chain);

  if (
    input.state.chain !== input.chain ||
    input.state.factoryAddress.toLowerCase() !==
      preset.factoryAddress.toLowerCase() ||
    input.state.deploymentBlock !== preset.deploymentBlock.toString()
  ) {
    throw new Error(`DISCOVERY_CACHE_FACTORY_MISMATCH:${input.chain}`);
  }
}

function parseRows(raw: string, path: string): UniswapV3PoolCacheRow[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as UniswapV3PoolCacheRow;
      } catch {
        throw new Error(`DISCOVERY_CACHE_STATE_INVALID:${path}:${index + 1}`);
      }
    });
}

function dedupeRowsByPool(
  rows: UniswapV3PoolCacheRow[],
): UniswapV3PoolCacheRow[] {
  const seen = new Set<string>();
  const deduped: UniswapV3PoolCacheRow[] = [];

  for (const row of rows) {
    const key = row.pool.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function rowsToJsonl(rows: UniswapV3PoolCacheRow[]): string {
  return rows.length > 0
    ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`
    : "";
}
