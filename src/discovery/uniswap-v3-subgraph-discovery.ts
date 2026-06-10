import type { HexString } from "../evm/evm-json-rpc-client.js";
import { assertEvmAddress } from "../simple/evm-address.js";
import { normalizePair } from "../simple/liquid-pair-presets.js";
import type {
  DexChain,
  DexPoolConfig,
} from "../types/dex-pool-dataset.types.js";
import type {
  DiscoveredDexPool,
  DiscoveryMetric,
  UniswapV3SubgraphDiscoveryInput,
} from "./discovery.types.js";

const DISCOVERY_METRICS = new Set<DiscoveryMetric>([
  "totalValueLockedUSD",
  "volumeUSD",
  "liquidity",
]);

type GraphQlPoolRow = {
  id: unknown;
  feeTier: unknown;
  liquidity: unknown;
  totalValueLockedUSD: unknown;
  volumeUSD: unknown;
  txCount: unknown;
  token0: unknown;
  token1: unknown;
};

type GraphQlTokenRow = {
  id: unknown;
  symbol: unknown;
  decimals: unknown;
};

export async function discoverTopUniswapV3Pools(
  input: UniswapV3SubgraphDiscoveryInput,
): Promise<DiscoveredDexPool[]> {
  const metric = normalizeDiscoveryMetric(input.top.by);
  const limit = normalizeLimit(input.top.limit);
  const query = buildTopPoolsQuery(metric);
  const response = await fetch(input.subgraphUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      query,
      variables: buildGraphQlVariables(input, limit),
    }),
  });

  const text = await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(
      `DISCOVERY_SUBGRAPH_HTTP_ERROR:${response.status}:${text.slice(0, 200)}`,
    );
  }

  const payload = parseGraphQlPayload(text);

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const firstError = payload.errors[0] as unknown;
    throw new Error(`DISCOVERY_SUBGRAPH_GRAPHQL_ERROR:${formatGraphQlError(firstError)}`);
  }

  const rows = readPoolRows(payload);
  const snapshotAt = new Date().toISOString();
  const includeFees = new Set(input.includeFees);
  const includePairs = normalizePairFilter(input.includePairs);
  const excludePairs = normalizePairFilter(input.excludePairs);
  const discovered: DiscoveredDexPool[] = [];

  for (const row of rows) {
    const mapped = mapPoolRow({
      row,
      chain: input.chain,
      metric,
      snapshotAt,
    });

    if (includeFees.size > 0 && !includeFees.has(mapped.pool.feeTier ?? -1)) {
      continue;
    }

    if (includePairs.size > 0 && !pairFilterMatches(includePairs, mapped.discovery.pair)) {
      continue;
    }

    if (excludePairs.size > 0 && pairFilterMatches(excludePairs, mapped.discovery.pair)) {
      continue;
    }

    discovered.push({
      ...mapped,
      rank: discovered.length + 1,
      discovery: {
        ...mapped.discovery,
        rank: discovered.length + 1,
      },
    });
  }

  return discovered;
}

export function normalizeDiscoveryMetric(metric: string): DiscoveryMetric {
  if (DISCOVERY_METRICS.has(metric as DiscoveryMetric)) {
    return metric as DiscoveryMetric;
  }

  throw new Error(`DISCOVERY_METRIC_INVALID:${metric}`);
}

function buildTopPoolsQuery(metric: DiscoveryMetric): string {
  return `
    query TopPools($first: Int!, $minTvl: BigDecimal, $minVolume: BigDecimal) {
      pools(
        first: $first
        orderBy: ${metric}
        orderDirection: desc
        where: {
          totalValueLockedUSD_gt: $minTvl
          volumeUSD_gt: $minVolume
        }
      ) {
        id
        feeTier
        liquidity
        totalValueLockedUSD
        volumeUSD
        txCount
        token0 {
          id
          symbol
          decimals
        }
        token1 {
          id
          symbol
          decimals
        }
      }
    }
  `;
}

function buildGraphQlVariables(
  input: UniswapV3SubgraphDiscoveryInput,
  limit: number,
): Record<string, unknown> {
  return {
    first: limit,
    minTvl:
      input.top.minLiquidityUsd !== undefined
        ? String(input.top.minLiquidityUsd)
        : "0",
    minVolume:
      input.top.minVolumeUsd !== undefined
        ? String(input.top.minVolumeUsd)
        : "0",
  };
}

function parseGraphQlPayload(text: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(text) as unknown;

    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("not_object");
    }

    return payload as Record<string, unknown>;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DISCOVERY_SUBGRAPH_INVALID_JSON:${message}`);
  }
}

function readPoolRows(payload: Record<string, unknown>): GraphQlPoolRow[] {
  const data = payload.data;

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("DISCOVERY_SUBGRAPH_MALFORMED_RESPONSE:data");
  }

  const pools = (data as Record<string, unknown>).pools;

  if (!Array.isArray(pools)) {
    throw new Error("DISCOVERY_SUBGRAPH_MALFORMED_RESPONSE:pools");
  }

  return pools as GraphQlPoolRow[];
}

function mapPoolRow(input: {
  row: GraphQlPoolRow;
  chain: DexChain;
  metric: DiscoveryMetric;
  snapshotAt: string;
}): DiscoveredDexPool {
  const poolAddress = assertEvmAddress(readString(input.row.id, "pool.id"), "pool.id");
  const token0 = readToken(input.row.token0, "token0");
  const token1 = readToken(input.row.token1, "token1");
  const feeTier = readInteger(input.row.feeTier, "feeTier");
  const metricValue = readString(input.row[input.metric], input.metric);
  const pair = `${token0.symbol}/${token1.symbol}`;

  const pool: DexPoolConfig = {
    id: buildDiscoveredPoolId({
      chain: input.chain,
      token0Symbol: token0.symbol,
      token1Symbol: token1.symbol,
      feeTier,
      poolAddress,
    }),
    chain: input.chain,
    dex: "uniswap_v3",
    kind: "UNISWAP_V3_STYLE",
    poolAddress,
    token0,
    token1,
    baseToken: "token0",
    quoteToken: "token1",
    feeTier,
    startBlock: "0",
  };

  return {
    rank: 0,
    pool,
    metric: input.metric,
    metricValue,
    discovery: {
      source: "uniswap_v3_subgraph",
      snapshotAt: input.snapshotAt,
      rank: 0,
      metric: input.metric,
      metricValue,
      poolAddress,
      feeTier,
      pair,
    },
  };
}

function readToken(value: unknown, field: string): DexPoolConfig["token0"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`DISCOVERY_SUBGRAPH_MALFORMED_RESPONSE:${field}`);
  }

  const row = value as GraphQlTokenRow;

  return {
    address: assertEvmAddress(readString(row.id, `${field}.id`), `${field}.id`),
    symbol: readString(row.symbol, `${field}.symbol`),
    decimals: readInteger(row.decimals, `${field}.decimals`),
  };
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`DISCOVERY_SUBGRAPH_MALFORMED_RESPONSE:${field}`);
  }

  return value;
}

function readInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`DISCOVERY_SUBGRAPH_MALFORMED_RESPONSE:${field}`);
  }

  return parsed;
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`DISCOVERY_TOP_INVALID:${limit}`);
  }

  return limit;
}

function normalizePairFilter(values: string[] | undefined): Set<string> {
  const filters = new Set<string>();

  for (const value of values ?? []) {
    filters.add(normalizePair(value));
  }

  return filters;
}

function pairFilterMatches(filters: Set<string>, pair: string): boolean {
  const normalized = normalizePair(pair);
  const [left, right] = normalized.split("/") as [string, string];

  return filters.has(normalized) || filters.has(`${right}/${left}`);
}

function buildDiscoveredPoolId(input: {
  chain: DexChain;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number;
  poolAddress: HexString;
}): string {
  const symbols = `${input.token0Symbol}-${input.token1Symbol}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${input.chain}-uniswap-v3-${symbols}-${input.feeTier}-${input.poolAddress
    .toLowerCase()
    .slice(2, 10)}`;
}

function formatGraphQlError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : JSON.stringify(error);
  }

  return String(error);
}

