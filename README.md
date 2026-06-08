# @dex-pool-datasets

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

## Current scope

* simple CLI mode for Uniswap v3-style pools
* pair-based pool resolution via Uniswap v3 factory `getPool`
* direct pool-address builds
* token preset resolution for common liquid pairs
* pool registry validation for advanced mode
* EVM block range planning
* date range to block range resolution
* EVM JSON-RPC `eth_getLogs` reads
* block timestamp caching during a build via `eth_getBlockByNumber`
* Uniswap v3 `Swap` log decoding
* normalized swap to DEX pool candle conversion
* no-trade fill-forward replay policy
* timeframe aggregation
* replay-compatible JSONL export adapter
* DEX sidecar quality records
* local and S3 output backends

## Out of scope for this package slice

* full multi-DEX adapter support
* full independent pool identity verification beyond Uniswap v3-style metadata/factory resolution
* checkpointed/resumable backfills
* persistent cross-run block timestamp cache
* HTTP service orchestration
* hosted API service
* automatic liquidity ranking across all pools
* production scheduling/orchestration

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

## Quickstart

Build a Base WETH/USDC Uniswap v3-style dataset by pair:

```bash
node dist/cli/index.js build \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

For curated liquid pairs with a known default fee, the fee can be omitted:

```bash
node dist/cli/index.js build \
  --chain base \
  --pair WETH/USDC \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

Build by direct pool contract:

```bash
node dist/cli/index.js build \
  --chain base \
  --pool 0xd0b53d9277642d899df5c87a3966a349a798f224 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

Build by token addresses and fee:

```bash
node dist/cli/index.js build \
  --chain base \
  --token0 0x4200000000000000000000000000000000000006 \
  --token1 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

---

## Inspect a pool or pair

Inspect by pair:

```bash
node dist/cli/index.js inspect \
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

Inspect by direct pool address:

```bash
node dist/cli/index.js inspect \
  --chain base \
  --pool 0xd0b53d9277642d899df5c87a3966a349a798f224
```

JSON output:

```bash
node dist/cli/index.js inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --json
```

---

## Doctor checks

Check RPC and chain connectivity:

```bash
node dist/cli/index.js doctor --chain base
```

Check RPC, chain, and pool metadata:

```bash
node dist/cli/index.js doctor \
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
node dist/cli/index.js init --chain base --force
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
node dist/cli/index.js build \
  --config dex-pool.config.json \
  --verbose
```

`dex-pool.config.json` is ignored by git. Use `config/dex-pool.config.example.json` as the committed example.

---

## Output format

The package exports replay-compatible JSONL files.

Each candle row is one JSON object per line:

```json
{"symbol":"WETHUSDC","timeframe":"1m","openTime":1704067200000,"closeTime":1704067259999,"open":2280.12,"high":2281.04,"low":2279.88,"close":2280.55,"volume":12.345,"turnover":28152.44,"quoteVolume":28152.44,"trades":37,"closed":true,"source":"DEX_POOL"}
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

* dataset type
* source mode
* chain
* DEX label
* pool kind
* pool address
* token0/token1 metadata
* base/quote token mapping
* block range
* actual exported time range
* source event type
* exported timeframes
* replay safety policy
* quality summary
* generation timestamp

The dataset is exported as replay-compatible candles, but DEX-specific metadata is preserved in the manifest and sidecar quality records.

---

## Quality sidecar

`dex-quality.jsonl` contains sidecar records for candles with quality flags.

Example:

```json
{"symbol":"WETHUSDC","timeframe":"1m","openTime":1704067200000,"qualityFlags":{"noTradeInterval":true,"fillForwarded":true},"source":{"mode":"ONCHAIN_POOL_EVENTS","fromBlock":"8639000","toBlock":"8639000","poolAddress":"0xd0b53d9277642d899df5c87a3966a349a798f224"}}
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
  → resolve pool address
  → read pool token metadata
  → read Swap logs via eth_getLogs
  → decode Uniswap v3 Swap logs
  → normalize swaps
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
node dist/cli/index.js build \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --timeframes 1m,5m,15m,1h,4h,1d \
  --verbose
```

---

## Advanced config mode

The original advanced workflow is still supported.

Validate advanced config:

```bash
node dist/cli/index.js validate \
  --config config/dex-dataset.config.example.json \
  --profile local
```

Plan advanced config:

```bash
node dist/cli/index.js plan \
  --config config/dex-dataset.config.example.json \
  --profile local \
  --json
```

Build advanced config:

```bash
node dist/cli/index.js build \
  --config config/dex-dataset.config.example.json \
  --profile local \
  --verbose
```

Use advanced mode for:

* explicit pool registry files
* multi-pool datasets
* pinned block ranges
* S3 output
* profile-based production builds

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
node dist/cli/index.js build \
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

## Troubleshooting

### `SIMPLE_RPC_ENV_MISSING:BASE_RPC_URL`

Create `.env`:

```env
BASE_RPC_URL=https://mainnet.base.org
```

Then run again.

### `EVM_RPC_HTTP_ERROR:429`

The RPC provider rate-limited the request.

Use a less restricted RPC endpoint, or retry later. The client has retry/backoff, but public endpoints can still throttle long builds.

### `SIMPLE_POOL_NOT_FOUND`

The factory returned the zero address for the selected token pair and fee.

Check:

* chain
* token symbols
* token addresses
* fee tier

Example:

```bash
node dist/cli/index.js inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

### `NO_SWAPS_IN_RANGE`

The selected pool had no swaps in the resolved block range.

Try:

* a wider date range
* a more liquid pair
* a different fee tier
* a later start date

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
node dist/cli/index.js inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500
```

---

## Commit checklist

Before opening a PR:

```bash
npm run typecheck
npm test
npm run build

node dist/cli/index.js doctor --chain base

node dist/cli/index.js inspect \
  --chain base \
  --pair WETH/USDC \
  --fee 500

node dist/cli/index.js build \
  --chain base \
  --pair WETH/USDC \
  --fee 500 \
  --from 2024-01-01 \
  --to 2024-01-02 \
  --verbose
```

Expected build output:

```text
Dataset build completed

Dataset: base-uniswap-v3-weth-usdc-500-d0b53d92-20240101-20240102
Profile: simple
Output: local://./data/dex-pool-datasets

Pools:
 ✓ base-uniswap-v3-weth-usdc-500-d0b53d92 (WETHUSDC)
   Timeframes: 1m, 5m, 15m, 1h, 4h
   Quality: passed
```
