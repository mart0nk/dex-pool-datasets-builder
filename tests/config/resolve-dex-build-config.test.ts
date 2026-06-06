import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDexBuildConfig } from '../../src/config/resolve-dex-build-config.js';
import type { DexBuildConfig } from '../../src/config/dex-build-config.types.js';

function baseConfig(overrides?: Partial<DexBuildConfig>): DexBuildConfig {
  return {
    datasetId: 'test-dataset',
    registry: { path: 'config/registry.json' },
    network: {
      chain: 'base',
      chainId: 8453,
      rpcUrlEnv: 'TEST_RPC_URL',
    },
    build: {
      pools: ['pool-a'],
      fromBlock: '1000',
      toBlock: '2000',
      baseTimeframe: '1m',
      timeframes: ['1m', '5m'],
    },
    output: {
      type: 'local',
      uri: 'local://./data',
    },
    profiles: {
      staging: {
        output: {
          type: 's3',
          uri: 's3://staging-bucket/data',
        },
      },
      prod: {
        output: {
          type: 's3',
          uri: 's3://prod-bucket/data',
        },
        build: {
          pools: ['pool-a', 'pool-b'],
        },
      },
    },
    ...overrides,
  };
}

const envKey = 'TEST_RPC_URL';

beforeEach(() => {
  process.env[envKey] = 'https://rpc.example.com';
});

afterEach(() => {
  delete process.env[envKey];
});

describe('resolveDexBuildConfig', () => {
  it('resolves a valid config with no profile', () => {
    const result = resolveDexBuildConfig({ config: baseConfig() });
    expect(result.datasetId).toBe('test-dataset');
    expect(result.registryPath).toBe('config/registry.json');
    expect(result.network.chain).toBe('base');
    expect(result.network.chainId).toBe(8453);
    expect(result.network.rpcUrl).toBe('https://rpc.example.com');
    expect(result.output.type).toBe('local');
    expect(result.output.uri).toBe('local://./data');
    expect(result.profile).toBeUndefined();
  });

  it('fromBlock and toBlock are bigint', () => {
    const result = resolveDexBuildConfig({ config: baseConfig() });
    expect(typeof result.build.fromBlock).toBe('bigint');
    expect(typeof result.build.toBlock).toBe('bigint');
    expect(result.build.fromBlock).toBe(1000n);
    expect(result.build.toBlock).toBe(2000n);
  });

  it('chunkSize defaults to 5000n when not specified', () => {
    const result = resolveDexBuildConfig({ config: baseConfig() });
    expect(result.build.chunkSize).toBe(5000n);
  });

  it('chunkSize is parsed from config when specified', () => {
    const config = baseConfig();
    config.build.chunkSize = '2500';
    const result = resolveDexBuildConfig({ config });
    expect(result.build.chunkSize).toBe(2500n);
  });

  it('failFast defaults to true when not specified', () => {
    const result = resolveDexBuildConfig({ config: baseConfig() });
    expect(result.build.failFast).toBe(true);
  });

  it('failFast is read from config when specified', () => {
    const config = baseConfig();
    config.build.failFast = false;
    const result = resolveDexBuildConfig({ config });
    expect(result.build.failFast).toBe(false);
  });

  it('merges profile output overrides correctly', () => {
    const result = resolveDexBuildConfig({ config: baseConfig(), profile: 'staging' });
    expect(result.output.type).toBe('s3');
    expect(result.output.uri).toBe('s3://staging-bucket/data');
    expect(result.profile).toBe('staging');
  });

  it('merges profile build overrides correctly', () => {
    const result = resolveDexBuildConfig({ config: baseConfig(), profile: 'prod' });
    expect(result.build.pools).toEqual(['pool-a', 'pool-b']);
    expect(result.output.uri).toBe('s3://prod-bucket/data');
  });

  it('throws CONFIG_UNKNOWN_PROFILE for an unknown profile', () => {
    expect(() => resolveDexBuildConfig({ config: baseConfig(), profile: 'nonexistent' })).toThrow(
      'CONFIG_UNKNOWN_PROFILE:nonexistent',
    );
  });

  it('throws CONFIG_RPC_ENV_MISSING when env var is not set', () => {
    delete process.env[envKey];
    expect(() => resolveDexBuildConfig({ config: baseConfig() })).toThrow(
      `CONFIG_RPC_ENV_MISSING:${envKey}`,
    );
  });

  it('applies outputOverride and infers type for s3 URIs', () => {
    const result = resolveDexBuildConfig({
      config: baseConfig(),
      outputOverride: 's3://override-bucket/prefix',
    });
    expect(result.output.type).toBe('s3');
    expect(result.output.uri).toBe('s3://override-bucket/prefix');
  });

  it('applies outputOverride and infers type as local for non-s3 URIs', () => {
    const result = resolveDexBuildConfig({
      config: baseConfig(),
      outputOverride: '/tmp/local-output',
    });
    expect(result.output.type).toBe('local');
    expect(result.output.uri).toBe('/tmp/local-output');
  });

  it('preserves finality config from network section', () => {
    const config = baseConfig();
    config.network.finality = { mode: 'confirmation_lag', confirmations: 64 };
    const result = resolveDexBuildConfig({ config });
    expect(result.network.finality).toEqual({ mode: 'confirmation_lag', confirmations: 64 });
  });
});
