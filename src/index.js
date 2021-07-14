import BlockedFS from './blockedfs';
import MemoryBackend from './backend-memory';
import IndexedDBBackend from './backend-indexeddb';
import { supportNestedWorkers } from './start-indexeddb-worker';

export default {
  BlockedFS,
  MemoryBackend,
  IndexedDBBackend,
  supportNestedWorkers
};
