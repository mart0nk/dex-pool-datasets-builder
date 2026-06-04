import type { DexPoolConfig, NormalizedPoolSwap } from '../types/dex-pool-dataset.types.js';
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

export async function readUniswapV3PoolSwaps(
  options: ReadUniswapV3PoolSwapsOptions
): Promise<NormalizedPoolSwap[]> {
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

  for (const range of ranges) {
    const logs = await client.getLogs({
      address: options.pool.poolAddress,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      topics: [UNISWAP_V3_SWAP_TOPIC],
    });

    for (const log of logs) {
      const blockNumber = BigInt(log.blockNumber);
      const blockTimestamp = await timestampCache.getTimestamp(blockNumber);
      swaps.push(decodeUniswapV3SwapLog({
        pool: options.pool,
        log,
        blockTimestamp,
      }));
    }
  }

  return swaps.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    if (a.transactionIndex !== b.transactionIndex) {
      return a.transactionIndex - b.transactionIndex;
    }
    return a.logIndex - b.logIndex;
  });
}
