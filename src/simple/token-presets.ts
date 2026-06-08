import type {
  DexChain,
  DexPoolToken,
} from "../types/dex-pool-dataset.types.js";

export type SimpleTokenPreset = DexPoolToken;

export const TOKEN_PRESETS: Partial<
  Record<DexChain, Record<string, SimpleTokenPreset>>
> = {
  base: {
    WETH: {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006",
      decimals: 18,
    },
    USDC: {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    },
  },
};

export function resolveTokenPreset(input: {
  chain: DexChain;
  selector: string;
}): SimpleTokenPreset {
  const chainTokens = TOKEN_PRESETS[input.chain];

  if (chainTokens === undefined) {
    throw new Error(`SIMPLE_TOKEN_PRESETS_UNSUPPORTED_CHAIN:${input.chain}`);
  }

  const normalized = input.selector.toUpperCase();
  const token = chainTokens[normalized];

  if (token === undefined) {
    throw new Error(
      `SIMPLE_TOKEN_PRESET_NOT_FOUND:${input.chain}:${input.selector}`,
    );
  }

  return token;
}
