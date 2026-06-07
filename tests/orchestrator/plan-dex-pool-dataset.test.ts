import { describe, expect, it } from 'vitest';
import { planDexPoolDataset } from '../../src/orchestrator/plan-dex-pool-dataset.js';
import type { ResolvedDexBuildConfig } from '../../src/config/dex-build-config.types.js';

function makeConfig(overrides: Partial<ResolvedDexBuildConfig> = {}): ResolvedDexBuildConfig {
  return {
    datasetId: 'base-weth-usdc-v3',
    registryPath: '/path/to/registry.json',
    network: {
      chain: 'base',
      chainId: 8453,
      rpcUrl: 'https://rpc.base.example.com',
    },
    build: {
      pools: ['base-uniswap-v3-weth-usdc-005', 'base-uniswap-v3-wbtc-usdc-030'],
      fromBlock: 10_000_000n,
      toBlock: 10_005_000n,
      baseTimeframe: '1m',
      timeframes: ['1m', '5m', '15m'],
      chunkSize: 5000n,
      failFast: true,
    },
    output: {
      type: 'local',
      uri: 'local:///data/datasets',
    },
    ...overrides,
  };
}

describe('planDexPoolDataset', () => {
  it('returns correct datasetId, outputUri, and pool list', () => {
    const plan = planDexPoolDataset(makeConfig());

    expect(plan.datasetId).toBe('base-weth-usdc-v3');
    expect(plan.outputUri).toBe('local:///data/datasets');
    expect(plan.pools).toHaveLength(2);
    expect(plan.pools[0]?.poolId).toBe('base-uniswap-v3-weth-usdc-005');
    expect(plan.pools[1]?.poolId).toBe('base-uniswap-v3-wbtc-usdc-030');
  });

  it('converts bigint block numbers and chunkSize to strings', () => {
    const plan = planDexPoolDataset(makeConfig());

    expect(plan.pools[0]?.fromBlock).toBe('10000000');
    expect(plan.pools[0]?.toBlock).toBe('10005000');
    expect(plan.pools[0]?.chunkSize).toBe('5000');
  });

  it('reflects the baseTimeframe and timeframes in each pool entry', () => {
    const plan = planDexPoolDataset(makeConfig());

    expect(plan.pools[0]?.baseTimeframe).toBe('1m');
    expect(plan.pools[0]?.timeframes).toEqual(['1m', '5m', '15m']);
  });

  it('sets rpcEnvPresent=true when rpcUrl is non-empty', () => {
    const plan = planDexPoolDataset(makeConfig());
    expect(plan.rpcEnvPresent).toBe(true);
  });

  it('sets rpcEnvPresent=false when rpcUrl is empty', () => {
    const plan = planDexPoolDataset(makeConfig({
      network: { chain: 'base', chainId: 8453, rpcUrl: '' },
    }));
    expect(plan.rpcEnvPresent).toBe(false);
  });

  it('includes optional profile when present', () => {
    const plan = planDexPoolDataset(makeConfig({ profile: 'staging' }));
    expect(plan.profile).toBe('staging');
  });

  it('leaves profile undefined when not set', () => {
    const plan = planDexPoolDataset(makeConfig());
    expect(plan.profile).toBeUndefined();
  });

  it('returns an empty pools array when build.pools is empty', () => {
    const plan = planDexPoolDataset(makeConfig({
      build: {
        pools: [],
        fromBlock: 10_000_000n,
        toBlock: 10_005_000n,
        baseTimeframe: '1m',
        timeframes: ['1m'],
        chunkSize: 5000n,
        failFast: true,
      },
    }));
    expect(plan.pools).toHaveLength(0);
  });
});
