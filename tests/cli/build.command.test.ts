import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRunReport, runBuildCommand } from '../../src/cli/commands/build.command.js';
import type { DexBuildRunReport } from '../../src/orchestrator/dex-build-result.types.js';
import type { ResolvedDexBuildConfig } from '../../src/config/dex-build-config.types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/simple/resolve-simple-build-config.js', () => ({
  resolveSimpleDexBuildConfig: vi.fn(),
}));

vi.mock('../../src/orchestrator/build-dex-pool-dataset.js', () => ({
  buildDexPoolDataset: vi.fn(),
}));

import { resolveSimpleDexBuildConfig } from '../../src/simple/resolve-simple-build-config.js';
import { buildDexPoolDataset } from '../../src/orchestrator/build-dex-pool-dataset.js';

const mockResolveSimple = vi.mocked(resolveSimpleDexBuildConfig);
const mockBuild = vi.mocked(buildDexPoolDataset);

const MOCK_RESOLVED: ResolvedDexBuildConfig = {
  datasetId: 'base-uniswap-v3-weth-usdc-v1',
  registryPools: [
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
      startBlock: '12345678',
    },
  ],
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

const MOCK_QUALITY_PASSED = {
  passed: true,
  duplicateLogs: 0,
  invalidLogs: 0,
  missingBlockTimestamps: 0,
  reorgConflicts: 0,
  noTradeIntervals: 0,
  extremeWickCandles: 0,
  incompleteBlockRanges: 0,
};

const MOCK_QUALITY_FAILED = {
  passed: false,
  duplicateLogs: 0,
  invalidLogs: 1,
  missingBlockTimestamps: 0,
  reorgConflicts: 2,
  noTradeIntervals: 0,
  extremeWickCandles: 0,
  incompleteBlockRanges: 0,
};

const MOCK_WRITTEN_OBJECTS = [
  { key: 'base-uniswap-v3-weth-usdc-v1/base-uniswapv3-weth-usdc-500/WETHUSDC/1m.jsonl', uri: 'local://./data/dex-pool-datasets/base-uniswap-v3-weth-usdc-v1/base-uniswapv3-weth-usdc-500/WETHUSDC/1m.jsonl' },
  { key: 'base-uniswap-v3-weth-usdc-v1/base-uniswapv3-weth-usdc-500/WETHUSDC/5m.jsonl', uri: 'local://./data/dex-pool-datasets/base-uniswap-v3-weth-usdc-v1/base-uniswapv3-weth-usdc-500/WETHUSDC/5m.jsonl' },
  { key: 'base-uniswap-v3-weth-usdc-v1/base-uniswapv3-weth-usdc-500/WETHUSDC/15m.jsonl', uri: 'local://./data/dex-pool-datasets/base-uniswap-v3-weth-usdc-v1/base-uniswapv3-weth-usdc-500/WETHUSDC/15m.jsonl' },
  { key: 'base-uniswap-v3-weth-usdc-v1/base-uniswapv3-weth-usdc-500/WETHUSDC/1h.jsonl', uri: 'local://./data/dex-pool-datasets/base-uniswap-v3-weth-usdc-v1/base-uniswapv3-weth-usdc-500/WETHUSDC/1h.jsonl' },
];

const MOCK_RUN_REPORT_COMPLETED: DexBuildRunReport = {
  schemaVersion: 1,
  datasetId: 'base-uniswap-v3-weth-usdc-v1',
  runId: 'run-abc123',
  startedAt: '2024-01-01T00:00:00.000Z',
  finishedAt: '2024-01-01T00:01:00.000Z',
  status: 'completed',
  config: {
    profile: 'local',
    registryPath: 'config/registry.json',
    outputUri: 'local://./data/dex-pool-datasets',
    selectedPools: ['base-uniswapv3-weth-usdc-500'],
  },
  pools: [
    {
      poolId: 'base-uniswapv3-weth-usdc-500',
      symbol: 'WETHUSDC',
      blockRange: { fromBlock: '12345678', toBlock: '12400000' },
      timeframes: ['1m', '5m', '15m', '1h'],
      quality: MOCK_QUALITY_PASSED,
      writtenObjects: MOCK_WRITTEN_OBJECTS,
    },
  ],
  fatalErrors: [],
};

const MOCK_RUN_REPORT_FAILED: DexBuildRunReport = {
  ...MOCK_RUN_REPORT_COMPLETED,
  status: 'failed',
  pools: [
    {
      ...MOCK_RUN_REPORT_COMPLETED.pools[0]!,
      quality: MOCK_QUALITY_FAILED,
    },
  ],
  fatalErrors: [
    { code: 'POOL_NOT_FOUND', message: 'POOL_NOT_FOUND:unknown-pool', poolId: 'unknown-pool' },
  ],
};

let stdoutCapture: string[] = [];
let stderrCapture: string[] = [];
let exitCode: number | undefined;
const tempDirs: string[] = [];

beforeEach(() => {
  stdoutCapture = [];
  stderrCapture = [];
  exitCode = undefined;

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutCapture.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrCapture.push(String(chunk));
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
    exitCode = typeof code === 'number' ? code : 0;
    throw new Error(`process.exit(${String(code)})`);
  });

  mockResolveSimple.mockResolvedValue({
    ...MOCK_RESOLVED,
    profile: 'simple',
  });
  mockBuild.mockResolvedValue({ runReport: MOCK_RUN_REPORT_COMPLETED, status: 'completed' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeSimpleConfig(body: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'build-command-test-'));
  tempDirs.push(dir);
  const file = join(dir, 'dex-pool.config.json');
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return file;
}

describe('build command', () => {
  it('successful build prints completion message', async () => {
    await expect(
      runBuildCommand({ chain: 'base', pair: 'WETH/USDC', from: '2024-01-01', to: '2024-01-02' }),
    ).rejects.toThrow('process.exit(0)');

    const output = stdoutCapture.join('');
    expect(output).toContain('Dataset build completed');
    expect(output).toContain('✓');
    expect(exitCode).toBe(0);
  });

  it('failed quality prints error indicator', async () => {
    mockBuild.mockResolvedValue({ runReport: MOCK_RUN_REPORT_FAILED, status: 'failed' });

    await expect(
      runBuildCommand({ chain: 'base', pair: 'WETH/USDC', from: '2024-01-01', to: '2024-01-02' }),
    ).rejects.toThrow('process.exit(1)');

    const output = stdoutCapture.join('');
    expect(output).toMatch(/✗|FAILED/);
    expect(exitCode).toBe(1);
  });

  it('--json flag outputs valid JSON matching run report shape', async () => {
    await expect(
      runBuildCommand({ chain: 'base', pair: 'WETH/USDC', from: '2024-01-01', to: '2024-01-02', json: true }),
    ).rejects.toThrow('process.exit(0)');

    const output = stdoutCapture.join('');
    const parsed = JSON.parse(output) as DexBuildRunReport;
    expect(parsed.datasetId).toBe('base-uniswap-v3-weth-usdc-v1');
    expect(parsed.status).toBe('completed');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.pools).toHaveLength(1);
  });

  it('loads --config as simple config and allows CLI overrides', async () => {
    const file = await writeSimpleConfig({
      chain: 'base',
      rpc: 'env:BASE_RPC_URL',
      pair: 'WETH/USDC',
      from: '2024-01-01',
      to: '2024-01-02',
      out: './data/dex-pool-datasets',
    });

    await expect(
      runBuildCommand({ config: file, pool: '0x0000000000000000000000000000000000000001' }),
    ).rejects.toThrow('process.exit(0)');

    expect(mockResolveSimple).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'base',
      pool: '0x0000000000000000000000000000000000000001',
      pair: 'WETH/USDC',
      from: '2024-01-01',
      to: '2024-01-02',
    }));
  });

  it('uses simple CLI mode without --config and treats --pool as a pool address', async () => {
    await expect(
      runBuildCommand({
        chain: 'base',
        pool: '0x0000000000000000000000000000000000000001',
        from: '2024-01-01',
        to: '2024-01-02',
      }),
    ).rejects.toThrow('process.exit(0)');

    expect(mockResolveSimple).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'base',
      pool: '0x0000000000000000000000000000000000000001',
      from: '2024-01-01',
      to: '2024-01-02',
    }));
    expect(mockBuild).toHaveBeenCalledOnce();
  });

  it('passes comma-separated --pairs through simple mode parsing', async () => {
    await expect(
      runBuildCommand({
        chain: 'base',
        pairs: 'WETH/USDC,cbBTC/WETH:3000',
        from: '2024-01-01',
        to: '2024-01-02',
      }),
    ).rejects.toThrow('process.exit(0)');

    expect(mockResolveSimple).toHaveBeenCalledWith(expect.objectContaining({
      pairs: [
        'WETH/USDC',
        'cbBTC/WETH:3000',
      ],
    }));
  });

  it('--json --verbose keeps stdout as clean JSON and disables progress callback', async () => {
    await expect(
      runBuildCommand({
        chain: 'base',
        pair: 'WETH/USDC',
        from: '2024-01-01',
        to: '2024-01-02',
        json: true,
        verbose: true,
      }),
    ).rejects.toThrow('process.exit(0)');

    expect(() => JSON.parse(stdoutCapture.join(''))).not.toThrow();
    expect(mockBuild.mock.calls[0]![1]?.onProgress).toBeUndefined();
  });

  it('simple resolver errors print a resolving error and exit 1', async () => {
    mockResolveSimple.mockRejectedValue(new Error('SIMPLE_RPC_ENV_MISSING:BASE_RPC_URL'));

    await expect(
      runBuildCommand({ chain: 'base', pair: 'WETH/USDC', from: '2024-01-01', to: '2024-01-02' }),
    ).rejects.toThrow('process.exit(1)');

    const errOutput = stderrCapture.join('');
    expect(errOutput).toContain('BASE_RPC_URL');
    expect(exitCode).toBe(1);
  });

});

describe('formatRunReport', () => {
  it('shows "Dataset build completed" for a successful report', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_COMPLETED, false);
    expect(result).toContain('Dataset build completed');
    expect(result).not.toContain('with errors');
  });

  it('shows "Dataset build completed with errors" for a failed report', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_FAILED, false);
    expect(result).toContain('Dataset build completed with errors');
  });

  it('shows dataset ID and output URI', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_COMPLETED, false);
    expect(result).toContain('base-uniswap-v3-weth-usdc-v1');
    expect(result).toContain('local://./data/dex-pool-datasets');
  });

  it('shows profile when present', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_COMPLETED, false);
    expect(result).toContain('Profile: local');
  });

  it('shows pool with ✓ when quality passed', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_COMPLETED, false);
    expect(result).toContain('✓ base-uniswapv3-weth-usdc-500');
    expect(result).toContain('Quality: passed');
  });

  it('shows pool with ✗ and FAILED when quality failed', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_FAILED, false);
    expect(result).toContain('✗ base-uniswapv3-weth-usdc-500');
    expect(result).toContain('FAILED');
    expect(result).toContain('reorgConflicts: 2');
    expect(result).toContain('invalidLogs: 1');
  });

  it('lists fatal errors', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_FAILED, false);
    expect(result).toContain('Fatal errors:');
    expect(result).toContain('[POOL_NOT_FOUND]');
  });

  it('shows written object keys', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_COMPLETED, false);
    expect(result).toContain('WETHUSDC/1m.jsonl');
    expect(result).toContain('WETHUSDC/5m.jsonl');
  });

  it('shows block range in verbose mode', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_COMPLETED, true);
    expect(result).toContain('Block range:');
    expect(result).toContain('12345678');
  });

  it('does not show block range in non-verbose mode', () => {
    const result = formatRunReport(MOCK_RUN_REPORT_COMPLETED, false);
    expect(result).not.toContain('Block range:');
  });
});
