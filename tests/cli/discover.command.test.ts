import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDiscoverCommand } from "../../src/cli/commands/discover.command.js";
import type { DiscoveredDexPool } from "../../src/discovery/discovery.types.js";

vi.mock(
  "../../src/discovery/uniswap-v3-subgraph-discovery.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/discovery/uniswap-v3-subgraph-discovery.js")
      >();

    return {
      ...actual,
      discoverTopUniswapV3Pools: vi.fn(),
    };
  },
);

import { discoverTopUniswapV3Pools } from "../../src/discovery/uniswap-v3-subgraph-discovery.js";

const mockDiscover = vi.mocked(discoverTopUniswapV3Pools);

const DISCOVERED: DiscoveredDexPool[] = [
  {
    rank: 1,
    metric: "totalValueLockedUSD",
    metricValue: "120000000.50",
    pool: {
      id: "base-uniswap-v3-weth-usdc-500-d0b53d92",
      chain: "base",
      dex: "uniswap_v3",
      kind: "UNISWAP_V3_STYLE",
      poolAddress: "0xd0b53d9277642d899df5c87a3966a349a798f224",
      token0: {
        symbol: "WETH",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
      },
      token1: {
        symbol: "USDC",
        address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        decimals: 6,
      },
      baseToken: "token0",
      quoteToken: "token1",
      feeTier: 500,
      startBlock: "0",
    },
    discovery: {
      source: "uniswap_v3_subgraph",
      snapshotAt: "2026-06-10T00:00:00.000Z",
      rank: 1,
      metric: "totalValueLockedUSD",
      metricValue: "120000000.50",
      poolAddress: "0xd0b53d9277642d899df5c87a3966a349a798f224",
      feeTier: 500,
      pair: "WETH/USDC",
    },
  },
];

let stdoutCapture: string[] = [];
let stderrCapture: string[] = [];
let exitCode: number | undefined;
const tempDirs: string[] = [];
const originalBaseSubgraphUrl = process.env.BASE_UNISWAP_V3_SUBGRAPH_URL;

beforeEach(() => {
  stdoutCapture = [];
  stderrCapture = [];
  exitCode = undefined;
  process.env.BASE_UNISWAP_V3_SUBGRAPH_URL = "https://subgraph.example/graphql";

  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdoutCapture.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrCapture.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(
    (code?: number | string | null) => {
      exitCode = typeof code === "number" ? code : 0;
      throw new Error(`process.exit(${String(code)})`);
    },
  );

  mockDiscover.mockResolvedValue(DISCOVERED);
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env.BASE_UNISWAP_V3_SUBGRAPH_URL = originalBaseSubgraphUrl;

  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dex-pool-discover-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("discover command", () => {
  it("prints human-ranked output", async () => {
    await expect(
      runDiscoverCommand({ chain: "base", top: "10" }),
    ).rejects.toThrow("process.exit(0)");

    const output = stdoutCapture.join("");
    expect(output).toContain("Rank");
    expect(output).toContain("WETH/USDC");
    expect(output).toContain("120000000.50");
    expect(exitCode).toBe(0);
  });

  it("outputs valid JSON", async () => {
    await expect(
      runDiscoverCommand({ chain: "base", json: true }),
    ).rejects.toThrow("process.exit(0)");

    const parsed = JSON.parse(stdoutCapture.join("")) as {
      chain: string;
      source: string;
      pools: DiscoveredDexPool[];
    };
    expect(parsed.chain).toBe("base");
    expect(parsed.source).toBe("uniswap_v3_subgraph");
    expect(parsed.pools).toHaveLength(1);
    expect(parsed.pools[0]!.discovery.pair).toBe("WETH/USDC");
  });

  it("writes a simple config with discovered pools", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "dex-pool.config.json");

    await expect(
      runDiscoverCommand({ chain: "base", writeConfig: file }),
    ).rejects.toThrow("process.exit(0)");

    const config = JSON.parse(await readFile(file, "utf8")) as {
      chain: string;
      rpc: string;
      pools: string[];
    };
    expect(config.chain).toBe("base");
    expect(config.rpc).toBe("env:BASE_RPC_URL");
    expect(config.pools).toEqual([
      "0xd0b53d9277642d899df5c87a3966a349a798f224",
    ]);
  });

  it("refuses to overwrite existing config", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "dex-pool.config.json");
    await writeFile(file, "{}\n", "utf8");

    await expect(
      runDiscoverCommand({ chain: "base", writeConfig: file }),
    ).rejects.toThrow("process.exit(1)");

    expect(stderrCapture.join("")).toContain("DISCOVERY_CONFIG_EXISTS");
  });

  it("fails with explicit missing subgraph URL env error", async () => {
    delete process.env.BASE_UNISWAP_V3_SUBGRAPH_URL;

    await expect(runDiscoverCommand({ chain: "base" })).rejects.toThrow(
      "process.exit(1)",
    );

    expect(stderrCapture.join("")).toContain(
      "DISCOVERY_SUBGRAPH_URL_ENV_MISSING:BASE_UNISWAP_V3_SUBGRAPH_URL",
    );
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("passes filter options to discovery adapter", async () => {
    await expect(
      runDiscoverCommand({
        chain: "base",
        top: "5",
        by: "volumeUSD",
        minLiquidityUsd: "1000000",
        minVolumeUsd: "250000",
        includeFees: "500,3000",
        includePairs: "WETH/USDC",
        excludePairs: "USDC/USDbC",
        subgraphUrl: "https://direct.example/graphql",
      }),
    ).rejects.toThrow("process.exit(0)");

    expect(mockDiscover).toHaveBeenCalledWith({
      source: "uniswap_v3_subgraph",
      chain: "base",
      subgraphUrl: "https://direct.example/graphql",
      top: {
        by: "volumeUSD",
        limit: 5,
        minLiquidityUsd: 1000000,
        minVolumeUsd: 250000,
      },
      includeFees: [500, 3000],
      includePairs: ["WETH/USDC"],
      excludePairs: ["USDC/USDbC"],
    });
  });
});
