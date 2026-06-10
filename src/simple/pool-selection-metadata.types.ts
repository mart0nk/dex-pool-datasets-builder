import type { HexString } from "../evm/evm-json-rpc-client.js";

export type PoolSelectionResolvedBy =
  | "direct_pool"
  | "factory_getPool"
  | "liquid_pair_preset"
  | "discovery_top_pools";

export type DexPoolSelectionMetadata = {
  resolvedBy: PoolSelectionResolvedBy;

  inputPoolAddress?: HexString;
  inputPair?: string;
  inputFee?: number;
  presetFee?: number;

  factoryAddress?: HexString;
  token0?: HexString;
  token1?: HexString;

  discoverySource?: "uniswap_v3_subgraph";
  discoveryRank?: number;
  discoveryMetric?: "totalValueLockedUSD" | "volumeUSD" | "liquidity";
  discoveryMetricValue?: string;
  discoverySnapshotAt?: string;

  resolvedPoolAddress: HexString;
};
