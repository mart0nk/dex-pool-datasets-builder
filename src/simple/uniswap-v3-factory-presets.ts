import type { DexChain } from "../types/dex-pool-dataset.types.js";
import type { HexString } from "../evm/evm-json-rpc-client.js";

export const UNISWAP_V3_FACTORY_PRESETS: Partial<Record<DexChain, HexString>> =
  {
    ethereum: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    base: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    arbitrum: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    polygon: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  };

export function getUniswapV3FactoryAddress(chain: DexChain): HexString {
  const factoryAddress = UNISWAP_V3_FACTORY_PRESETS[chain];

  if (factoryAddress === undefined) {
    throw new Error(`SIMPLE_FACTORY_UNSUPPORTED_CHAIN:${chain}`);
  }

  return factoryAddress;
}
