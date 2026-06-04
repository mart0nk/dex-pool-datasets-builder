# @trader-agent/dex-pool-datasets

Builds audit-friendly DEX pool candle datasets and exports replay-compatible JSONL datasets for trader-agent walk-forward diagnostics.

Current scope:

- pool registry validation
- EVM block range planning
- normalized swap to DEX pool candle conversion
- no-trade fill-forward replay policy
- timeframe aggregation
- replay-compatible export adapter with DEX sidecar quality records

Out of scope for this package slice:

- live RPC log ingestion
- ABI decoding
- pool identity verification
- checkpointed backfills
- HTTP service orchestration
