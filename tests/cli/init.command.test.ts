import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInitCommand } from '../../src/cli/commands/init.command.js';

const tempDirs: string[] = [];
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
  vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${String(code)})`);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dex-pool-init-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('init command', () => {
  it('writes a simple config with pair defaults', async () => {
    const dir = await makeTempDir();
    const file = join(dir, 'dex-pool.config.json');

    await runInitCommand({ file, chain: 'base', pair: 'WETH/USDC', force: true });

    const config = JSON.parse(await readFile(file, 'utf8')) as {
      chain: string;
      rpc: string;
      pairs: Array<{ pair: string; fee: number }>;
    };

    expect(config.chain).toBe('base');
    expect(config.rpc).toMatch(/^env:/);
    expect(config.pairs).toEqual([{ pair: 'WETH/USDC', fee: 500 }]);
    expect(stdoutCapture.join('')).toContain(`Created ${file}`);
  });

  it('refuses to overwrite without --force', async () => {
    const dir = await makeTempDir();
    const file = join(dir, 'dex-pool.config.json');

    await runInitCommand({ file, chain: 'base', force: true });

    await expect(runInitCommand({ file, chain: 'base' })).rejects.toThrow('process.exit(1)');
    expect(stderrCapture.join('')).toContain('Config already exists');
  });
});
