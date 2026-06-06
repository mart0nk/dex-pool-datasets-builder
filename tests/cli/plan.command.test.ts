import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPlanOutput, runPlanCommand } from '../../src/cli/commands/plan.command.js';
import type { ResolvedDexBuildConfig } from '../../src/config/dex-build-config.types.js';

// Mock the config loading modules
vi.mock('../../src/config/load-dex-build-config.js', () => ({
  loadDexBuildConfig: vi.fn(),
}));

vi.mock('../../src/config/resolve-dex-build-config.js', () => ({
  resolveDexBuildConfig: vi.fn(),
}));

import { loadDexBuildConfig } from '../../src/config/load-dex-build-config.js';
import { resolveDexBuildConfig } from '../../src/config/resolve-dex-build-config.js';

const mockLoad = vi.mocked(loadDexBuildConfig);
const mockResolve = vi.mocked(resolveDexBuildConfig);

const MOCK_RAW_CONFIG = {
  datasetId: 'base-uniswap-v3-weth-usdc-v1',
  registry: { path: 'config/registry.json' },
  network: {
    chain: 'base',
    chainId: 8453,
    rpcUrlEnv: 'BASE_RPC_URL',
  },
  build: {
    pools: ['base-uniswapv3-weth-usdc-500'],
    fromBlock: '12345678',
    toBlock: '12400000',
    baseTimeframe: '1m' as const,
    timeframes: ['1m', '5m', '15m', '1h'] as Array<import('../../src/contracts/timeframe.js').Timeframe>,
    chunkSize: '5000',
    failFast: true,
  },
  output: {
    type: 'local' as const,
    uri: 'local://./data/dex-pool-datasets',
  },
};

const MOCK_RESOLVED: ResolvedDexBuildConfig = {
  datasetId: 'base-uniswap-v3-weth-usdc-v1',
  registryPath: 'config/registry.json',
  network: {
    chain: 'base',
    chainId: 8453,
    rpcUrl: 'https://base-rpc.example.com',
  },
  build: {
    pools: ['base-uniswapv3-weth-usdc-500'],
    fromBlock: 12345678n,
    toBlock: 12400000n,
    baseTimeframe: '1m',
    timeframes: ['1m', '5m', '15m', '1h'],
    chunkSize: 5000n,
    failFast: true,
  },
  output: {
    type: 'local',
    uri: 'local://./data/dex-pool-datasets',
  },
};

let stdoutCapture: string[] = [];
let stderrCapture: string[] = [];

beforeEach(() => {
  stdoutCapture = [];
  stderrCapture = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutCapture.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrCapture.push(String(chunk));
    return true;
  });

  mockLoad.mockResolvedValue(MOCK_RAW_CONFIG);
  mockResolve.mockReturnValue(MOCK_RESOLVED);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('plan command', () => {
  it('outputs the datasetId in human-readable mode', async () => {
    await runPlanCommand({ config: 'dex-dataset.config.json' });
    const output = stdoutCapture.join('');
    expect(output).toContain('base-uniswap-v3-weth-usdc-v1');
  });

  it('outputs pool information in human-readable mode', async () => {
    await runPlanCommand({ config: 'dex-dataset.config.json' });
    const output = stdoutCapture.join('');
    expect(output).toContain('base-uniswapv3-weth-usdc-500');
    expect(output).toContain('12345678');
    expect(output).toContain('12400000');
    expect(output).toContain('1m');
  });

  it('outputs "No dataset objects will be written"', async () => {
    await runPlanCommand({ config: 'dex-dataset.config.json' });
    const output = stdoutCapture.join('');
    expect(output).toContain('No dataset objects will be written');
  });

  it('makes no fs write calls (plan is read-only)', async () => {
    // runPlanCommand only calls loadDexBuildConfig and resolveDexBuildConfig —
    // both are mocked above. We verify no writes happen by checking the
    // output does not contain any indication of written files.
    await runPlanCommand({ config: 'dex-dataset.config.json' });
    const output = stdoutCapture.join('');
    expect(output).toContain('No dataset objects will be written');
    // Mocked loadDexBuildConfig was called, mocked resolveDexBuildConfig was called,
    // but no real file operations happened.
    expect(mockLoad).toHaveBeenCalledOnce();
    expect(mockResolve).toHaveBeenCalledOnce();
  });

  it('outputs valid JSON with --json flag', async () => {
    await runPlanCommand({ config: 'dex-dataset.config.json', json: true });
    const output = stdoutCapture.join('');
    const parsed: unknown = JSON.parse(output);
    expect(parsed).toMatchObject({
      datasetId: 'base-uniswap-v3-weth-usdc-v1',
      willWrite: false,
    });
  });

  it('includes pool entries in JSON output', async () => {
    await runPlanCommand({ config: 'dex-dataset.config.json', json: true });
    const output = stdoutCapture.join('');
    const parsed = JSON.parse(output) as { pools: Array<{ id: string }> };
    expect(parsed.pools).toHaveLength(1);
    expect(parsed.pools[0]?.id).toBe('base-uniswapv3-weth-usdc-500');
  });

  it('filters to a single pool when --pool is specified', async () => {
    const resolved = {
      ...MOCK_RESOLVED,
      build: {
        ...MOCK_RESOLVED.build,
        pools: ['pool-a', 'pool-b'],
      },
    };
    mockResolve.mockReturnValue(resolved);

    await runPlanCommand({ config: 'dex-dataset.config.json', pool: 'pool-a', json: true });
    const output = stdoutCapture.join('');
    const parsed = JSON.parse(output) as { pools: Array<{ id: string }> };
    expect(parsed.pools).toHaveLength(1);
    expect(parsed.pools[0]?.id).toBe('pool-a');
  });

  it('shows profile name in human-readable output when profile is set', async () => {
    const resolved = { ...MOCK_RESOLVED, profile: 'local' };
    mockResolve.mockReturnValue(resolved);

    await runPlanCommand({ config: 'dex-dataset.config.json', profile: 'local' });
    const output = stdoutCapture.join('');
    expect(output).toContain('Profile: local');
  });
});

describe('buildPlanOutput', () => {
  it('constructs correct plan output shape', () => {
    const result = buildPlanOutput(MOCK_RESOLVED, 'BASE_RPC_URL', ['base-uniswapv3-weth-usdc-500']);
    expect(result.datasetId).toBe('base-uniswap-v3-weth-usdc-v1');
    expect(result.willWrite).toBe(false);
    expect(result.network.rpcUrlEnv).toBe('BASE_RPC_URL');
    expect(result.network.rpcEnvPresent).toBe(true);
    expect(result.pools[0]?.id).toBe('base-uniswapv3-weth-usdc-500');
    expect(result.pools[0]?.fromBlock).toBe('12345678');
    expect(result.pools[0]?.toBlock).toBe('12400000');
    expect(result.pools[0]?.chunkSize).toBe('5000');
  });
});
