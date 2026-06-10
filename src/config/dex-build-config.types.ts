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
  registryPath?: string;

  /**
   * Runtime registry entries used by the unified simple CLI.
   */
  registryPools: DexPoolConfig[];

  /**
   * Audit metadata for how each pool was selected.
   *
   * Keyed by pool.id.
   */
  poolSelectionByPoolId?: Record<
    string,
    import("../simple/pool-selection-metadata.types.js").DexPoolSelectionMetadata
  >;

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

    /**
     * Original requested toBlock before finality clipping.
     */
    requestedToBlock?: bigint;

    /**
     * Finalized/safe effective toBlock.
     */
    finalizedToBlock?: bigint;

    /**
     * Whether toBlock was clipped by finality logic.
     */
    clippedToFinality?: boolean;

    baseTimeframe: Timeframe;
    timeframes: Timeframe[];
    chunkSize: bigint;
    failFast: boolean;
  };

  output: DexBuildOutputConfig;
  profile?: string;

  /**
   * Persistent local cache directory.
   *
   * Example:
   * .data/cache
   */
  cacheDir?: string;
};
