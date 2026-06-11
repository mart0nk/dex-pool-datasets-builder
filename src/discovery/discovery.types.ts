import type { HexString } from "../evm/evm-json-rpc-client.js";
import type {
  DexChain,
  DexPoolConfig,
} from "../types/dex-pool-dataset.types.js";

export type DiscoveryMetric = "swapCount" | "quoteVolume";

export type UniswapV3RpcDiscoveryInput = {
  source: "uniswap_v3_rpc";
  chain: DexChain;
  rpcUrl: string;
  top: {
    by: DiscoveryMetric;
    limit: number;
    lookbackDays: number;
  };
  quote?: string;
};

export type DiscoveredDexPool = {
  rank: number;
  pool: DexPoolConfig;
  metric: DiscoveryMetric;
  metricValue: string;
  discovery: {
    source: "uniswap_v3_rpc";
    snapshotAt: string;
    rank: number;
    metric: DiscoveryMetric;
    metricValue: string;
    poolAddress: HexString;
    feeTier: number;
    pair: string;
    swapCount: number;
    quoteSymbol?: string;
    quoteVolume?: string;
    factoryAddress: HexString;
    factoryDeploymentBlock: string;
    fromBlock: string;
    toBlock: string;
  };
};
