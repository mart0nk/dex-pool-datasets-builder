import type { HexString } from "../evm/evm-json-rpc-client.js";

export type PoolSelectionResolvedBy =
  | "direct_pool"
  | "factory_getPool"
  | "liquid_pair_preset";

export type DexPoolSelectionMetadata = {
  resolvedBy: PoolSelectionResolvedBy;

  inputPoolAddress?: HexString;
  inputPair?: string;
  inputFee?: number;
  presetFee?: number;

  factoryAddress?: HexString;
  token0?: HexString;
  token1?: HexString;

  resolvedPoolAddress: HexString;
};
