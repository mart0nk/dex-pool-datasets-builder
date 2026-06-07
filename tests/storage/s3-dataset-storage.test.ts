import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3DatasetStorage } from '../../src/storage/s3-dataset-storage.js';
import { resolveDatasetStorage } from '../../src/storage/resolve-dataset-storage.js';

function makeMockClient(): { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn() };
}

describe('S3DatasetStorage', () => {
  describe('writeObject', () => {
    it('sends PutObjectCommand with correct Bucket, Key, and Body (string converted to Buffer)', async () => {
      const mockSend = vi.fn().mockResolvedValue({ ETag: '"abc123"', VersionId: 'v1' });
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'my/prefix');

      const result = await storage.writeObject({
        key: 'myfile.json',
        body: '{"data":1}',
        contentType: 'application/json',
      });

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Key: 'my/prefix/myfile.json',
        Body: Buffer.from('{"data":1}', 'utf8'),
        ContentType: 'application/json',
        Metadata: undefined,
      });
      expect(result.key).toBe('my/prefix/myfile.json');
      expect(result.uri).toBe('s3://my-bucket/my/prefix/myfile.json');
      expect(result.etag).toBe('"abc123"');
      expect(result.versionId).toBe('v1');
    });

    it('sends PutObjectCommand with Uint8Array body directly', async () => {
      const mockSend = vi.fn().mockResolvedValue({ ETag: '"def456"' });
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'prefix');
      const body = new Uint8Array([10, 20, 30]);

      await storage.writeObject({ key: 'binary.bin', body });

      const [[cmd]] = (PutObjectCommand as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(-1);
      expect(cmd.Body).toBeInstanceOf(Uint8Array);
    });

    it('normalizes prefix with trailing slash', async () => {
      const mockSend = vi.fn().mockResolvedValue({ ETag: '"xyz"' });
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'my/prefix/');

      const result = await storage.writeObject({ key: 'dataset/manifest.json', body: '{}' });

      expect(result.key).toBe('my/prefix/dataset/manifest.json');
      expect(result.uri).toBe('s3://my-bucket/my/prefix/dataset/manifest.json');
    });

    it('normalizes key with leading slash', async () => {
      const mockSend = vi.fn().mockResolvedValue({ ETag: '"xyz"' });
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'my/prefix');

      const result = await storage.writeObject({ key: '/dataset/manifest.json', body: '{}' });

      expect(result.key).toBe('my/prefix/dataset/manifest.json');
    });
  });

  describe('exists', () => {
    it('returns true when HeadObjectCommand succeeds', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'prefix');

      const result = await storage.exists('some/key.json');

      expect(result).toBe(true);
    });

    it('returns false for NoSuchKey error', async () => {
      const notFoundError = Object.assign(new Error('Not found'), { name: 'NoSuchKey' });
      const mockSend = vi.fn().mockRejectedValue(notFoundError);
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'prefix');

      const result = await storage.exists('missing/key.json');

      expect(result).toBe(false);
    });

    it('throws for non-404 errors', async () => {
      const genericError = new Error('Network failure');
      const mockSend = vi.fn().mockRejectedValue(genericError);
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'prefix');

      await expect(storage.exists('some/key.json')).rejects.toThrow('Network failure');
    });
  });

  describe('readObject', () => {
    it('returns Uint8Array from Body.transformToByteArray()', async () => {
      const expected = new Uint8Array([1, 2, 3]);
      const mockSend = vi.fn().mockResolvedValue({
        Body: { transformToByteArray: vi.fn().mockResolvedValue(expected) },
      });
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'prefix');

      const result = await storage.readObject('some/key.json');

      expect(result).toEqual(expected);
    });

    it('throws S3_OBJECT_EMPTY when Body is undefined', async () => {
      const mockSend = vi.fn().mockResolvedValue({ Body: undefined });
      const client = { send: mockSend } as unknown as InstanceType<typeof S3Client>;
      const storage = new S3DatasetStorage(client, 'my-bucket', 'prefix');

      await expect(storage.readObject('empty/key.json')).rejects.toThrow('S3_OBJECT_EMPTY');
    });
  });
});

describe('resolveDatasetStorage', () => {
  it('returns S3DatasetStorage for s3:// URIs', () => {
    const storage = resolveDatasetStorage('s3://my-bucket/my/prefix');

    expect(storage).toBeInstanceOf(S3DatasetStorage);
    expect(storage.kind).toBe('s3');
    expect(S3Client).toHaveBeenCalledWith({});
  });
});
