import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DexBuildConfig } from '../../src/config/dex-build-config.types.js';
import { validateDexBuildConfig } from '../../src/config/validate-dex-build-config.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

import { access, readFile } from 'node:fs/promises';

const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);

const VALID_POOL_REGISTRY = JSON.stringify([
  {
    id: 'base-uniswapv3-weth-usdc-500',
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
    startBlock: '12300000',
  },
]);

function validConfig(overrides?: Partial<DexBuildConfig>): DexBuildConfig {
  return {
    datasetId: 'base-uniswap-v3-weth-usdc-v1',
    registry: { path: 'config/dex-pools.base.example.json' },
    network: {
      chain: 'base',
      chainId: 8453,
      rpcUrlEnv: 'BASE_RPC_URL',
    },
    build: {
      pools: ['base-uniswapv3-weth-usdc-500'],
      fromBlock: '12345678',
      toBlock: '12400000',
      baseTimeframe: '1m',
      timeframes: ['1m', '5m', '15m', '1h'],
    },
    output: {
      type: 'local',
      uri: 'local://./data/dex-pool-datasets',
    },
    ...overrides,
  };
}

beforeEach(() => {
  process.env['BASE_RPC_URL'] = 'https://base-rpc.example.com';
  mockAccess.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue(VALID_POOL_REGISTRY as unknown as string);
});

afterEach(() => {
  delete process.env['BASE_RPC_URL'];
  vi.clearAllMocks();
});

describe('validateDexBuildConfig', () => {
  it('returns valid for a fully correct config', async () => {
    const result = await validateDexBuildConfig({ config: validConfig() });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns error when rpcUrlEnv is not set in process.env', async () => {
    delete process.env['BASE_RPC_URL'];
    const result = await validateDexBuildConfig({ config: validConfig() });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('RPC_ENV_MISSING:BASE_RPC_URL'))).toBe(true);
  });

  it('returns error when pool id is not found in registry', async () => {
    const config = validConfig({ build: { ...validConfig().build, pools: ['unknown-pool'] } });
    const result = await validateDexBuildConfig({ config });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('POOL_NOT_FOUND:unknown-pool'))).toBe(true);
  });

  it('returns error for invalid s3 URI without bucket+prefix', async () => {
    const config = validConfig({
      output: { type: 's3', uri: 's3://missing-prefix' },
    });
    const result = await validateDexBuildConfig({ config });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('output.uri'))).toBe(true);
  });

  it('accepts valid s3 URI with bucket and prefix', async () => {
    const config = validConfig({
      output: { type: 's3', uri: 's3://my-bucket/some/prefix' },
    });
    const result = await validateDexBuildConfig({ config });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns error when fromBlock >= toBlock', async () => {
    const config = validConfig({
      build: {
        ...validConfig().build,
        fromBlock: '12400000',
        toBlock: '12345678',
      },
    });
    const result = await validateDexBuildConfig({ config });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('INVALID_RANGE:'))).toBe(true);
  });

  it('returns error when fromBlock equals toBlock', async () => {
    const config = validConfig({
      build: {
        ...validConfig().build,
        fromBlock: '12000000',
        toBlock: '12000000',
      },
    });
    const result = await validateDexBuildConfig({ config });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('INVALID_RANGE:'))).toBe(true);
  });

  it('returns error when baseTimeframe is not in timeframes array', async () => {
    const config = validConfig({
      build: {
        ...validConfig().build,
        baseTimeframe: '1m',
        timeframes: ['5m', '15m'],
      },
    });
    const result = await validateDexBuildConfig({ config });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('build.timeframes must include build.baseTimeframe'))).toBe(true);
  });

  it('returns error for unknown profile flag', async () => {
    const result = await validateDexBuildConfig({
      config: validConfig({ profiles: { local: {} } }),
      profile: 'nonexistent',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('UNKNOWN_PROFILE:nonexistent'))).toBe(true);
  });

  it('passes when a valid profile is specified', async () => {
    const config = validConfig({
      profiles: {
        local: { output: { type: 'local', uri: 'local://./data' } },
      },
    });
    const result = await validateDexBuildConfig({ config, profile: 'local' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns error when registry file is not accessible', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await validateDexBuildConfig({ config: validConfig() });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('REGISTRY_NOT_FOUND:'))).toBe(true);
  });

  it('returns error for invalid chunkSize', async () => {
    const config = validConfig({
      build: { ...validConfig().build, chunkSize: '-100' },
    });
    const result = await validateDexBuildConfig({ config });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('chunkSize'))).toBe(true);
  });

  it('returns errors for missing required fields', async () => {
    const config = {
      datasetId: '',
      registry: { path: '' },
      network: { chain: '', chainId: 'not-a-number' as unknown as number, rpcUrlEnv: '' },
      build: {
        pools: [],
        fromBlock: 'notanumber',
        toBlock: 'notanumber',
        baseTimeframe: 'invalid' as unknown as import('../../src/contracts/timeframe.js').Timeframe,
        timeframes: [],
      },
      output: { type: 'invalid' as unknown as 'local', uri: '' },
    } satisfies DexBuildConfig;

    const result = await validateDexBuildConfig({ config });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
