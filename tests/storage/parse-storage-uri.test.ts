import { describe, expect, it } from 'vitest';
import { parseStorageUri } from '../../src/storage/parse-storage-uri.js';

describe('parseStorageUri', () => {
  it('parses local:// with a relative path', () => {
    expect(parseStorageUri('local://./foo')).toEqual({ kind: 'local', rootDir: './foo' });
  });

  it('parses local:// with an absolute path', () => {
    expect(parseStorageUri('local:///absolute/path')).toEqual({ kind: 'local', rootDir: '/absolute/path' });
  });

  it('parses s3:// with a multi-segment prefix', () => {
    expect(parseStorageUri('s3://my-bucket/my/prefix')).toEqual({
      kind: 's3',
      bucket: 'my-bucket',
      prefix: 'my/prefix',
    });
  });

  it('parses s3:// with a single-segment prefix', () => {
    expect(parseStorageUri('s3://my-bucket/prefix')).toEqual({
      kind: 's3',
      bucket: 'my-bucket',
      prefix: 'prefix',
    });
  });

  it('throws STORAGE_URI_INVALID_S3 when s3 URI has no slash', () => {
    expect(() => parseStorageUri('s3://no-slash')).toThrow('STORAGE_URI_INVALID_S3');
  });

  it('throws STORAGE_URI_INVALID_S3 when s3 URI has no bucket (leading slash)', () => {
    expect(() => parseStorageUri('s3:///no-bucket')).toThrow('STORAGE_URI_INVALID_S3');
  });

  it('throws STORAGE_URI_UNKNOWN_SCHEME for an unknown scheme', () => {
    expect(() => parseStorageUri('gcs://my-bucket/prefix')).toThrow('STORAGE_URI_UNKNOWN_SCHEME');
  });
});
