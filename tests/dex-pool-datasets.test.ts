import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateDexPoolCandles,
  buildCandlesFromSwaps,
  exportDexWalkForwardDataset,
  fillNoTradeIntervals,
  planBlockRanges,
  readUniswapV3PoolSwaps,
  UNISWAP_V3_SWAP_TOPIC,
  validatePoolRegistry,
  type DexPoolConfig,
  type DexPoolDatasetManifest,
  type EvmRpcFetch,
  type HistoricalKline,
  type NormalizedPoolSwap,
} from '../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('dex-pool-datasets', () => {
  it('validates the MVP pool registry shape and rejects unsupported v2 pools for now', () => {
    const valid = validatePoolRegistry([poolConfig()]);
    expect(valid.errors).toEqual([]);
    expect(valid.pools[0]?.id).toBe('base-uniswap-v3-weth-usdc-005');

    const invalid = validatePoolRegistry([{ ...poolConfig(), kind: 'UNISWAP_V2_STYLE' }]);
    expect(invalid.errors).toContain('POOL_KIND_NOT_MVP:base-uniswap-v3-weth-usdc-005:UNISWAP_V2_STYLE');
  });

  it('keeps valid registry entries when another pool id is a substring match in an error', () => {
    const result = validatePoolRegistry([
      { ...poolConfig(), id: '10', poolAddress: 'not-an-address' },
      { ...poolConfig(), id: '1' },
    ]);

    expect(result.errors).toContain('POOL_ADDRESS_INVALID:10:poolAddress');
    expect(result.pools.map((pool) => pool.id)).toEqual(['1']);
  });

  it('plans EVM getLogs block ranges without exceeding the chunk size', () => {
    expect(planBlockRanges(10n, 25n, 7n)).toEqual([
      { fromBlock: 10n, toBlock: 16n },
      { fromBlock: 17n, toBlock: 23n },
      { fromBlock: 24n, toBlock: 25n },
    ]);
  });

  it('reads and decodes Uniswap v3 Swap logs through eth_getLogs', async () => {
    const pool = poolConfig();
    const sqrtPriceX96 = sqrtPriceX96ForAdjustedPrice({
      priceToken1PerToken0: 3200,
      token0Decimals: pool.token0.decimals,
      token1Decimals: pool.token1.decimals,
    });
    const calls: string[] = [];
    const fetchFn: EvmRpcFetch = async (_url, init) => {
      const request = JSON.parse(init.body) as {
        id: number;
        method: string;
        params: unknown[];
      };
      calls.push(request.method);
      if (request.method === 'eth_getLogs') {
        expect(request.params[0]).toMatchObject({
          address: pool.poolAddress,
          fromBlock: '0xa',
          toBlock: '0xa',
          topics: [UNISWAP_V3_SWAP_TOPIC],
        });
        return jsonRpcResponse(request.id, [{
          address: pool.poolAddress,
          topics: [
            UNISWAP_V3_SWAP_TOPIC,
            topicAddress('0x00000000000000000000000000000000000000aa'),
            topicAddress('0x00000000000000000000000000000000000000bb'),
          ],
          data: encodeWords([
            encodeInt256(-1_500_000_000_000_000_000n),
            encodeInt256(4_800_000_000n),
            encodeUint256(sqrtPriceX96),
            encodeUint256(123456789n),
            encodeInt256(123n),
          ]),
          blockNumber: '0xa',
          blockHash: '0x00000000000000000000000000000000000000000000000000000000000000ab',
          transactionHash: '0x00000000000000000000000000000000000000000000000000000000000000cd',
          transactionIndex: '0x2',
          logIndex: '0x3',
        }]);
      }
      if (request.method === 'eth_getBlockByNumber') {
        expect(request.params).toEqual(['0xa', false]);
        return jsonRpcResponse(request.id, {
          number: '0xa',
          hash: '0x00000000000000000000000000000000000000000000000000000000000000ab',
          timestamp: '0x6553f100',
        });
      }
      throw new Error(`unexpected method ${request.method}`);
    };

    const swaps = await readUniswapV3PoolSwaps({
      pool,
      rpcUrl: 'https://rpc.test',
      fromBlock: 10n,
      toBlock: 10n,
      fetchFn,
    });

    expect(calls).toEqual(['eth_getLogs', 'eth_getBlockByNumber']);
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({
      chain: 'base',
      dex: 'uniswap_v3',
      poolAddress: pool.poolAddress,
      blockNumber: 10n,
      transactionIndex: 2,
      logIndex: 3,
      blockTimestamp: 1_700_000_000,
      amount0: -1.5,
      amount1: 4800,
      liquidityAfter: '123456789',
      tickAfter: 123,
    });
    expect(swaps[0]!.priceToken1PerToken0).toBeCloseTo(3200, 3);
  });

  it('builds DEX pool candles, fill-forwards no-trade intervals, and aggregates higher timeframes', () => {
    const pool = poolConfig();
    const oneMinute = buildCandlesFromSwaps({
      pool,
      timeframe: '1m',
      swaps: [
        swap({ blockTimestamp: 1_700_000_000, price: 2000, amount0: -1, amount1: 2000, logIndex: 1 }),
        swap({ blockTimestamp: 1_700_000_020, price: 2010, amount0: -0.5, amount1: 1005, logIndex: 2 }),
        swap({ blockTimestamp: 1_700_000_120, price: 2020, amount0: -1, amount1: 2020, blockNumber: 12n, logIndex: 1 }),
      ],
    });

    expect(oneMinute).toHaveLength(2);
    expect(oneMinute[0]).toMatchObject({
      symbol: 'WETHUSDC',
      open: 2000,
      high: 2010,
      low: 2000,
      close: 2010,
      volumeBase: 1.5,
      volumeQuote: 3005,
      tradeCount: 2,
    });

    const filled = fillNoTradeIntervals({
      candles: oneMinute,
      timeframe: '1m',
      fromTime: oneMinute[0]!.openTime,
      toTime: oneMinute.at(-1)!.openTime,
    });

    expect(filled).toHaveLength(3);
    expect(filled[1]).toMatchObject({
      open: 2010,
      high: 2010,
      low: 2010,
      close: 2010,
      volumeBase: 0,
      volumeQuote: 0,
      tradeCount: 0,
      qualityFlags: {
        noTradeInterval: true,
        fillForwarded: true,
      },
    });

    const threeMinute = aggregateDexPoolCandles(filled, '3m');
    expect(threeMinute).toHaveLength(2);
    expect(threeMinute[0]).toMatchObject({
      timeframe: '3m',
      open: 2000,
      high: 2010,
      low: 2000,
      close: 2010,
      volumeBase: 1.5,
      volumeQuote: 3005,
      tradeCount: 2,
      qualityFlags: {
        noTradeInterval: true,
        fillForwarded: true,
      },
    });
  });

  it('rejects duplicate swap log identities before candle construction', () => {
    const duplicate = swap({ blockTimestamp: 1_700_000_000, price: 2000, amount0: -1, amount1: 2000, logIndex: 1 });

    expect(() => buildCandlesFromSwaps({
      pool: poolConfig(),
      timeframe: '1m',
      swaps: [duplicate, { ...duplicate }],
    })).toThrow('DUPLICATE_SWAP_LOG:10:0:1');
  });

  it('rejects leading no-trade fill when no prior candle exists', () => {
    const candles = buildCandlesFromSwaps({
      pool: poolConfig(),
      timeframe: '1m',
      swaps: [
        swap({ blockTimestamp: 1_700_000_120, price: 2020, amount0: -1, amount1: 2020, blockNumber: 12n, logIndex: 1 }),
      ],
    });

    expect(() => fillNoTradeIntervals({
      candles,
      timeframe: '1m',
      fromTime: 1_700_000_000_000,
      toTime: 1_700_000_120_000,
    })).toThrow('DEX_FILL_LEADING_INTERVAL_WITHOUT_PRIOR_CANDLE');
  });

  it('rejects empty source candles for a non-empty fill range', () => {
    expect(() => fillNoTradeIntervals({
      candles: [],
      timeframe: '1m',
      fromTime: 1_700_000_000_000,
      toTime: 1_700_000_120_000,
    })).toThrow('DEX_FILL_EMPTY_SOURCE_RANGE');
  });

  it('exports DEX candles to the walk-forward layout without BTCUSDT CEX assumptions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dex-pool-dataset-'));
    tempDirs.push(dir);
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

    const result = await exportDexWalkForwardDataset({
      truthManifest: truthManifest(pool),
      candlesByTimeframe: {
        '1m': oneMinute,
        '3m': threeMinute,
      },
      outputDir: dir,
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

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

    const rows = (await readFile(join(dir, 'WETHUSDC', '1m.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as HistoricalKline);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      symbol: 'WETHUSDC',
      source: 'DEX_POOL',
      volume: 0,
      turnover: 0,
      trades: 0,
      closed: true,
    });

    const qualityRows = (await readFile(join(dir, 'dex-quality.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { qualityFlags: Record<string, boolean> });
    expect(qualityRows.some((row) => row.qualityFlags.fillForwarded)).toBe(true);

    const storedManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as typeof result.manifest;
    expect(storedManifest.timeframes).toEqual({ WETHUSDC: ['1m', '3m'] });
  });

  it('rejects mixed replay symbols and inconsistent truth time ranges during export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dex-pool-dataset-'));
    tempDirs.push(dir);
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
    const mixed = [{ ...oneMinute[0]!, symbol: 'WETHDAI' }, ...oneMinute.slice(1)];

    await expect(exportDexWalkForwardDataset({
      truthManifest: truthManifest(pool, {
        from: '2023-11-14T22:13:00.000Z',
        to: '2023-11-14T22:15:59.999Z',
        timeframes: ['1m'],
      }),
      candlesByTimeframe: { '1m': mixed },
      outputDir: dir,
      now: new Date('2026-06-01T00:00:00.000Z'),
    })).rejects.toThrow('DEX_REPLAY_MIXED_SYMBOLS');

    await expect(exportDexWalkForwardDataset({
      truthManifest: truthManifest(pool, {
        from: '2023-11-14T22:00:00.000Z',
        to: '2023-11-14T22:15:59.999Z',
        timeframes: ['1m'],
      }),
      candlesByTimeframe: { '1m': oneMinute },
      outputDir: dir,
      now: new Date('2026-06-01T00:00:00.000Z'),
    })).rejects.toThrow('DEX_REPLAY_PERIOD_FROM_MISMATCH');
  });

  it('computes the same checksum for the same dataset in different output directories', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'dex-pool-dataset-a-'));
    const dirB = await mkdtemp(join(tmpdir(), 'dex-pool-dataset-b-'));
    tempDirs.push(dirA, dirB);
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

    const a = await exportDexWalkForwardDataset({
      truthManifest: manifest,
      candlesByTimeframe: { '1m': oneMinute },
      outputDir: dirA,
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    const b = await exportDexWalkForwardDataset({
      truthManifest: manifest,
      candlesByTimeframe: { '1m': oneMinute },
      outputDir: dirB,
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(a.manifest.checksum).toBe(b.manifest.checksum);
  });
});

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

function jsonRpcResponse(id: number, result: unknown): ReturnType<EvmRpcFetch> {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({
      jsonrpc: '2.0',
      id,
      result,
    })),
  });
}

function sqrtPriceX96ForAdjustedPrice(input: {
  priceToken1PerToken0: number;
  token0Decimals: number;
  token1Decimals: number;
}): bigint {
  const rawPrice = input.priceToken1PerToken0 / 10 ** (input.token0Decimals - input.token1Decimals);
  return BigInt(Math.floor(Math.sqrt(rawPrice) * 2 ** 96));
}

function encodeWords(words: string[]): `0x${string}` {
  return `0x${words.join('')}`;
}

function encodeInt256(value: bigint): string {
  const encoded = value < 0n ? (1n << 256n) + value : value;
  return encodeUint256(encoded);
}

function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function topicAddress(address: `0x${string}`): `0x${string}` {
  return `0x${address.slice(2).padStart(64, '0')}`;
}
