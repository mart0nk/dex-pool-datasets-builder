import {
  hexToBigInt,
  hexToNumber,
  type EvmLog,
  type HexString,
} from "../evm/evm-json-rpc-client.js";
import type {
  UniswapV3PoolCacheRow,
  UniswapV3PoolCandidate,
} from "./discovery.types.js";

export const UNISWAP_V3_POOL_CREATED_TOPIC =
  "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118" as const;

const WORD_HEX_LENGTH = 64;

export function decodeUniswapV3PoolCreatedLog(
  log: EvmLog,
): UniswapV3PoolCacheRow {
  try {
    if (log.topics[0]?.toLowerCase() !== UNISWAP_V3_POOL_CREATED_TOPIC) {
      throw new Error("topic");
    }

    if (log.topics.length !== 4) {
      throw new Error("topic_count");
    }

    return {
      blockNumber: hexToBigInt(log.blockNumber).toString(),
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: hexToNumber(log.logIndex).toString(),
      token0: decodeTopicAddress(log.topics[1]!, "token0"),
      token1: decodeTopicAddress(log.topics[2]!, "token1"),
      fee: Number(hexToBigInt(log.topics[3]!)),
      tickSpacing: Number(decodeSignedWord(log.data, 0)),
      pool: decodeDataAddress(log.data, 1, "pool"),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DISCOVERY_POOL_CREATED_LOG_INVALID:${message}`);
  }
}

export function poolCreatedRowToCandidate(
  row: UniswapV3PoolCacheRow,
): UniswapV3PoolCandidate {
  return {
    token0: row.token0,
    token1: row.token1,
    feeTier: row.fee,
    poolAddress: row.pool,
  };
}

function decodeTopicAddress(topic: HexString, field: string): HexString {
  return decodeAddressWord(strip0x(topic), field);
}

function decodeDataAddress(
  data: HexString,
  wordIndex: number,
  field: string,
): HexString {
  return decodeAddressWord(readWord(data, wordIndex), field);
}

function decodeAddressWord(word: string, field: string): HexString {
  if (word.length !== WORD_HEX_LENGTH) {
    throw new Error(`address_word:${field}:${word.length}`);
  }

  return `0x${word.slice(-40)}` as HexString;
}

function decodeSignedWord(data: HexString, wordIndex: number): bigint {
  const unsigned = BigInt(`0x${readWord(data, wordIndex)}`);
  const two255 = 1n << 255n;
  const two256 = 1n << 256n;
  return unsigned >= two255 ? unsigned - two256 : unsigned;
}

function readWord(data: HexString, wordIndex: number): string {
  const hex = strip0x(data);
  const start = wordIndex * WORD_HEX_LENGTH;
  const word = hex.slice(start, start + WORD_HEX_LENGTH);

  if (word.length !== WORD_HEX_LENGTH) {
    throw new Error(`abi_word:${wordIndex}`);
  }

  return word;
}

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

