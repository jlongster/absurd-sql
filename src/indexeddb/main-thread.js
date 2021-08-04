import { makeInitBackend } from '../main-thread-module';

// Use the generic main thread module to create our indexeddb worker
// proxy
export const initBackend = makeInitBackend('__absurd:spawn-idb-worker', () =>
  import('./worker.js')
);
