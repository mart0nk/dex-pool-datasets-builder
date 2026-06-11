# @trader-agent/dex-pool-datasets

Builds audit-friendly DEX pool candle datasets from on-chain pool events and exports replay-compatible JSONL datasets for walk-forward diagnostics.

The package is designed for deterministic historical DEX pool backfills:

```text
on-chain Swap logs
  → normalized swaps
  → DEX pool candles
  → no-trade fill-forward
  → timeframe aggregation
  → replay-compatible JSONL
```

---

## Current scope

- simple CLI mode for Uniswap v3-style pools
- RPC-backed Uniswap v3 active-pool discovery
- pair-based pool resolution via Uniswap v3 factory `getPool`
- direct pool-address builds
- token-address + fee pool resolution
- curated token/pair presets for common liquid pairs
- runtime pool registry construction for selected pools
- EVM block range planning
- date range to block range resolution
- EVM JSON-RPC `eth_getLogs` reads
- block timestamp lookup via `eth_getBlockByNumber`
- persistent block timestamp cache
- Uniswap v3 `Swap` log decoding
- normalized swap to DEX pool candle conversion
- no-trade fill-forward replay policy
- timeframe aggregation
- replay-compatible JSONL export adapter
- DEX sidecar quality records
- local and S3 output backends
- verbose progress logging for long-running builds
- pool selection audit metadata in manifests
- `.env` loading for RPC URLs
- RPC retry/backoff for rate-limited providers

---

## Out of scope for this package slice

- full multi-DEX adapter support
- checkpointed/resumable backfills
- HTTP service orchestration
- hosted API service
- automatic liquidity/TVL/USD-volume ranking across all pools
- automatic discovery of all pools for a token pair
- full production scheduler/orchestrator
- full independent pool identity verification beyond Uniswap v3-style metadata/factory resolution

---

## Install

```bash
npm ci
npm run build
```

For development:

```bash
npm run typecheck
npm test
npm run build
```

---

## Environment

Create a local `.env` file:

```bash
cp .env.example .env
```

Example `.env`:

```env
BASE_RPC_URL=https://mainnet.base.org
ETH_RPC_URL=https://your-ethereum-archive-rpc
ARBITRUM_RPC_URL=https://your-arbitrum-archive-rpc
POLYGON_RPC_URL=https://your-polygon-archive-rpc
BSC_RPC_URL=https://your-bsc-archive-rpc
```

The CLI automatically loads `.env`.

For historical builds, use an archive-capable RPC. Public RPC endpoints can work for small ranges, but they may be slow or rate-limited.

---

## Local CLI usage

During development, run the CLI directly from TypeScript source:

```bash
npm run cli -- inspect --chain base --pair WETH/USDC

npm run cli -- build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

To run the compiled CLI through npm:

```bash
npm run build

npm run dex-pool -- inspect --chain base --pair WETH/USDC

npm run dex-pool -- build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

To install the CLI locally as `dex-pool`:

```bash
npm run build
npm link
```

Then use:

```bash
dex-pool inspect --chain base --pair WETH/USDC

dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

To remove the local link:

```bash
npm unlink -g @trader-agent/dex-pool-datasets
```

---

## Quickstart

Build a Base WETH/USDC Uniswap v3-style dataset by pair:

```bash
dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

For curated liquid pairs with a known default fee, the fee can be omitted:

```bash
dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

Build by direct pool contract:

```bash
dex-pool build \
  --chain base \
  --pool 0xd0b53d9277642d899df5c87a3966a349a798f224 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

Build by token addresses and fee:

```bash
dex-pool build \
  --chain base \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

---

## Configuration model

`dex-pool` uses a single simple configuration model.

You can provide that model directly as CLI flags:

```bash
dex-pool build \
  --chain base \
  --pairs WETH/USDC,cbBTC/WETH:3000 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --dataset-id base-two-pairs
```

Or through `dex-pool.config.json`:

```bash
dex-pool build --config dex-pool.config.json
```

Example config:

```json
{
  "chain": "base",
  "rpc": "env:BASE_RPC_URL",
  "pairs": ["WETH/USDC", "cbBTC/WETH:3000"],
  "from": "2024-01-01",
  "to": "2024-01-02",
  "datasetId": "base-two-pairs",
  "timeframes": ["1m", "5m", "15m", "1h", "4h"],
  "out": "./data/dex-pool-datasets"
}
```

Both paths resolve into the same internal build plan.

The older registry/profile/block-range config model is not part of the public CLI surface.

---

## Discover top pools

Discover the most active Uniswap v3 pools from recent RPC logs:

```bash
dex-pool discover \
  --chain base \
  --top 10
```

Default discovery ranks by swap count over the last 7 days and uses only the chain RPC URL, such as `BASE_RPC_URL`.

Expected output:

```text
Top active Uniswap v3 pools by swapCount over last 7 days

Rank  Pair        Fee   Swaps  Pool
1     WETH/USDC   500   15342  0xd0b53d9277642d899df5c87a3966a349a798f224
```

For quote-token universes, rank pools containing the selected quote token by total quote volume:

```bash
dex-pool discover \
  --chain base \
  --top 10 \
  --by quoteVolume \
  --quote USDC \
  --lookback-days 7
```

Expected output:

```text
Top Uniswap v3 pools by quoteVolume(USDC) over last 7 days

Rank  Pair        Fee   QuoteVolume(USDC)  Pool
1     WETH/USDC   500   123456789.12       0xd0b53d9277642d899df5c87a3966a349a798f224
```

Write a simple build config from discovered canonical pool addresses:

```bash
dex-pool discover \
  --chain base \
  --top 10 \
  --write-config dex-pool.config.json
```

The generated config uses `pools[]`, not `pairs[]`, because discovery has already resolved canonical pool contracts.

---

## Inspect a pool or pair

Inspect by pair:

```bash
dex-pool inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

Expected output:

```text
Pool: 0xd0b53d9277642d899df5c87a3966a349a798f224
Resolved by: factory_getPool
Chain: base
DEX: uniswap_v3
Kind: UNISWAP_V3_STYLE
Fee tier: 500
Generated ID: base-uniswap-v3-weth-usdc-500-d0b53d92

token0: WETH 0x4200000000000000000000000000000000000006 decimals=18
token1: USDC 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 decimals=6
base/quote: WETH/USDC
```

Inspect by curated pair preset:

```bash
dex-pool inspect \
  --chain base \
  --pair WETH/USDC
```

Expected resolution mode:

```text
Resolved by: liquid_pair_preset
```

Inspect by direct pool address:

```bash
dex-pool inspect \
  --chain base \
  --pool 0xd0b53d9277642d899df5c87a3966a349a798f224
```

Expected resolution mode:

```text
Resolved by: direct_pool
```

Inspect by token addresses and fee:

```bash
dex-pool inspect \
  --chain base \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --fee 500
```

JSON output:

```bash
dex-pool inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --json
```

---

## Doctor checks

Check RPC and chain connectivity:

```bash
dex-pool doctor --chain base
```

Check RPC, chain, and pool metadata:

```bash
dex-pool doctor \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

Expected output:

```text
✓ rpc — BASE_RPC_URL
✓ chainId — expected=8453 actual=8453
✓ latestBlock — 12345678
✓ pool — WETH/USDC fee=500
```

---

## Create a simple config

Create a local `dex-pool.config.json`:

```bash
dex-pool init --chain base --force
```

Generated config:

```json
{
  "chain": "base",
  "rpc": "env:BASE_RPC_URL",
  "pair": "WETH/USDC",
  "fee": 500,
  "from": "2024-01-01",
  "to": "2024-01-02",
  "timeframes": ["1m", "5m", "15m", "1h", "4h"],
  "out": "./data/dex-pool-datasets"
}
```

Build from config:

```bash
dex-pool build \
  --config dex-pool.config.json \
  --verbose
```

`dex-pool.config.json` is ignored by git. Use `config/dex-pool.config.example.json` as the committed example.

---

## Simple config example

```json
{
  "chain": "base",
  "rpc": "env:BASE_RPC_URL",
  "pair": "WETH/USDC",
  "fee": 500,
  "from": "2024-01-01",
  "to": "2024-01-02",
  "timeframes": ["1m", "5m", "15m", "1h", "4h"],
  "out": "./data/dex-pool-datasets"
}
```

Alternative direct-pool config:

```json
{
  "chain": "base",
  "rpc": "env:BASE_RPC_URL",
  "pool": "0xd0b53d9277642d899df5c87a3966a349a798f224",
  "from": "2024-01-01",
  "to": "2024-01-02",
  "timeframes": ["1m", "5m", "15m", "1h", "4h"],
  "out": "./data/dex-pool-datasets"
}
```

---

## Output format

The package exports replay-compatible JSONL files.

Each candle row is one JSON object per line:

```json
{
  "symbol": "WETHUSDC",
  "timeframe": "1m",
  "openTime": 1704067200000,
  "closeTime": 1704067259999,
  "open": 2280.12,
  "high": 2281.04,
  "low": 2279.88,
  "close": 2280.55,
  "volume": 12.345,
  "turnover": 28152.44,
  "quoteVolume": 28152.44,
  "trades": 37,
  "closed": true,
  "source": "DEX_POOL"
}
```

Fields:

| Field         | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| `symbol`      | Replay symbol, usually `BASEQUOTE`, e.g. `WETHUSDC`        |
| `timeframe`   | Candle timeframe, e.g. `1m`, `5m`, `1h`                    |
| `openTime`    | Candle open timestamp in UTC epoch milliseconds            |
| `closeTime`   | Inclusive candle close timestamp in UTC epoch milliseconds |
| `open`        | Open price                                                 |
| `high`        | High price                                                 |
| `low`         | Low price                                                  |
| `close`       | Close price                                                |
| `volume`      | Base-token volume                                          |
| `turnover`    | Quote-token volume                                         |
| `quoteVolume` | Quote-token volume                                         |
| `trades`      | Number of swaps inside the candle                          |
| `closed`      | Always `true`                                              |
| `source`      | Always `DEX_POOL`                                          |

---

## Output structure

Local output is written under:

```text
data/dex-pool-datasets/
  <datasetId>/
    run-report.json
    <poolId>/
      <SYMBOL>/
        1m.jsonl
        5m.jsonl
        15m.jsonl
        1h.jsonl
        4h.jsonl
      dex-quality.jsonl
      manifest.json
```

Example:

```text
data/dex-pool-datasets/
  base-uniswap-v3-weth-usdc-500-d0b53d92-20240101-20240102/
    run-report.json
    base-uniswap-v3-weth-usdc-500-d0b53d92/
      WETHUSDC/
        1m.jsonl
        5m.jsonl
        15m.jsonl
        1h.jsonl
        4h.jsonl
      dex-quality.jsonl
      manifest.json
```

---

## Manifest

Each pool export includes a `manifest.json`.

The manifest records:

- dataset type
- source mode
- chain
- DEX label
- pool kind
- pool address
- pool selection metadata
- token0/token1 metadata
- base/quote token mapping
- block range
- finality metadata
- actual exported time range
- source event type
- exported timeframes
- replay safety policy
- quality summary
- generation timestamp

The dataset is exported as replay-compatible candles, but DEX-specific metadata is preserved in the manifest and sidecar quality records.

---

## Pool selection audit metadata

Each manifest records how the pool was selected.

For pair + explicit fee:

```json
{
  "poolSelection": {
    "resolvedBy": "factory_getPool",
    "inputPair": "WETH/USDC",
    "inputFee": 500,
    "factoryAddress": "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    "token0": "0x4200000000000000000000000000000000000006",
    "token1": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "resolvedPoolAddress": "0xd0b53d9277642d899df5c87a3966a349a798f224"
  }
}
```

For curated preset:

```json
{
  "poolSelection": {
    "resolvedBy": "liquid_pair_preset",
    "inputPair": "WETH/USDC",
    "presetFee": 500,
    "factoryAddress": "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    "token0": "0x4200000000000000000000000000000000000006",
    "token1": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "resolvedPoolAddress": "0xd0b53d9277642d899df5c87a3966a349a798f224"
  }
}
```

For direct pool address:

```json
{
  "poolSelection": {
    "resolvedBy": "direct_pool",
    "inputPoolAddress": "0xd0b53d9277642d899df5c87a3966a349a798f224",
    "resolvedPoolAddress": "0xd0b53d9277642d899df5c87a3966a349a798f224"
  }
}
```

This is important for auditability. A dataset should explain not only which pool was used, but also how that pool was selected.

---

## Quality sidecar

`dex-quality.jsonl` contains sidecar records for candles with quality flags.

Example:

```json
{
  "symbol": "WETHUSDC",
  "timeframe": "1m",
  "openTime": 1704067200000,
  "qualityFlags": { "noTradeInterval": true, "fillForwarded": true },
  "source": {
    "mode": "ONCHAIN_POOL_EVENTS",
    "fromBlock": "8639000",
    "toBlock": "8639000",
    "poolAddress": "0xd0b53d9277642d899df5c87a3966a349a798f224"
  }
}
```

No-trade intervals are normal for DEX pools.

The fill-forward policy creates replay-safe zero-volume candles:

```text
open  = previous close
high  = previous close
low   = previous close
close = previous close
volumeBase  = 0
volumeQuote = 0
trades      = 0
```

These intervals are reported, but they do not fail dataset quality by themselves.

---

## Build pipeline

The build pipeline is:

```text
chain + pair/pool + date range
  → resolve RPC
  → validate chainId
  → resolve date range to block range
  → apply finality clipping when relevant
  → resolve pool address
  → read pool token metadata
  → read Swap logs via eth_getLogs
  → decode Uniswap v3 Swap logs
  → normalize swaps
  → fetch/cache block timestamps
  → build base timeframe candles
  → fill no-trade intervals
  → aggregate requested timeframes
  → validate replay safety
  → write JSONL + manifest + quality sidecar
```

For pair-based simple mode:

```text
WETH/USDC + fee 500
  → token presets
  → Uniswap v3 factory.getPool(tokenA, tokenB, fee)
  → pool address
  → pool.token0()
  → pool.token1()
  → pool.fee()
  → token.symbol()
  → token.decimals()
```

---

## Long-running builds

For larger ranges, use `--verbose`:

```bash
dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-02-01 \
  --verbose
```

Verbose mode prints progress:

```text
Starting build: base-uniswap-v3-weth-usdc-500-d0b53d92-20240101-20240201
Processing pool base-uniswap-v3-weth-usdc-500-d0b53d92
Reading logs: 268 chunks, blocks 8638927 – 9978126
Reading logs chunk 1/268: 8638927 – 8643926
Logs chunk 1/268 done: 1234 logs
Fetching timestamps: 1000 (cache hits=812, misses=188)
Decoded swaps: 123456
Building 1m candles...
Filled no-trade intervals: 424
Aggregated 5m: 8928 candles
Aggregated 15m: 2976 candles
Aggregated 1h: 744 candles
Aggregated 4h: 186 candles
Writing output...
Wrote 7 objects
Build completed: base-uniswap-v3-weth-usdc-500-d0b53d92-20240101-20240201
```

---

## Persistent block timestamp cache

Block timestamps are cached persistently under:

```text
.data/cache/<chain>/block-timestamps.jsonl
```

Example:

```text
.data/cache/base/block-timestamps.jsonl
```

Each row is JSONL:

```json
{ "blockNumber": "8638927", "hash": "0x...", "timestamp": 1704067200 }
```

This speeds up repeated or overlapping builds.

Example:

```bash
rm -rf .data/cache

time dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --dataset-id smoke-cache-miss \
  --verbose

time dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --dataset-id smoke-cache-hit \
  --verbose
```

The second run should show more timestamp cache hits.

---

## Supported simple-mode chains

Current simple-mode chain presets:

| Chain    | Chain ID | Default RPC env    |
| -------- | -------: | ------------------ |
| Ethereum |      `1` | `ETH_RPC_URL`      |
| Base     |   `8453` | `BASE_RPC_URL`     |
| Arbitrum |  `42161` | `ARBITRUM_RPC_URL` |
| Polygon  |    `137` | `POLYGON_RPC_URL`  |
| BSC      |     `56` | `BSC_RPC_URL`      |

Simple mode currently uses the Uniswap v3-style pool interface. It does not expose a `--dex` flag yet.

---

## Token and pair presets

Current Base token presets include:

| Symbol  | Notes                        |
| ------- | ---------------------------- |
| `WETH`  | Wrapped ETH on Base          |
| `USDC`  | Native USDC on Base          |
| `cbBTC` | Coinbase wrapped BTC on Base |
| `cbETH` | Coinbase wrapped ETH on Base |
| `AERO`  | Aerodrome token on Base      |

Current Base liquid pair presets include:

| Pair         | Default fee |
| ------------ | ----------: |
| `WETH/USDC`  |       `500` |
| `cbBTC/WETH` |      `3000` |
| `WETH/cbETH` |       `500` |
| `AERO/WETH`  |      `3000` |

Presets are convenience defaults. The final pool address is still resolved through the Uniswap v3 factory and recorded in the manifest.

---

## Supported timeframes

Supported output timeframes:

```text
1m
3m
5m
15m
30m
1h
4h
1d
```

Default simple-mode timeframes:

```text
1m, 5m, 15m, 1h, 4h
```

Override:

```bash
dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --timeframes 1m,5m,15m,1h,4h,1d \
  --verbose
```

---

## S3 output

Use an S3 URI:

```json
{
  "out": "s3://my-datasets-bucket/trader-agent/dex-pool/base"
}
```

Or in CLI:

```bash
dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --out s3://my-datasets-bucket/trader-agent/dex-pool/base \
  --verbose
```

AWS credentials are resolved by the AWS SDK.

---

## Public RPC performance

Public RPC endpoints can work, but they are rate-limited and slow for larger backfills.

Measured with:

```env
BASE_RPC_URL=https://mainnet.base.org
```

For Base WETH/USDC 0.05%:

| Range             |       Runtime |
| ----------------- | ------------: |
| 1 day             |    ~6 minutes |
| 3 days            | ~17.5 minutes |
| 7 days            |   ~41 minutes |
| 31 days estimated |      ~3 hours |

The build is mostly RPC-bound, not CPU-bound.

For repeated or large historical backfills, use a paid/archive RPC endpoint.

---

## Production RPC guidance

Public RPC endpoints are useful for smoke tests and small ranges.

For production backfills, use a paid/archive-capable RPC endpoint because the builder relies on:

- historical `eth_getLogs`
- historical `eth_getBlockByNumber`
- repeated block timestamp lookups
- long-running backfills
- retry/backoff under rate limits

Example `.env`:

```env
# Public Base RPC. OK for smoke tests and small builds.
BASE_RPC_URL=https://mainnet.base.org

# Recommended for production backfills:
# BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
# BASE_RPC_URL=https://base-mainnet.infura.io/v3/YOUR_KEY
# BASE_RPC_URL=https://base-mainnet.your-provider.example
```

---

## Finality handling

The builder supports confirmation-lag finality metadata.

For historical ranges, finality usually does not change the requested block range.

For ranges close to latest, the effective `toBlock` may be clipped to a safe block:

```text
safeToBlock = latestBlock - confirmations
effectiveToBlock = min(requestedToBlock, safeToBlock)
```

The manifest records:

```json
{
  "blockRange": {
    "fromBlock": "8638927",
    "toBlock": "8682126",
    "finalizedToBlock": "12345678",
    "requestedToBlock": "8682126",
    "clippedToFinality": false,
    "finalityMode": "confirmation_lag",
    "confirmations": 64
  }
}
```

---

## Troubleshooting

### `SIMPLE_RPC_ENV_MISSING:BASE_RPC_URL`

Create `.env`:

```env
BASE_RPC_URL=https://mainnet.base.org
```

Then run again.

---

### `EVM_RPC_HTTP_ERROR:429`

The RPC provider rate-limited the request.

Use a less restricted RPC endpoint, or retry later. The client has retry/backoff, but public endpoints can still throttle long builds.

---

### `SIMPLE_POOL_NOT_FOUND`

The factory returned the zero address for the selected token pair and fee.

Check:

- chain
- token symbols
- token addresses
- fee tier

Example:

```bash
dex-pool inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

---

### `NO_SWAPS_IN_RANGE`

The selected pool had no swaps in the resolved block range.

Try:

- a wider date range
- a more liquid pair
- a different fee tier
- a later start date

---

### Build is slow

Use `--verbose` to see progress:

```bash
dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-02-01 \
  --verbose
```

If the build is slow but CPU usage is low, the bottleneck is likely RPC/network latency or rate limiting.

Use a paid/archive RPC for larger ranges.

---

## Development commands

```bash
npm run typecheck
npm test
npm run build
```

Run CLI from source:

```bash
npm run cli -- inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

Run compiled CLI:

```bash
npm run dex-pool -- inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

Run linked CLI:

```bash
dex-pool inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

---

## Smoke tests

Basic CLI wiring:

```bash
dex-pool --help
dex-pool build --help
dex-pool inspect --help
dex-pool doctor --help
```

Doctor:

```bash
dex-pool doctor --chain base
```

Inspect pair:

```bash
dex-pool inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

Inspect curated preset:

```bash
dex-pool inspect \
  --chain base \
  --pair WETH/USDC
```

Inspect direct pool:

```bash
dex-pool inspect \
  --chain base \
  --pool 0xd0b53d9277642d899df5c87a3966a349a798f224
```

Build one day:

```bash
dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --dataset-id smoke-weth-usdc \
  --verbose
```

Check output:

```bash
find ./data/dex-pool-datasets/smoke-weth-usdc -type f | sort
```

Check manifest metadata:

```bash
cat ./data/dex-pool-datasets/smoke-weth-usdc/*/manifest.json | jq '.poolSelection, .blockRange'
```

Check timestamp cache:

```bash
ls -lah .data/cache/base/block-timestamps.jsonl
head -n 3 .data/cache/base/block-timestamps.jsonl
```

---

## Commit checklist

Before opening a PR:

```bash
git status --short
npm run typecheck
npm test
npm run build
node dist/cli/index.js --help
node dist/cli/index.js build --help
node dist/cli/index.js discover --help
node dist/cli/index.js inspect --help
node dist/cli/index.js doctor --help

dex-pool doctor --chain base

dex-pool inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500

dex-pool build \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --dataset-id pr-smoke-weth-usdc \
  --verbose

cat ./data/dex-pool-datasets/pr-smoke-weth-usdc/*/manifest.json | jq '.poolSelection, .blockRange'
```

Generated runtime artifacts should not appear in `git status`:

- `.data/`
- `data/`
- `dist/`
- `node_modules/`
- `dex-pool.config.json`
- `.env`

Expected build output:

```text
Dataset build completed

Dataset: pr-smoke-weth-usdc
Profile: simple
Output: local://./data/dex-pool-datasets

Pools:
 ✓ base-uniswap-v3-weth-usdc-500-d0b53d92 (WETHUSDC)
   Timeframes: 1m, 5m, 15m, 1h, 4h, 1d
   Quality: passed
```

---

## CI checks

The CI workflow runs:

```bash
npm ci
npm run typecheck
npm run build
node dist/cli/index.js --help
node dist/cli/index.js build --help
node dist/cli/index.js discover --help
node dist/cli/index.js inspect --help
node dist/cli/index.js doctor --help
npm test
```

---

## Recommended commit message

```bash
git add .

git commit -m "feat: stabilize simple DEX pool CLI for main" \
  -m "Prepare feat/simplifyed-mode for public main by preserving advanced config mode, stabilizing simple build/inspect/doctor/init commands, cleaning runtime artifacts, hardening RPC and timestamp cache behavior, refreshing docs, and adding CI checks."
```
