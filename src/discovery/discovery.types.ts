import type { HexString } from "../evm/evm-json-rpc-client.js";
import type {
  DexChain,
  DexPoolConfig,
} from "../types/dex-pool-dataset.types.js";

export type DiscoveryMetric = "totalValueLockedUSD" | "volumeUSD" | "liquidity";

export type UniswapV3SubgraphDiscoveryInput = {
  source: "uniswap_v3_subgraph";
  chain: DexChain;
  subgraphUrl: string;
  top: {
    by: DiscoveryMetric;
    limit: number;
    minLiquidityUsd?: number;
    minVolumeUsd?: number;
  };
  includeFees?: number[];
  includePairs?: string[];
  excludePairs?: string[];
};

export type DiscoveredDexPool = {
  rank: number;
  pool: DexPoolConfig;
  metric: DiscoveryMetric;
  metricValue: string;
  discovery: {
    source: "uniswap_v3_subgraph";
    snapshotAt: string;
    rank: number;
    metric: DiscoveryMetric;
    metricValue: string;
    poolAddress: HexString;
    feeTier: number;
    pair: string;
  };
};
