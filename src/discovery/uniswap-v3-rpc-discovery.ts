import type { HexString } from "../evm/evm-json-rpc-client.js";
import {
  createEvmJsonRpcClient,
  hexToBigInt,
  hexToNumber,
  type EvmJsonRpcClient,
  type EvmLog,
} from "../evm/evm-json-rpc-client.js";
import { planBlockRanges } from "../evm/block-range-planner.js";
import { UNISWAP_V3_SWAP_TOPIC } from "../evm/uniswap-v3-swap-decoder.js";
import { getUniswapV3FactoryPreset } from "../simple/uniswap-v3-factory-presets.js";
import { readUniswapV3PoolConfig } from "../simple/evm-contract-reader.js";
import { resolveTokenPreset } from "../simple/token-presets.js";
import type {
  DexChain,
  DexPoolConfig,
  DexPoolToken,
} from "../types/dex-pool-dataset.types.js";
import type {
  DiscoveredDexPool,
  DiscoveryMetric,
  UniswapV3RpcDiscoveryInput,
} from "./discovery.types.js";

export const UNISWAP_V3_POOL_CREATED_TOPIC =
  "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118" as const;

const DEFAULT_FACTORY_SCAN_CHUNK_SIZE = 10_000n;
const DEFAULT_SWAP_SCAN_CHUNK_SIZE = 5_000n;
const DEFAULT_POOL_ADDRESS_BATCH_SIZE = 100;
const WORD_HEX_LENGTH = 64;
const TWO_256 = 1n << 256n;
const TWO_255 = 1n << 255n;

type PoolCandidate = {
  token0: HexString;
  token1: HexString;
  feeTier: number;
  poolAddress: HexString;
};

type PoolScore = {
  candidate: PoolCandidate;
  swapCount: number;
  quoteVolumeRaw: bigint;
};

type LookbackBlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export async function discoverTopUniswapV3Pools(
  input: UniswapV3RpcDiscoveryInput,
): Promise<DiscoveredDexPool[]> {
  const metric = normalizeDiscoveryMetric(input.top.by);
  const limit = normalizeLimit(input.top.limit);
  const lookbackDays = normalizeLookbackDays(input.top.lookbackDays);
  const factoryPreset = getUniswapV3FactoryPreset(input.chain);
  const client = createEvmJsonRpcClient({ rpcUrl: input.rpcUrl });
  const quoteToken =
    metric === "quoteVolume"
      ? resolveQuoteToken({ chain: input.chain, quote: input.quote })
      : undefined;
  const latestBlock = await client.getLatestBlockNumber();
  const lookbackRange = await resolveLookbackBlockRange({
    client,
    latestBlock,
    lookbackDays,
  });
  const candidates = await readPoolCreatedCandidates({
    client,
    factoryAddress: factoryPreset.factoryAddress,
    fromBlock: factoryPreset.deploymentBlock,
    toBlock: latestBlock,
  });
  const scored = await scorePoolCandidates({
    client,
    candidates:
      quoteToken === undefined
        ? candidates
        : candidates.filter((candidate) =>
            candidateContainsQuoteToken(candidate, quoteToken),
          ),
    metric,
    quoteToken,
    fromBlock: lookbackRange.fromBlock,
    toBlock: lookbackRange.toBlock,
  });
  const topScores = scored
    .filter((score) => score.swapCount > 0)
    .sort((a, b) => compareScores(a, b, metric))
    .slice(0, limit);
  const snapshotAt = new Date().toISOString();
  const discovered: DiscoveredDexPool[] = [];

  for (let index = 0; index < topScores.length; index += 1) {
    const score = topScores[index]!;
    const pool = await readUniswapV3PoolConfig({
      client,
      chain: input.chain,
      poolAddress: score.candidate.poolAddress,
      startBlock: factoryPreset.deploymentBlock.toString(),
      quote: quoteToken?.symbol,
    });
    const rank = index + 1;
    const metricValue =
      metric === "swapCount"
        ? String(score.swapCount)
        : formatUnits(score.quoteVolumeRaw, quoteToken!.decimals);

    discovered.push({
      rank,
      pool,
      metric,
      metricValue,
      discovery: {
        source: "uniswap_v3_rpc",
        snapshotAt,
        rank,
        metric,
        metricValue,
        poolAddress: score.candidate.poolAddress,
        feeTier: score.candidate.feeTier,
        pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
        swapCount: score.swapCount,
        quoteSymbol: quoteToken?.symbol,
        quoteVolume:
          quoteToken === undefined
            ? undefined
            : formatUnits(score.quoteVolumeRaw, quoteToken.decimals),
        factoryAddress: factoryPreset.factoryAddress,
        factoryDeploymentBlock: factoryPreset.deploymentBlock.toString(),
        fromBlock: lookbackRange.fromBlock.toString(),
        toBlock: lookbackRange.toBlock.toString(),
      },
    });
  }

  return discovered;
}

export function normalizeDiscoveryMetric(metric: string): DiscoveryMetric {
  if (metric === "swapCount" || metric === "quoteVolume") {
    return metric;
  }

  throw new Error(`DISCOVERY_METRIC_INVALID:${metric}`);
}

export function decodeUniswapV3PoolCreatedLog(log: EvmLog): PoolCandidate {
  if (log.topics[0]?.toLowerCase() !== UNISWAP_V3_POOL_CREATED_TOPIC) {
    throw new Error(`DISCOVERY_POOL_CREATED_TOPIC_INVALID:${log.transactionHash}`);
  }

  if (log.topics.length !== 4) {
    throw new Error(
      `DISCOVERY_POOL_CREATED_TOPIC_COUNT_INVALID:${log.transactionHash}:${log.topics.length}`,
    );
  }

  return {
    token0: decodeTopicAddress(log.topics[1]!, "token0"),
    token1: decodeTopicAddress(log.topics[2]!, "token1"),
    feeTier: Number(hexToBigInt(log.topics[3]!)),
    poolAddress: decodeDataAddress(log.data, 1, "pool"),
  };
}

async function readPoolCreatedCandidates(input: {
  client: EvmJsonRpcClient;
  factoryAddress: HexString;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<PoolCandidate[]> {
  const ranges = planBlockRanges(
    input.fromBlock,
    input.toBlock,
    DEFAULT_FACTORY_SCAN_CHUNK_SIZE,
  );
  const candidates: PoolCandidate[] = [];

  for (const range of ranges) {
    const logs = await input.client.getLogs({
      address: input.factoryAddress,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      topics: [UNISWAP_V3_POOL_CREATED_TOPIC],
    });

    for (const log of logs) {
      candidates.push(decodeUniswapV3PoolCreatedLog(log));
    }
  }

  return candidates;
}

async function scorePoolCandidates(input: {
  client: EvmJsonRpcClient;
  candidates: PoolCandidate[];
  metric: DiscoveryMetric;
  quoteToken: DexPoolToken | undefined;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<PoolScore[]> {
  const scoreByPool = new Map<string, PoolScore>();
  const candidateByAddress = new Map(
    input.candidates.map((candidate) => [
      candidate.poolAddress.toLowerCase(),
      candidate,
    ]),
  );
  const ranges = planBlockRanges(
    input.fromBlock,
    input.toBlock,
    DEFAULT_SWAP_SCAN_CHUNK_SIZE,
  );
  const addressBatches = chunk(
    input.candidates.map((candidate) => candidate.poolAddress),
    DEFAULT_POOL_ADDRESS_BATCH_SIZE,
  );

  for (const candidate of input.candidates) {
    scoreByPool.set(candidate.poolAddress.toLowerCase(), {
      candidate,
      swapCount: 0,
      quoteVolumeRaw: 0n,
    });
  }

  for (const addresses of addressBatches) {
    for (const range of ranges) {
      const logs = await input.client.getLogs({
        address: addresses,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        topics: [UNISWAP_V3_SWAP_TOPIC],
      });

      for (const log of logs) {
        const key = log.address.toLowerCase();
        const candidate = candidateByAddress.get(key);
        const score = scoreByPool.get(key);

        if (candidate === undefined || score === undefined) {
          continue;
        }

        score.swapCount += 1;

        if (input.metric === "quoteVolume") {
          const amounts = decodeSwapAmounts(log.data);
          const quoteAmountRaw =
            input.quoteToken!.address.toLowerCase() ===
            candidate.token0.toLowerCase()
              ? amounts.amount0
              : amounts.amount1;
          score.quoteVolumeRaw += abs(quoteAmountRaw);
        }
      }
    }
  }

  return [...scoreByPool.values()];
}

async function resolveLookbackBlockRange(input: {
  client: EvmJsonRpcClient;
  latestBlock: bigint;
  lookbackDays: number;
}): Promise<LookbackBlockRange> {
  const latest = await input.client.getBlockByNumber(input.latestBlock);
  const latestTimestamp = hexToNumber(latest.timestamp);
  const targetTimestamp = latestTimestamp - input.lookbackDays * 24 * 60 * 60;
  const fromBlock = await findFirstBlockAtOrAfter({
    latestBlock: input.latestBlock,
    targetTimestamp,
    getTimestamp: async (blockNumber) => {
      const block = await input.client.getBlockByNumber(blockNumber);
      return hexToNumber(block.timestamp);
    },
  });

  return {
    fromBlock,
    toBlock: input.latestBlock,
  };
}

async function findFirstBlockAtOrAfter(input: {
  latestBlock: bigint;
  targetTimestamp: number;
  getTimestamp: (blockNumber: bigint) => Promise<number>;
}): Promise<bigint> {
  let low = 0n;
  let high = input.latestBlock;

  while (low < high) {
    const mid = (low + high) / 2n;
    const timestamp = await input.getTimestamp(mid);

    if (timestamp >= input.targetTimestamp) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }

  return low;
}

function resolveQuoteToken(input: {
  chain: DexChain;
  quote: string | undefined;
}): DexPoolToken {
  if (input.quote === undefined || input.quote.length === 0) {
    throw new Error(
      "DISCOVERY_QUOTE_REQUIRED: --quote is required when --by quoteVolume",
    );
  }

  return resolveTokenPreset({
    chain: input.chain,
    selector: input.quote,
  });
}

function candidateContainsQuoteToken(
  candidate: PoolCandidate,
  quoteToken: DexPoolToken,
): boolean {
  const quoteAddress = quoteToken.address.toLowerCase();
  return (
    candidate.token0.toLowerCase() === quoteAddress ||
    candidate.token1.toLowerCase() === quoteAddress
  );
}

function compareScores(
  left: PoolScore,
  right: PoolScore,
  metric: DiscoveryMetric,
): number {
  if (metric === "quoteVolume" && left.quoteVolumeRaw !== right.quoteVolumeRaw) {
    return left.quoteVolumeRaw > right.quoteVolumeRaw ? -1 : 1;
  }

  if (left.swapCount !== right.swapCount) {
    return right.swapCount - left.swapCount;
  }

  return left.candidate.poolAddress.localeCompare(right.candidate.poolAddress);
}

function decodeSwapAmounts(data: HexString): { amount0: bigint; amount1: bigint } {
  return {
    amount0: decodeSignedWord(data, 0),
    amount1: decodeSignedWord(data, 1),
  };
}

function decodeSignedWord(data: HexString, wordIndex: number): bigint {
  const unsigned = BigInt(`0x${readWord(data, wordIndex)}`);
  return unsigned >= TWO_255 ? unsigned - TWO_256 : unsigned;
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
    throw new Error(`DISCOVERY_ADDRESS_WORD_INVALID:${field}:${word.length}`);
  }

  return `0x${word.slice(-40)}` as HexString;
}

function readWord(data: HexString, wordIndex: number): string {
  const hex = strip0x(data);
  const start = wordIndex * WORD_HEX_LENGTH;
  const word = hex.slice(start, start + WORD_HEX_LENGTH);

  if (word.length !== WORD_HEX_LENGTH) {
    throw new Error(`DISCOVERY_ABI_WORD_MISSING:${wordIndex}`);
  }

  return word;
}

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`DISCOVERY_TOP_INVALID:${limit}`);
  }

  return limit;
}

function normalizeLookbackDays(days: number): number {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`DISCOVERY_LOOKBACK_DAYS_INVALID:${days}`);
  }

  return days;
}

function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const fractionText = fraction.toString().padStart(decimals, "0");
  const trimmed = fractionText.replace(/0+$/g, "");

  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
