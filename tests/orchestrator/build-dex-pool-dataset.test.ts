import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDexPoolDataset } from '../../src/orchestrator/build-dex-pool-dataset.js';
import { LocalDatasetStorage } from '../../src/storage/local-dataset-storage.js';
import type { ResolvedDexBuildConfig } from '../../src/config/dex-build-config.types.js';
import type { NormalizedPoolSwap, DexPoolQualitySummary } from '../../src/types/dex-pool-dataset.types.js';

// Mock the EVM reader module — all tests share this mock
vi.mock('../../src/evm/evm-pool-event-reader.js', () => ({
  readUniswapV3PoolSwapsWithQuality: vi.fn(),
}));

// Also mock resolve-dataset-storage so we can inject our test storage instance
vi.mock('../../src/storage/resolve-dataset-storage.js', () => ({
  resolveDatasetStorage: vi.fn(),
}));

import { readUniswapV3PoolSwapsWithQuality } from '../../src/evm/evm-pool-event-reader.js';
import { resolveDatasetStorage } from '../../src/storage/resolve-dataset-storage.js';

const mockReader = vi.mocked(readUniswapV3PoolSwapsWithQuality);
const mockResolveStorage = vi.mocked(resolveDatasetStorage);

const REGISTRY_PATH = new URL('../../config/dex-pools.base.example.json', import.meta.url).pathname;
const POOL_ID = 'base-uniswap-v3-weth-usdc-005';

// Two swaps separated by exactly one minute so we get two distinct 1m candles,
// and the fill range from->to matches the first candle's openTime exactly.
const BASE_TIMESTAMP = 1_700_000_000; // seconds
const BASE_OPEN_TIME = Math.floor((BASE_TIMESTAMP * 1000) / 60_000) * 60_000; // ms, aligned to 1m
const SECOND_SWAP_TIMESTAMP = BASE_TIMESTAMP + 60; // next 1m bucket

function makeSwap(blockTimestamp: number, logIndex: number, blockNumber = 10n): NormalizedPoolSwap {
  return {
    chain: 'base',
    dex: 'uniswap_v3',
    poolAddress: '0x0000000000000000000000000000000000000001',
    blockNumber,
    blockHash: `0xblock${blockNumber.toString()}${logIndex}`,
    transactionHash: `0xtx${blockNumber.toString()}${logIndex}`,
    transactionIndex: 0,
    logIndex,
    blockTimestamp,
    token0Symbol: 'WETH',
    token1Symbol: 'USDC',
    amount0: -1,
    amount1: 2000,
    priceToken1PerToken0: 2000,
    priceToken0PerToken1: 1 / 2000,
  };
}

function makeQuality(overrides: Partial<DexPoolQualitySummary> = {}): DexPoolQualitySummary {
  return {
    passed: true,
    duplicateLogs: 0,
    invalidLogs: 0,
    missingBlockTimestamps: 0,
    reorgConflicts: 0,
    noTradeIntervals: 0,
    extremeWickCandles: 0,
    incompleteBlockRanges: 0,
    ...overrides,
  };
}

async function makeConfig(overrides: Partial<ResolvedDexBuildConfig['build']> = {}): Promise<ResolvedDexBuildConfig> {
  const registryPools = JSON.parse(await readFile(REGISTRY_PATH, 'utf8')) as ResolvedDexBuildConfig['registryPools'];
  return {
    datasetId: 'test-dataset',
    registryPools,
    network: {
      chain: 'base',
      chainId: 8453,
      rpcUrl: 'https://rpc.test',
    },
    build: {
      pools: [POOL_ID],
      fromBlock: BigInt(BASE_OPEN_TIME / 1000), // use timestamp as rough block proxy
      toBlock: BigInt(SECOND_SWAP_TIMESTAMP),
      baseTimeframe: '1m',
      timeframes: ['1m'],
      chunkSize: 5000n,
      failFast: false,
      ...overrides,
    },
    output: {
      type: 'local',
      uri: 'local:///tmp/test-output',
    },
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orchestrator-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('buildDexPoolDataset', () => {
  it('calls reader → candles → fill → export and returns a run report with expected pool', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    mockResolveStorage.mockReturnValue(storage);

    const swaps = [
      makeSwap(BASE_TIMESTAMP, 1),
      makeSwap(SECOND_SWAP_TIMESTAMP, 1, 11n),
    ];
    mockReader.mockResolvedValue({ swaps, quality: makeQuality() });

    const result = await buildDexPoolDataset(await makeConfig());

    expect(result.status).toBe('completed');
    expect(result.runReport.pools).toHaveLength(1);
    expect(result.runReport.pools[0]?.poolId).toBe(POOL_ID);
    expect(result.runReport.pools[0]?.symbol).toBe('WETHUSDC');
    expect(result.runReport.fatalErrors).toHaveLength(0);

    // writtenObjects must include manifest.json
    const writtenKeys = result.runReport.pools[0]?.writtenObjects.map((o) => o.key) ?? [];
    expect(writtenKeys.some((k) => k.endsWith('manifest.json'))).toBe(true);
  });

  it('preserves quality summary (including reorgConflicts) in the run report pool entry', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    mockResolveStorage.mockReturnValue(storage);

    const swaps = [
      makeSwap(BASE_TIMESTAMP, 1),
      makeSwap(SECOND_SWAP_TIMESTAMP, 1, 11n),
    ];
    const quality = makeQuality({ reorgConflicts: 2, passed: false });
    mockReader.mockResolvedValue({ swaps, quality });

    const result = await buildDexPoolDataset(await makeConfig());

    expect(result.runReport.pools[0]?.quality.reorgConflicts).toBe(2);
    expect(result.runReport.pools[0]?.quality.passed).toBe(false);
  });

  it('records failed quality in pool entry without adding a fatalError (failFast=false)', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    mockResolveStorage.mockReturnValue(storage);

    const swaps = [
      makeSwap(BASE_TIMESTAMP, 1),
      makeSwap(SECOND_SWAP_TIMESTAMP, 1, 11n),
    ];
    mockReader.mockResolvedValue({ swaps, quality: makeQuality({ passed: false }) });

    const result = await buildDexPoolDataset(await makeConfig());

    // Failed quality is recorded but is not a fatal error — the run itself completes
    expect(result.status).toBe('completed');
    expect(result.runReport.fatalErrors).toHaveLength(0);
    expect(result.runReport.pools[0]?.quality.passed).toBe(false);
  });

  it('writes JSONL files for all requested timeframes', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    mockResolveStorage.mockReturnValue(storage);

    const swaps = [
      makeSwap(BASE_TIMESTAMP, 1),
      makeSwap(SECOND_SWAP_TIMESTAMP, 1, 11n),
    ];
    mockReader.mockResolvedValue({ swaps, quality: makeQuality() });

    const result = await buildDexPoolDataset(await makeConfig({
      timeframes: ['1m', '5m', '15m'],
    }));

    const writtenKeys = result.runReport.pools[0]?.writtenObjects.map((o) => o.key) ?? [];
    expect(writtenKeys.some((k) => k.endsWith('1m.jsonl'))).toBe(true);
    expect(writtenKeys.some((k) => k.endsWith('5m.jsonl'))).toBe(true);
    expect(writtenKeys.some((k) => k.endsWith('15m.jsonl'))).toBe(true);
  });

  it('produces a fatalError when a requested pool ID is not in the registry', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    mockResolveStorage.mockReturnValue(storage);

    // reader should NOT be called because the pool is not found
    mockReader.mockResolvedValue({ swaps: [], quality: makeQuality() });

    const result = await buildDexPoolDataset(
      await makeConfig({ pools: ['nonexistent-pool'] })
    );

    expect(result.status).toBe('failed');
    expect(result.runReport.fatalErrors.length).toBeGreaterThan(0);
    expect(result.runReport.fatalErrors[0]?.code).toBe('POOL_NOT_FOUND');
    expect(result.runReport.fatalErrors[0]?.poolId).toBe('nonexistent-pool');
    // reader was never called
    expect(mockReader).not.toHaveBeenCalled();
  });

  it('includes timeframes in the pool entry of the run report', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    mockResolveStorage.mockReturnValue(storage);

    const swaps = [
      makeSwap(BASE_TIMESTAMP, 1),
      makeSwap(SECOND_SWAP_TIMESTAMP, 1, 11n),
    ];
    mockReader.mockResolvedValue({ swaps, quality: makeQuality() });

    const result = await buildDexPoolDataset(await makeConfig({
      timeframes: ['1m', '5m'],
    }));

    expect(result.runReport.pools[0]?.timeframes).toEqual(['1m', '5m']);
  });

  it('writes run-report.json to storage under <datasetId>/run-report.json', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    mockResolveStorage.mockReturnValue(storage);

    const swaps = [
      makeSwap(BASE_TIMESTAMP, 1),
      makeSwap(SECOND_SWAP_TIMESTAMP, 1, 11n),
    ];
    mockReader.mockResolvedValue({ swaps, quality: makeQuality() });

    await buildDexPoolDataset(await makeConfig());

    // Verify run-report.json was written to storage
    const exists = await storage.exists?.('test-dataset/run-report.json');
    expect(exists).toBe(true);
  });

  it('uses runtime registryPools and writes runtime registry source in run report', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    mockResolveStorage.mockReturnValue(storage);

    const swaps = [
      makeSwap(BASE_TIMESTAMP, 1),
      makeSwap(SECOND_SWAP_TIMESTAMP, 1, 11n),
    ];
    mockReader.mockResolvedValue({ swaps, quality: makeQuality() });

    const result = await buildDexPoolDataset(await makeConfig());

    expect(result.status).toBe('completed');
    expect(result.runReport.config.registryPath).toBe('<runtime:simple>');
  });
});
