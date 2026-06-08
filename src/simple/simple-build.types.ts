import type { Timeframe } from "../contracts/timeframe.js";

export type SimpleDexBuildInput = {
  chain: string;

  /**
   * Direct pool contract address.
   *
   * Highest-priority selector. If provided, pair/token factory resolution is skipped.
   */
  pool?: `0x${string}` | string;

  /**
   * User-friendly pair selector.
   *
   * Example:
   * WETH/USDC
   */
  pair?: string;

  /**
   * Uniswap v3 fee tier.
   *
   * Examples:
   * 100, 500, 3000, 10000
   */
  fee?: number | string;

  /**
   * Token address selectors for factory.getPool(token0, token1, fee).
   */
  token0?: string;
  token1?: string;

  /**
   * Start date/time.
   *
   * Accepted examples:
   * - 2024-01-01
   * - 2024-01-01T00:00:00Z
   */
  from: string;

  /**
   * Exclusive end date/time.
   *
   * Either `to` or `days` is required.
   */
  to?: string;

  /**
   * Duration in days when `to` is omitted.
   */
  days?: number;

  /**
   * Direct RPC URL.
   * If omitted, `rpcUrlEnv` or the chain preset env var is used.
   */
  rpcUrl?: string;

  /**
   * RPC environment variable name.
   *
   * Example:
   * BASE_RPC_URL
   */
  rpcUrlEnv?: string;

  /**
   * Output path or URI.
   *
   * Examples:
   * - ./data/dex-pool-datasets
   * - local://./data/dex-pool-datasets
   * - s3://bucket/prefix
   */
  out?: string;

  /**
   * Optional base token selector.
   * Can be token symbol or address.
   */
  base?: string;

  /**
   * Optional quote token selector.
   * Can be token symbol or address.
   */
  quote?: string;

  datasetId?: string;

  baseTimeframe?: Timeframe | string;
  timeframes?: Array<Timeframe | string>;

  chunkSize?: bigint | number | string;
  failFast?: boolean;
};
