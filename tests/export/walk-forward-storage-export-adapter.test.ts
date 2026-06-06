import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateDexPoolCandles,
  buildCandlesFromSwaps,
  fillNoTradeIntervals,
  type DexPoolConfig,
  type DexPoolDatasetManifest,
  type HistoricalKline,
  type NormalizedPoolSwap,
} from '../../src/index.js';
import { exportDexWalkForwardDatasetToStorage } from '../../src/export/walk-forward-storage-export-adapter.js';
import { LocalDatasetStorage } from '../../src/storage/local-dataset-storage.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'storage-export-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('exportDexWalkForwardDatasetToStorage', () => {
  it('writes all timeframe JSONL files, dex-quality.jsonl, and manifest.json to storage', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    const pool = poolConfig();
    const oneMinute = fillNoTradeIntervals({
      candles: buildCandlesFromSwaps({
        pool,
        timeframe: '1m',
        swaps: [
          swap({ blockTimestamp: 1_700_000_000, price: 2000, amount0: -1, amount1: 2000, logIndex: 1 }),
          swap({ blockTimestamp: 1_700_000_120, price: 2020, amount0: -1, amount1: 2020, blockNumber: 12n, logIndex: 1 }),
        ],
      }),
      timeframe: '1m',
      fromTime: 1_700_000_000_000,
      toTime: 1_700_000_120_000,
    });
    const threeMinute = aggregateDexPoolCandles(oneMinute, '3m');

    const result = await exportDexWalkForwardDatasetToStorage({
      truthManifest: truthManifest(pool),
      candlesByTimeframe: { '1m': oneMinute, '3m': threeMinute },
      storage,
      rootKey: 'datasets/my-pool',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    // Verify returned manifest structure
    expect(result.manifest).toMatchObject({
      datasetType: 'DEX_POOL',
      replayFormat: 'HISTORICAL_KLINE_COMPATIBLE',
      source: 'DEX_POOL',
      datasetVersion: 'dex-pool-replay-v1',
      symbols: ['WETHUSDC'],
      replaySymbols: ['WETHUSDC'],
      sourceDataset: {
        chain: 'base',
        dex: 'uniswap_v3',
        poolAddress: pool.poolAddress,
      },
      adapterPolicy: {
        noTradeIntervalPolicy: 'FILL_FORWARD_ZERO_VOLUME',
        availableFromPolicy: 'CANDLE_CLOSE_TIME',
      },
    });

    // Verify timeframe JSONL written correctly
    const klineRows = (await readFile(join(dir, 'datasets/my-pool/WETHUSDC/1m.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as HistoricalKline);
    expect(klineRows).toHaveLength(3);
    expect(klineRows[1]).toMatchObject({
      symbol: 'WETHUSDC',
      source: 'DEX_POOL',
      volume: 0,
      turnover: 0,
      trades: 0,
      closed: true,
    });

    // Verify 3m timeframe written
    const threeMinRows = (await readFile(join(dir, 'datasets/my-pool/WETHUSDC/3m.jsonl'), 'utf8'))
      .trim()
      .split('\n');
    expect(threeMinRows.length).toBeGreaterThan(0);

    // Verify dex-quality.jsonl written
    const qualityRows = (await readFile(join(dir, 'datasets/my-pool/dex-quality.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { qualityFlags: Record<string, boolean> });
    expect(qualityRows.some((row) => row.qualityFlags.fillForwarded)).toBe(true);

    // Verify manifest.json written with correct timeframes
    const storedManifest = JSON.parse(
      await readFile(join(dir, 'datasets/my-pool/manifest.json'), 'utf8')
    ) as typeof result.manifest;
    expect(storedManifest.timeframes).toEqual({ WETHUSDC: ['1m', '3m'] });
  });

  it('writes manifest.json last — it is the final entry in writtenObjects', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    const pool = poolConfig();
    const oneMinute = fillNoTradeIntervals({
      candles: buildCandlesFromSwaps({
        pool,
        timeframe: '1m',
        swaps: [
          swap({ blockTimestamp: 1_700_000_000, price: 2000, amount0: -1, amount1: 2000, logIndex: 1 }),
          swap({ blockTimestamp: 1_700_000_120, price: 2020, amount0: -1, amount1: 2020, blockNumber: 12n, logIndex: 1 }),
        ],
      }),
      timeframe: '1m',
      fromTime: 1_700_000_000_000,
      toTime: 1_700_000_120_000,
    });

    const result = await exportDexWalkForwardDatasetToStorage({
      truthManifest: truthManifest(pool, {
        from: '2023-11-14T22:13:00.000Z',
        to: '2023-11-14T22:15:59.999Z',
        timeframes: ['1m'],
      }),
      candlesByTimeframe: { '1m': oneMinute },
      storage,
      rootKey: 'out',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    const lastWritten = result.writtenObjects.at(-1);
    expect(lastWritten?.key).toBe('out/manifest.json');
  });

  it('produces a deterministic checksum for the same input regardless of rootKey', async () => {
    const dirA = await makeTempDir();
    const dirB = await makeTempDir();
    const pool = poolConfig();
    const oneMinute = fillNoTradeIntervals({
      candles: buildCandlesFromSwaps({
        pool,
        timeframe: '1m',
        swaps: [
          swap({ blockTimestamp: 1_700_000_000, price: 2000, amount0: -1, amount1: 2000, logIndex: 1 }),
          swap({ blockTimestamp: 1_700_000_120, price: 2020, amount0: -1, amount1: 2020, blockNumber: 12n, logIndex: 1 }),
        ],
      }),
      timeframe: '1m',
      fromTime: 1_700_000_000_000,
      toTime: 1_700_000_120_000,
    });
    const manifest = truthManifest(pool, {
      from: '2023-11-14T22:13:00.000Z',
      to: '2023-11-14T22:15:59.999Z',
      timeframes: ['1m'],
    });

    const a = await exportDexWalkForwardDatasetToStorage({
      truthManifest: manifest,
      candlesByTimeframe: { '1m': oneMinute },
      storage: new LocalDatasetStorage(dirA),
      rootKey: 'rootA',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    const b = await exportDexWalkForwardDatasetToStorage({
      truthManifest: manifest,
      candlesByTimeframe: { '1m': oneMinute },
      storage: new LocalDatasetStorage(dirB),
      rootKey: 'rootB',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(a.manifest.checksum).toBe(b.manifest.checksum);
  });

  it('returns quality records for candles with quality flags', async () => {
    const dir = await makeTempDir();
    const storage = new LocalDatasetStorage(dir);
    const pool = poolConfig();
    const oneMinute = fillNoTradeIntervals({
      candles: buildCandlesFromSwaps({
        pool,
        timeframe: '1m',
        swaps: [
          swap({ blockTimestamp: 1_700_000_000, price: 2000, amount0: -1, amount1: 2000, logIndex: 1 }),
          swap({ blockTimestamp: 1_700_000_120, price: 2020, amount0: -1, amount1: 2020, blockNumber: 12n, logIndex: 1 }),
        ],
      }),
      timeframe: '1m',
      fromTime: 1_700_000_000_000,
      toTime: 1_700_000_120_000,
    });

    const result = await exportDexWalkForwardDatasetToStorage({
      truthManifest: truthManifest(pool, {
        from: '2023-11-14T22:13:00.000Z',
        to: '2023-11-14T22:15:59.999Z',
        timeframes: ['1m'],
      }),
      candlesByTimeframe: { '1m': oneMinute },
      storage,
      rootKey: 'out',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    // The fill-forwarded middle candle should produce a quality record
    expect(result.qualityRecords.some((r) => r.qualityFlags.fillForwarded)).toBe(true);
    expect(result.qualityRecords.every((r) => r.symbol === 'WETHUSDC')).toBe(true);
  });
});

// --- Test fixtures (mirroring dex-pool-datasets.test.ts) ---

function poolConfig(): DexPoolConfig {
  return {
    id: 'base-uniswap-v3-weth-usdc-005',
    chain: 'base',
    dex: 'uniswap_v3',
    kind: 'UNISWAP_V3_STYLE',
    poolAddress: '0x0000000000000000000000000000000000000001',
    token0: {
      symbol: 'WETH',
      address: '0x0000000000000000000000000000000000000002',
      decimals: 18,
    },
    token1: {
      symbol: 'USDC',
      address: '0x0000000000000000000000000000000000000003',
      decimals: 6,
    },
    baseToken: 'token0',
    quoteToken: 'token1',
    feeTier: 500,
    startBlock: '12300000',
  };
}

function truthManifest(
  pool: DexPoolConfig,
  overrides?: { from?: string; to?: string; timeframes?: DexPoolDatasetManifest['timeframes'] }
): DexPoolDatasetManifest {
  return {
    datasetType: 'DEX_POOL',
    sourceMode: 'ONCHAIN_POOL_EVENTS',
    datasetId: 'dex-base-uniswap-v3-weth-usdc-smoke',
    chain: pool.chain,
    dex: pool.dex,
    poolKind: pool.kind,
    poolAddress: pool.poolAddress,
    token0: pool.token0,
    token1: pool.token1,
    baseToken: pool.baseToken,
    quoteToken: pool.quoteToken,
    blockRange: {
      fromBlock: '10',
      toBlock: '12',
      finalizedToBlock: '12',
      finalityMode: 'safe',
    },
    timeRange: {
      from: overrides?.from ?? '2023-11-14T22:12:00.000Z',
      to: overrides?.to ?? '2023-11-14T22:17:59.999Z',
    },
    source: {
      rpcProvider: 'configured_archive_rpc',
      eventSource: 'eth_getLogs',
      events: ['Swap'],
    },
    timeframes: overrides?.timeframes ?? ['1m', '3m'],
    replaySafety: {
      closedCandlesOnly: true,
      availableFromCloseTime: true,
      lookaheadSafe: true,
      intrablockOrderingPreserved: true,
    },
    quality: {
      passed: true,
      duplicateLogs: 0,
      invalidLogs: 0,
      missingBlockTimestamps: 0,
      reorgConflicts: 0,
      noTradeIntervals: 1,
      extremeWickCandles: 0,
      incompleteBlockRanges: 0,
    },
    generatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function swap(input: {
  blockTimestamp: number;
  price: number;
  amount0: number;
  amount1: number;
  blockNumber?: bigint;
  logIndex: number;
}): NormalizedPoolSwap {
  return {
    chain: 'base',
    dex: 'uniswap_v3',
    poolAddress: '0x0000000000000000000000000000000000000001',
    blockNumber: input.blockNumber ?? 10n,
    blockHash: `0xblock${String(input.blockNumber ?? 10n)}${input.logIndex}`,
    transactionHash: `0xtx${String(input.blockNumber ?? 10n)}${input.logIndex}`,
    transactionIndex: 0,
    logIndex: input.logIndex,
    blockTimestamp: input.blockTimestamp,
    token0Symbol: 'WETH',
    token1Symbol: 'USDC',
    amount0: input.amount0,
    amount1: input.amount1,
    priceToken1PerToken0: input.price,
    priceToken0PerToken1: 1 / input.price,
  };
}
