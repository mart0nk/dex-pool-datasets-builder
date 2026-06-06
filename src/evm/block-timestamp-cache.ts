import type { EvmJsonRpcClient } from './evm-json-rpc-client.js';
import { hexToNumber } from './evm-json-rpc-client.js';

const EVM_BLOCK_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export type CachedBlockTimestamp = {
  hash: string;
  timestamp: number;
};

export class BlockTimestampCache {
  private readonly timestamps = new Map<string, CachedBlockTimestamp>();

  constructor(
    private readonly client: EvmJsonRpcClient,
    private readonly options: { maxEntries?: number } = {}
  ) {}

  async getTimestamp(blockNumber: bigint): Promise<number> {
    const key = blockNumber.toString();
    const cached = this.timestamps.get(key);
    if (cached !== undefined) {
      return cached.timestamp;
    }

    const block = await this.client.getBlockByNumber(blockNumber);
    const timestamp = parseBlockTimestamp(block.timestamp, blockNumber);
    this.evictIfNeeded();
    this.timestamps.set(key, {
      hash: isValidBlockHash(block.hash) ? block.hash : '',
      timestamp,
    });
    return timestamp;
  }

  async getBlockTimestamp(blockNumber: bigint): Promise<CachedBlockTimestamp> {
    const key = blockNumber.toString();
    const cached = this.timestamps.get(key);
    if (cached !== undefined) {
      if (!isValidBlockHash(cached.hash)) {
        this.timestamps.delete(key);
      } else {
        return cached;
      }
    }

    const block = await this.client.getBlockByNumber(blockNumber);
    if (!isValidBlockHash(block.hash)) {
      throw new Error(`EVM_BLOCK_HASH_INVALID:${blockNumber.toString()}:${block.hash}`);
    }
    const timestamp = parseBlockTimestamp(block.timestamp, blockNumber);
    const record = {
      hash: block.hash,
      timestamp,
    };
    this.evictIfNeeded();
    this.timestamps.set(key, record);
    return record;
  }

  get size(): number {
    return this.timestamps.size;
  }

  private evictIfNeeded(): void {
    const maxEntries = this.options.maxEntries ?? 100_000;
    if (maxEntries <= 0) {
      this.timestamps.clear();
      return;
    }
    while (this.timestamps.size >= maxEntries) {
      const oldestKey = this.timestamps.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.timestamps.delete(oldestKey);
    }
  }
}

function isValidBlockHash(value: string): boolean {
  return EVM_BLOCK_HASH_PATTERN.test(value);
}

function parseBlockTimestamp(value: unknown, blockNumber: bigint): number {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`EVM_BLOCK_TIMESTAMP_MISSING:${blockNumber.toString()}`);
  }
  try {
    return hexToNumber(value as `0x${string}`);
  } catch (error) {
    throw new Error(`EVM_BLOCK_TIMESTAMP_INVALID:${blockNumber.toString()}:${value}`, {
      cause: error,
    });
  }
}
