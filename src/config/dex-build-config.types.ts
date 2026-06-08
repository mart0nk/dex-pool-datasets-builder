import type { Timeframe } from "../contracts/timeframe.js";
import type { DexPoolConfig } from "../types/dex-pool-dataset.types.js";

export type DexBuildOutputConfig = {
  type: "local" | "s3";
  uri: string;
};

export type DexBuildFinalityConfig =
  | { mode: "confirmation_lag"; confirmations: number }
  | { mode: "latest" };

export type DexBuildNetworkConfig = {
  chain: string;
  chainId: number;
  rpcUrlEnv: string;
  finality?: DexBuildFinalityConfig;
};

export type DexBuildSectionConfig = {
  pools: string[];
  fromBlock: string;
  toBlock: string;
  baseTimeframe: Timeframe;
  timeframes: Timeframe[];
  chunkSize?: string;
  failFast?: boolean;
};

export type DexBuildRegistryConfig = {
  path: string;
};

export type DexBuildProfileConfig = {
  output?: Partial<DexBuildOutputConfig>;
  build?: Partial<DexBuildSectionConfig>;
};

export type DexBuildConfig = {
  datasetId: string;
  registry: DexBuildRegistryConfig;
  network: DexBuildNetworkConfig;
  build: DexBuildSectionConfig;
  output: DexBuildOutputConfig;
  profiles?: Record<string, DexBuildProfileConfig>;
};

export type ResolvedDexBuildConfig = {
  datasetId: string;
  registryPath: string;

  /**
   * Runtime registry entries used by simple mode.
   *
   * Advanced mode reads registry JSON from registryPath.
   * Simple mode injects generated pool configs here, so no registry file is needed.
   */
  registryPools?: DexPoolConfig[];

  network: {
    chain: string;
    chainId: number;
    rpcUrl: string;
    finality?: DexBuildFinalityConfig;
  };

  build: {
    pools: string[];
    fromBlock: bigint;
    toBlock: bigint;
    baseTimeframe: Timeframe;
    timeframes: Timeframe[];
    chunkSize: bigint;
    failFast: boolean;
  };

  output: DexBuildOutputConfig;
  profile?: string;
};
