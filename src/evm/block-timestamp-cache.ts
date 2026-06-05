import type { EvmJsonRpcClient } from './evm-json-rpc-client.js';
import { hexToNumber } from './evm-json-rpc-client.js';

export class BlockTimestampCache {
  private readonly timestamps = new Map<string, number>();

  constructor(
    private readonly client: EvmJsonRpcClient,
    private readonly options: { maxEntries?: number } = {}
  ) {}

  async getTimestamp(blockNumber: bigint): Promise<number> {
    const key = blockNumber.toString();
    const cached = this.timestamps.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const block = await this.client.getBlockByNumber(blockNumber);
    const timestamp = hexToNumber(block.timestamp);
    this.evictIfNeeded();
    this.timestamps.set(key, timestamp);
    return timestamp;
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
