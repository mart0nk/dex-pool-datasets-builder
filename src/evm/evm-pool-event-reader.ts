import type { DexPoolConfig, DexPoolQualitySummary, NormalizedPoolSwap } from '../types/dex-pool-dataset.types.js';
import { sortSwaps } from '../candles/pool-candle-builder.js';
import { planBlockRanges } from './block-range-planner.js';
import { BlockTimestampCache } from './block-timestamp-cache.js';
import { createEvmJsonRpcClient, type EvmRpcFetch } from './evm-json-rpc-client.js';
import { decodeUniswapV3SwapLog, UNISWAP_V3_SWAP_TOPIC } from './uniswap-v3-swap-decoder.js';

export type ReadUniswapV3PoolSwapsOptions = {
  pool: DexPoolConfig;
  rpcUrl: string;
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize?: bigint;
  fetchFn?: EvmRpcFetch;
};

export type ReadUniswapV3PoolSwapsWithQualityOptions = ReadUniswapV3PoolSwapsOptions & {
  failFast?: boolean;
};

export type ReadUniswapV3PoolSwapsResult = {
  swaps: NormalizedPoolSwap[];
  quality: DexPoolQualitySummary;
};

export async function readUniswapV3PoolSwaps(
  options: ReadUniswapV3PoolSwapsOptions
): Promise<NormalizedPoolSwap[]> {
  return (await readUniswapV3PoolSwapsWithQuality({
    ...options,
    failFast: true,
  })).swaps;
}

export async function readUniswapV3PoolSwapsWithQuality(
  options: ReadUniswapV3PoolSwapsWithQualityOptions
): Promise<ReadUniswapV3PoolSwapsResult> {
  if (options.pool.kind !== 'UNISWAP_V3_STYLE') {
    throw new Error(`UNSUPPORTED_POOL_KIND_FOR_READER:${options.pool.kind}`);
  }

  const client = createEvmJsonRpcClient({
    rpcUrl: options.rpcUrl,
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
  });
  const timestampCache = new BlockTimestampCache(client);
  const ranges = planBlockRanges(options.fromBlock, options.toBlock, options.chunkSize ?? 5_000n);
  const swaps: NormalizedPoolSwap[] = [];
  const quality: DexPoolQualitySummary = {
    passed: true,
    duplicateLogs: 0,
    invalidLogs: 0,
    missingBlockTimestamps: 0,
    reorgConflicts: 0,
    noTradeIntervals: 0,
    extremeWickCandles: 0,
    incompleteBlockRanges: 0,
  };
  const failFast = options.failFast === true;

  for (const range of ranges) {
    let logs;
    try {
      logs = await client.getLogs({
        address: options.pool.poolAddress,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        topics: [UNISWAP_V3_SWAP_TOPIC],
      });
    } catch (error) {
      quality.incompleteBlockRanges += 1;
      quality.passed = false;
      if (failFast) throw error;
      continue;
    }

    const seenLogs = new Set<string>();
    for (const log of logs) {
      let logKey: string;
      let blockNumber: bigint;
      try {
        logKey = makeLogIdentityKey(log);
        blockNumber = BigInt(log.blockNumber);
      } catch (error) {
        quality.invalidLogs += 1;
        quality.passed = false;
        if (failFast) {
          throw new Error(`EVM_LOG_IDENTITY_INVALID:${String(log.blockNumber)}:${String(log.transactionIndex)}:${String(log.logIndex)}`, {
            cause: error,
          });
        }
        continue;
      }
      if (seenLogs.has(logKey)) {
        quality.duplicateLogs += 1;
        quality.passed = false;
        if (failFast) {
          throw new Error(`DUPLICATE_SWAP_LOG:${logKey}`);
        }
        continue;
      }
      seenLogs.add(logKey);

      let block;
      try {
        block = await timestampCache.getBlockTimestamp(blockNumber);
      } catch (error) {
        quality.missingBlockTimestamps += 1;
        quality.passed = false;
        if (failFast) throw error;
        continue;
      }
      if (block.hash.toLowerCase() !== log.blockHash.toLowerCase()) {
        quality.reorgConflicts += 1;
        quality.passed = false;
        if (failFast) {
          throw new Error(`EVM_REORG_CONFLICT:${blockNumber.toString()}:${log.blockHash}:${block.hash}`);
        }
        continue;
      }
      try {
        swaps.push(decodeUniswapV3SwapLog({
          pool: options.pool,
          log,
          blockTimestamp: block.timestamp,
        }));
      } catch (error) {
        quality.invalidLogs += 1;
        quality.passed = false;
        if (failFast) throw error;
      }
    }
  }

  return { swaps: sortSwaps(swaps), quality };
}

function makeLogIdentityKey(log: { blockNumber: string; transactionIndex: string; logIndex: string }): string {
  return [
    BigInt(log.blockNumber).toString(),
    BigInt(log.transactionIndex).toString(),
    BigInt(log.logIndex).toString(),
  ].join(':');
}
