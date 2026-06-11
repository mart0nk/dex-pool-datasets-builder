import type { HexString } from "../evm/evm-json-rpc-client.js";

const WORD_HEX_LENGTH = 64;
const TWO_256 = 1n << 256n;
const TWO_255 = 1n << 255n;

export function decodeUniswapV3SwapAmounts(data: HexString): {
  amount0: bigint;
  amount1: bigint;
} {
  try {
    return {
      amount0: decodeSignedWord(data, 0),
      amount1: decodeSignedWord(data, 1),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DISCOVERY_SWAP_LOG_INVALID:${message}`);
  }
}

function decodeSignedWord(data: HexString, wordIndex: number): bigint {
  const unsigned = BigInt(`0x${readWord(data, wordIndex)}`);
  return unsigned >= TWO_255 ? unsigned - TWO_256 : unsigned;
}

function readWord(data: HexString, wordIndex: number): string {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const start = wordIndex * WORD_HEX_LENGTH;
  const word = hex.slice(start, start + WORD_HEX_LENGTH);

  if (word.length !== WORD_HEX_LENGTH) {
    throw new Error(`abi_word:${wordIndex}`);
  }

  return word;
}
