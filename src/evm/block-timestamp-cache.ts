import type { EvmJsonRpcClient } from './evm-json-rpc-client.js';
import { hexToNumber } from './evm-json-rpc-client.js';

export class BlockTimestampCache {
  private readonly timestamps = new Map<string, number>();

  constructor(private readonly client: EvmJsonRpcClient) {}

  async getTimestamp(blockNumber: bigint): Promise<number> {
    const key = blockNumber.toString();
    const cached = this.timestamps.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const block = await this.client.getBlockByNumber(blockNumber);
    const timestamp = hexToNumber(block.timestamp);
    this.timestamps.set(key, timestamp);
    return timestamp;
  }

  get size(): number {
    return this.timestamps.size;
  }
}
