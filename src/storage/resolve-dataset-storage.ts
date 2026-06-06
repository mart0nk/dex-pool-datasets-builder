import type { DatasetStorage } from './dataset-storage.types.js';
import { LocalDatasetStorage } from './local-dataset-storage.js';
import { parseStorageUri } from './parse-storage-uri.js';

export function resolveDatasetStorage(uri: string): DatasetStorage {
  const parsed = parseStorageUri(uri);
  if (parsed.kind === 'local') {
    return new LocalDatasetStorage(parsed.rootDir);
  }
  throw new Error(`STORAGE_KIND_NOT_SUPPORTED:${parsed.kind}`);
  // S3 added in PR 5
}
