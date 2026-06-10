import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDoctorCommand } from '../../src/cli/commands/doctor.command.js';
import { runInspectCommand } from '../../src/cli/commands/inspect.command.js';

vi.mock('../../src/evm/evm-json-rpc-client.js', () => ({
  createEvmJsonRpcClient: vi.fn(),
}));

vi.mock('../../src/simple/resolve-pool-selection.js', () => ({
  resolvePoolSelection: vi.fn(),
}));

vi.mock('../../src/simple/evm-contract-reader.js', () => ({
  readUniswapV3PoolConfig: vi.fn(),
}));

import { createEvmJsonRpcClient } from '../../src/evm/evm-json-rpc-client.js';
import { readUniswapV3PoolConfig } from '../../src/simple/evm-contract-reader.js';
import { resolvePoolSelection } from '../../src/simple/resolve-pool-selection.js';

const mockCreateClient = vi.mocked(createEvmJsonRpcClient);
const mockResolvePoolSelection = vi.mocked(resolvePoolSelection);
const mockReadPoolConfig = vi.mocked(readUniswapV3PoolConfig);

let stdoutCapture: string[] = [];

beforeEach(() => {
  stdoutCapture = [];
  process.env['BASE_RPC_URL'] = 'https://base-rpc.example.com';

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutCapture.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${String(code)})`);
  });

  mockCreateClient.mockReturnValue({
    getChainId: vi.fn().mockResolvedValue(8453n),
    getLatestBlockNumber: vi.fn().mockResolvedValue(12_345n),
    getLogs: vi.fn(),
    getBlockByNumber: vi.fn(),
    call: vi.fn(),
  });
  mockResolvePoolSelection.mockResolvedValue({
    poolAddress: '0x0000000000000000000000000000000000000001',
    resolvedBy: 'liquid_pair_preset',
    pair: 'WETH/USDC',
    fee: 500,
    base: 'WETH',
    quote: 'USDC',
    metadata: {
      resolvedBy: 'liquid_pair_preset',
      inputPair: 'WETH/USDC',
      presetFee: 500,
      resolvedPoolAddress: '0x0000000000000000000000000000000000000001',
    },
  });
  mockReadPoolConfig.mockResolvedValue({
    id: 'base-uniswap-v3-weth-usdc-500',
    chain: 'base',
    dex: 'uniswap_v3',
    kind: 'UNISWAP_V3_STYLE',
    poolAddress: '0x0000000000000000000000000000000000000001',
    token0: {
      symbol: 'WETH',
      address: '0x0000000000000000000000000000000000000002',
      decimals: 18,
    },
    token1: {
      symbol: 'USDC',
      address: '0x0000000000000000000000000000000000000003',
      decimals: 6,
    },
    baseToken: 'token0',
    quoteToken: 'token1',
    feeTier: 500,
    startBlock: '0',
  });
});

afterEach(() => {
  delete process.env['BASE_RPC_URL'];
  vi.restoreAllMocks();
});

describe('inspect command', () => {
  it('outputs JSON for a pair selection', async () => {
    await runInspectCommand({ chain: 'base', pair: 'WETH/USDC', json: true });

    const parsed = JSON.parse(stdoutCapture.join('')) as {
      selection: { resolvedBy: string };
      pool: { id: string };
    };
    expect(parsed.selection.resolvedBy).toBe('liquid_pair_preset');
    expect(parsed.pool.id).toBe('base-uniswap-v3-weth-usdc-500');
  });
});

describe('doctor command', () => {
  it('outputs JSON and exits 0 when core checks pass', async () => {
    await expect(
      runDoctorCommand({ chain: 'base', json: true }),
    ).rejects.toThrow('process.exit(0)');

    const parsed = JSON.parse(stdoutCapture.join('')) as {
      ok: boolean;
      checks: Array<{ name: string; ok: boolean }>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.map((check) => check.name)).toEqual([
      'rpc',
      'chainId',
      'latestBlock',
    ]);
  });
});
