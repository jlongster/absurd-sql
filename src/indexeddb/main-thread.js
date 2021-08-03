import IndexedDBWorker from './worker.js';
import { listenForPerfData } from '../perf-frontend';

let workerReady = null;

function isWorker() {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    self instanceof WorkerGlobalScope
  );
}

function startWorkerFromMain(argBuffer, resultBuffer) {
  if (workerReady) {
    return workerReady;
  }

  if (isWorker()) {
    throw new Error(
      '`startWorkerFromMain` should only be called from the main thread'
    );
  }

  if (typeof Worker === 'undefined') {
    // We're on the main thread? Weird: it doesn't have workers
    throw new Error(
      'Web workers not available. sqlite3 requires web workers to work.'
    );
  }

  let onReady;
  workerReady = new Promise(resolve => (onReady = resolve));

  let worker = new IndexedDBWorker();
  listenForPerfData(worker);

  // This is another way to load the worker. It won't be inlined
  // into the script, which might be better for debugging, but makes
  // it more difficult to distribute.
  // let worker = new Worker(new URL('./indexeddb.worker.js', import.meta.url));

  worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

  worker.addEventListener('message', msg => {
    switch (msg.data.type) {
      case 'worker-ready':
        onReady();
        break;
    }
  });

  return workerReady;
}

export function initBackend(worker) {
  listenForPerfData(worker);

  worker.addEventListener('message', e => {
    if (e.data.type === 'spawn-idb-worker') {
      startWorkerFromMain(e.data.argBuffer, e.data.resultBuffer).then(() => {
        worker.postMessage({ type: 'worker-ready' });
      });
    }
  });
}
