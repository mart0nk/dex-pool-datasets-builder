import { describe, expect, it, vi } from "vitest";
import {
  decodeUniswapV3PoolCreatedLog,
  discoverTopUniswapV3Pools,
  UNISWAP_V3_POOL_CREATED_TOPIC,
} from "../../src/discovery/uniswap-v3-rpc-discovery.js";
import { UNISWAP_V3_SWAP_TOPIC } from "../../src/evm/uniswap-v3-swap-decoder.js";
import type { EvmBlock, EvmJsonRpcClient } from "../../src/evm/evm-json-rpc-client.js";
import { UNISWAP_V3_FACTORY_PRESETS } from "../../src/simple/uniswap-v3-factory-presets.js";

const FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7C32D4f71b54bdA02913";
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const POOL_A = "0xd0b53d9277642d899df5c87a3966a349a798f224";
const POOL_B = "0x0000000000000000000000000000000000000001";

vi.mock("../../src/evm/evm-json-rpc-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/evm/evm-json-rpc-client.js")>();

  return {
    ...actual,
    createEvmJsonRpcClient: vi.fn(),
  };
});

vi.mock("../../src/simple/evm-contract-reader.js", () => ({
  readUniswapV3PoolConfig: vi.fn(),
}));

import { createEvmJsonRpcClient } from "../../src/evm/evm-json-rpc-client.js";
import { readUniswapV3PoolConfig } from "../../src/simple/evm-contract-reader.js";

const mockCreateClient = vi.mocked(createEvmJsonRpcClient);
const mockReadPoolConfig = vi.mocked(readUniswapV3PoolConfig);

describe("Uniswap v3 RPC discovery", () => {
  it("factory presets include deployment blocks", () => {
    for (const preset of Object.values(UNISWAP_V3_FACTORY_PRESETS)) {
      expect(preset?.factoryAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(preset?.deploymentBlock).toBeGreaterThan(0n);
    }
  });

  it("decodes PoolCreated logs into candidates", () => {
    const decoded = decodeUniswapV3PoolCreatedLog(
      poolCreatedLog({
        token0: WETH,
        token1: USDC,
        fee: 500,
        pool: POOL_A,
        blockNumber: 1_371_680n,
      }),
    );

    expect(decoded).toEqual({
      token0: WETH.toLowerCase(),
      token1: USDC.toLowerCase(),
      feeTier: 500,
      poolAddress: POOL_A.toLowerCase(),
    });
  });

  it("scans PoolCreated from the factory deployment block and ranks by swapCount", async () => {
    const poolCreatedLogs = [
        poolCreatedLog({
          token0: WETH,
          token1: USDC,
          fee: 500,
          pool: POOL_A,
          blockNumber: 1_371_680n,
        }),
        poolCreatedLog({
          token0: CBBTC,
          token1: WETH,
          fee: 3000,
          pool: POOL_B,
          blockNumber: 1_371_681n,
        }),
      ];
    const swapLogs = [
        swapLog({ pool: POOL_A, amount0: 1n, amount1: -2n }),
        swapLog({ pool: POOL_B, amount0: 1n, amount1: -2n }),
        swapLog({ pool: POOL_A, amount0: 2n, amount1: -4n }),
      ];
    let returnedSwapLogs = false;
    const getLogs = vi.fn(async (input) => {
      if (input.topics?.[0] === UNISWAP_V3_POOL_CREATED_TOPIC) {
        return input.fromBlock === 1_371_680n ? poolCreatedLogs : [];
      }

      if (!returnedSwapLogs) {
        returnedSwapLogs = true;
        return swapLogs;
      }

      return [];
    });
    mockCreateClient.mockReturnValue(makeClient({ getLogs }));
    mockReadPoolConfig.mockImplementation(async ({ poolAddress }) => ({
      id:
        poolAddress.toLowerCase() === POOL_A.toLowerCase()
          ? "base-uniswap-v3-weth-usdc-500-d0b53d92"
          : "base-uniswap-v3-cbbtc-weth-3000-00000000",
      chain: "base",
      dex: "uniswap_v3",
      kind: "UNISWAP_V3_STYLE",
      poolAddress,
      token0:
        poolAddress.toLowerCase() === POOL_A.toLowerCase()
          ? { symbol: "WETH", address: WETH, decimals: 18 }
          : { symbol: "cbBTC", address: CBBTC, decimals: 8 },
      token1:
        poolAddress.toLowerCase() === POOL_A.toLowerCase()
          ? { symbol: "USDC", address: USDC, decimals: 6 }
          : { symbol: "WETH", address: WETH, decimals: 18 },
      baseToken: "token0",
      quoteToken: "token1",
      feeTier:
        poolAddress.toLowerCase() === POOL_A.toLowerCase() ? 500 : 3000,
      startBlock: "1371680",
    }));

    const pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_rpc",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      top: { by: "swapCount", limit: 1, lookbackDays: 7 },
    });

    expect(getLogs.mock.calls[0]![0]).toMatchObject({
      address: FACTORY,
      fromBlock: 1_371_680n,
      topics: [UNISWAP_V3_POOL_CREATED_TOPIC],
    });
    const swapCall = getLogs.mock.calls.find(
      ([input]) => input.topics?.[0] === UNISWAP_V3_SWAP_TOPIC,
    )?.[0];
    expect(swapCall).toMatchObject({
      address: [POOL_A.toLowerCase(), POOL_B.toLowerCase()],
      topics: [UNISWAP_V3_SWAP_TOPIC],
    });
    expect(pools).toHaveLength(1);
    expect(pools[0]!.pool.poolAddress).toBe(POOL_A.toLowerCase());
    expect(pools[0]!.metric).toBe("swapCount");
    expect(pools[0]!.metricValue).toBe("2");
    expect(pools[0]!.discovery.factoryDeploymentBlock).toBe("1371680");
  });

  it("filters quote-token pools and ranks by quoteVolume", async () => {
    const poolCreatedLogs = [
        poolCreatedLog({
          token0: WETH,
          token1: USDC,
          fee: 500,
          pool: POOL_A,
          blockNumber: 1_371_680n,
        }),
        poolCreatedLog({
          token0: CBBTC,
          token1: WETH,
          fee: 3000,
          pool: POOL_B,
          blockNumber: 1_371_681n,
        }),
      ];
    const swapLogs = [
        swapLog({ pool: POOL_A, amount0: 1n, amount1: -1_250_000n }),
        swapLog({ pool: POOL_A, amount0: 2n, amount1: 2_500_000n }),
      ];
    let returnedSwapLogs = false;
    const getLogs = vi.fn(async (input) => {
      if (input.topics?.[0] === UNISWAP_V3_POOL_CREATED_TOPIC) {
        return input.fromBlock === 1_371_680n ? poolCreatedLogs : [];
      }

      if (!returnedSwapLogs) {
        returnedSwapLogs = true;
        return swapLogs;
      }

      return [];
    });
    mockCreateClient.mockReturnValue(makeClient({ getLogs }));
    mockReadPoolConfig.mockResolvedValue({
      id: "base-uniswap-v3-weth-usdc-500-d0b53d92",
      chain: "base",
      dex: "uniswap_v3",
      kind: "UNISWAP_V3_STYLE",
      poolAddress: POOL_A.toLowerCase(),
      token0: { symbol: "WETH", address: WETH, decimals: 18 },
      token1: { symbol: "USDC", address: USDC, decimals: 6 },
      baseToken: "token0",
      quoteToken: "token1",
      feeTier: 500,
      startBlock: "1371680",
    });

    const pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_rpc",
      chain: "base",
      rpcUrl: "https://base-rpc.example",
      top: { by: "quoteVolume", limit: 10, lookbackDays: 7 },
      quote: "USDC",
    });

    const swapCall = getLogs.mock.calls.find(
      ([input]) => input.topics?.[0] === UNISWAP_V3_SWAP_TOPIC,
    )?.[0];
    expect(swapCall?.address).toEqual([POOL_A.toLowerCase()]);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.metricValue).toBe("3.75");
    expect(pools[0]!.discovery.quoteVolume).toBe("3.75");
    expect(pools[0]!.discovery.quoteSymbol).toBe("USDC");
  });
});

function makeClient(input: {
  getLogs: EvmJsonRpcClient["getLogs"];
}): EvmJsonRpcClient {
  return {
    getLogs: input.getLogs,
    getLatestBlockNumber: async () => 2_000_000n,
    getBlockByNumber: async (blockNumber: bigint) =>
      ({
        number: toHex(blockNumber),
        hash: "0x".padEnd(66, "1"),
        timestamp:
          blockNumber === 2_000_000n
            ? toHex(1_700_604_800n)
            : toHex(1_700_000_000n + blockNumber),
      }) satisfies EvmBlock,
    getChainId: async () => 8453n,
    call: vi.fn(),
  };
}

function poolCreatedLog(input: {
  token0: string;
  token1: string;
  fee: number;
  pool: string;
  blockNumber: bigint;
}) {
  return {
    address: FACTORY,
    topics: [
      UNISWAP_V3_POOL_CREATED_TOPIC,
      topicAddress(input.token0),
      topicAddress(input.token1),
      toTopic(BigInt(input.fee)),
    ],
    data: `0x${word(10n)}${addressWord(input.pool)}`,
    blockNumber: toHex(input.blockNumber),
    blockHash: "0x".padEnd(66, "2"),
    transactionHash: "0x".padEnd(66, "3"),
    transactionIndex: "0x0",
    logIndex: "0x0",
  } as const;
}

function swapLog(input: { pool: string; amount0: bigint; amount1: bigint }) {
  return {
    address: input.pool.toLowerCase(),
    topics: [UNISWAP_V3_SWAP_TOPIC],
    data: `0x${signedWord(input.amount0)}${signedWord(input.amount1)}${word(1n)}${word(1n)}${word(1n)}`,
    blockNumber: "0x270f",
    blockHash: "0x".padEnd(66, "4"),
    transactionHash: "0x".padEnd(66, "5"),
    transactionIndex: "0x0",
    logIndex: "0x0",
  } as const;
}

function topicAddress(address: string): `0x${string}` {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function addressWord(address: string): string {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

function toTopic(value: bigint): `0x${string}` {
  return `0x${word(value)}`;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function signedWord(value: bigint): string {
  return value >= 0n ? word(value) : word((1n << 256n) + value);
}

function toHex(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}
