import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverTopUniswapV3Pools } from "../../src/discovery/uniswap-v3-subgraph-discovery.js";

const POOL_A = {
  id: "0xd0b53d9277642d899df5c87a3966a349a798f224",
  feeTier: "500",
  liquidity: "1000",
  totalValueLockedUSD: "120000000.50",
  volumeUSD: "5000000",
  txCount: "100",
  token0: {
    id: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    decimals: "18",
  },
  token1: {
    id: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    decimals: "6",
  },
};

const POOL_B = {
  id: "0x0000000000000000000000000000000000000001",
  feeTier: "3000",
  liquidity: "900",
  totalValueLockedUSD: "42000000",
  volumeUSD: "2500000",
  txCount: "50",
  token0: {
    id: "0x0000000000000000000000000000000000000002",
    symbol: "cbBTC",
    decimals: "8",
  },
  token1: {
    id: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    decimals: "18",
  },
};

const POOL_C = {
  ...POOL_A,
  id: "0x0000000000000000000000000000000000000003",
  totalValueLockedUSD: "11000000",
};

const POOL_D = {
  ...POOL_A,
  id: "0x0000000000000000000000000000000000000004",
  totalValueLockedUSD: "10000000",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockSubgraphResponse(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    })),
  );
}

describe("discoverTopUniswapV3Pools", () => {
  it("maps subgraph response to ranked DexPoolConfig entries", async () => {
    mockSubgraphResponse({ data: { pools: [POOL_A, POOL_B] } });

    const pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_subgraph",
      chain: "base",
      subgraphUrl: "https://subgraph.example/graphql",
      top: { by: "totalValueLockedUSD", limit: 10 },
    });

    expect(pools).toHaveLength(2);
    expect(pools[0]!.rank).toBe(1);
    expect(pools[0]!.pool.poolAddress).toBe(POOL_A.id);
    expect(pools[0]!.pool.token0.symbol).toBe("WETH");
    expect(pools[0]!.pool.token1.decimals).toBe(6);
    expect(pools[0]!.pool.baseToken).toBe("token0");
    expect(pools[0]!.pool.quoteToken).toBe("token1");
    expect(pools[0]!.pool.startBlock).toBe("0");
    expect(pools[0]!.metricValue).toBe("120000000.50");
    expect(pools[0]!.discovery.source).toBe("uniswap_v3_subgraph");
    expect(pools[1]!.rank).toBe(2);
  });

  it("filters includeFees and ranks after filtering", async () => {
    mockSubgraphResponse({ data: { pools: [POOL_A, POOL_B] } });

    const pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_subgraph",
      chain: "base",
      subgraphUrl: "https://subgraph.example/graphql",
      top: { by: "totalValueLockedUSD", limit: 10 },
      includeFees: [3000],
    });

    expect(pools).toHaveLength(1);
    expect(pools[0]!.rank).toBe(1);
    expect(pools[0]!.pool.feeTier).toBe(3000);
  });

  it("filters includePairs and excludePairs direction-insensitively", async () => {
    mockSubgraphResponse({ data: { pools: [POOL_A, POOL_B] } });

    const pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_subgraph",
      chain: "base",
      subgraphUrl: "https://subgraph.example/graphql",
      top: { by: "totalValueLockedUSD", limit: 10 },
      includePairs: ["USDC/WETH", "cbBTC/WETH"],
      excludePairs: ["WETH/cbBTC"],
    });

    expect(pools).toHaveLength(1);
    expect(pools[0]!.discovery.pair).toBe("WETH/USDC");
  });

  it("passes minLiquidityUsd and minVolumeUsd as GraphQL variables", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { pools: [] } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await discoverTopUniswapV3Pools({
      source: "uniswap_v3_subgraph",
      chain: "base",
      subgraphUrl: "https://subgraph.example/graphql",
      top: {
        by: "volumeUSD",
        limit: 5,
        minLiquidityUsd: 1000000,
        minVolumeUsd: 250000,
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(body.query).toContain("orderBy: volumeUSD");
    expect(body.variables).toMatchObject({
      first: 25,
      minTvl: "1000000",
      minVolume: "250000",
    });
  });

  it("over-fetches before local filters, then returns top N after filtering", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ data: { pools: [POOL_B, POOL_A, POOL_C, POOL_D] } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_subgraph",
      chain: "base",
      subgraphUrl: "https://subgraph.example/graphql",
      top: { by: "totalValueLockedUSD", limit: 2 },
      includeFees: [500],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
      variables: Record<string, unknown>;
    };
    expect(body.variables.first).toBe(10);
    expect(pools).toHaveLength(2);
    expect(pools.map((pool) => pool.pool.poolAddress)).toEqual([
      POOL_A.id,
      POOL_C.id,
    ]);
    expect(pools.map((pool) => pool.rank)).toEqual([1, 2]);
    expect(pools.map((pool) => pool.discovery.rank)).toEqual([1, 2]);
  });

  it("rejects malformed responses", async () => {
    mockSubgraphResponse({ data: { pools: [{ ...POOL_A, token0: null }] } });

    await expect(
      discoverTopUniswapV3Pools({
        source: "uniswap_v3_subgraph",
        chain: "base",
        subgraphUrl: "https://subgraph.example/graphql",
        top: { by: "totalValueLockedUSD", limit: 10 },
      }),
    ).rejects.toThrow("DISCOVERY_SUBGRAPH_MALFORMED_RESPONSE");
  });

  it("reports GraphQL errors", async () => {
    mockSubgraphResponse({ errors: [{ message: "bad query" }] });

    await expect(
      discoverTopUniswapV3Pools({
        source: "uniswap_v3_subgraph",
        chain: "base",
        subgraphUrl: "https://subgraph.example/graphql",
        top: { by: "totalValueLockedUSD", limit: 10 },
      }),
    ).rejects.toThrow("DISCOVERY_SUBGRAPH_GRAPHQL_ERROR:bad query");
  });

  it("reports invalid JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "not-json",
      })),
    );

    await expect(
      discoverTopUniswapV3Pools({
        source: "uniswap_v3_subgraph",
        chain: "base",
        subgraphUrl: "https://subgraph.example/graphql",
        top: { by: "totalValueLockedUSD", limit: 10 },
      }),
    ).rejects.toThrow("DISCOVERY_SUBGRAPH_INVALID_JSON");
  });

  it("reports non-2xx HTTP responses", async () => {
    mockSubgraphResponse({ error: "rate limited" }, 429);

    await expect(
      discoverTopUniswapV3Pools({
        source: "uniswap_v3_subgraph",
        chain: "base",
        subgraphUrl: "https://subgraph.example/graphql",
        top: { by: "totalValueLockedUSD", limit: 10 },
      }),
    ).rejects.toThrow("DISCOVERY_SUBGRAPH_HTTP_ERROR:429");
  });
});
