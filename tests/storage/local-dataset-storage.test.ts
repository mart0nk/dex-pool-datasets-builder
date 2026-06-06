import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatasetStorage } from '../../src/storage/local-dataset-storage.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'local-storage-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('LocalDatasetStorage', () => {
  it('writeObject creates the file at rootDir/key with the given body', async () => {
    const rootDir = await makeTempDir();
    const storage = new LocalDatasetStorage(rootDir);

    const result = await storage.writeObject({ key: 'data.json', body: '{"hello":"world"}' });

    expect(result.key).toBe('data.json');
    expect(result.uri).toMatch(/^local:\/\//);
    expect(result.uri).toContain('data.json');
  });

  it('writeObject creates parent directories recursively', async () => {
    const rootDir = await makeTempDir();
    const storage = new LocalDatasetStorage(rootDir);

    const result = await storage.writeObject({
      key: 'nested/deep/path/file.jsonl',
      body: 'line1\nline2\n',
    });

    expect(result.key).toBe('nested/deep/path/file.jsonl');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('writeObject returns correct key, uri starting with local://, and sizeBytes for string body', async () => {
    const rootDir = await makeTempDir();
    const storage = new LocalDatasetStorage(rootDir);
    const body = 'hello world';

    const result = await storage.writeObject({ key: 'test.txt', body });

    expect(result.key).toBe('test.txt');
    expect(result.uri.startsWith('local://')).toBe(true);
    expect(result.sizeBytes).toBe(Buffer.byteLength(body, 'utf8'));
  });

  it('writeObject returns correct sizeBytes for Uint8Array body', async () => {
    const rootDir = await makeTempDir();
    const storage = new LocalDatasetStorage(rootDir);
    const body = new Uint8Array([1, 2, 3, 4, 5]);

    const result = await storage.writeObject({ key: 'binary.bin', body });

    expect(result.sizeBytes).toBe(5);
  });

  it('readObject reads back what was written', async () => {
    const rootDir = await makeTempDir();
    const storage = new LocalDatasetStorage(rootDir);
    const body = 'the content of the file';

    await storage.writeObject({ key: 'file.txt', body });
    const read = await storage.readObject('file.txt');

    expect(Buffer.from(read).toString('utf8')).toBe(body);
  });

  it('exists returns true for a written key', async () => {
    const rootDir = await makeTempDir();
    const storage = new LocalDatasetStorage(rootDir);

    await storage.writeObject({ key: 'present.txt', body: 'data' });

    expect(await storage.exists('present.txt')).toBe(true);
  });

  it('exists returns false for a missing key', async () => {
    const rootDir = await makeTempDir();
    const storage = new LocalDatasetStorage(rootDir);

    expect(await storage.exists('not-there.txt')).toBe(false);
  });
});
