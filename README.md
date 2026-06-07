# @dex-pool-datasets

Builds audit-friendly DEX pool candle datasets and exports replay-compatible JSONL datasets for walk-forward diagnostics.

Current scope:

- pool registry validation
- EVM block range planning
- EVM JSON-RPC `eth_getLogs` reads
- block timestamp caching via `eth_getBlockByNumber`
- Uniswap v3 `Swap` log decoding
- normalized swap to DEX pool candle conversion
- no-trade fill-forward replay policy
- timeframe aggregation
- replay-compatible export adapter with DEX sidecar quality records

Out of scope for this package slice:

- pool identity verification
- checkpointed backfills
- HTTP service orchestration
