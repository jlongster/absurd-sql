import IndexedDBWorker from './indexeddb.worker.js';

let workerReady = null;
let windowWorker;

function isWorker() {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    self instanceof WorkerGlobalScope
  );
}

export function startWorker(argBuffer, resultBuffer) {
  if (workerReady) {
    return workerReady;
  }

  let onReady;
  workerReady = new Promise(resolve => (onReady = resolve));

  console.log('running');

  if (typeof Worker === 'undefined') {
    // No `Worker` available - this context does not support nested
    // workers sadly. We need to proxy creating a worker to the main
    // thread.
    if (!isWorker()) {
      // We're on the main thread? Weird: it doesn't have workers
      throw new Error(
        'Web workers not available, even from the main thread. sqlite3 requires web workers to work.'
      );
    }

    self.postMessage({
      type: 'spawn-idb-worker',
      argBuffer,
      resultBuffer
    });

    self.addEventListener('message', e => {
      if (e.data.type === 'worker-ready') {
        onReady();
      }
    });
  } else {
    let worker = new IndexedDBWorker();
    windowWorker = worker;

    console.log('posting message');
    worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

    worker.onmessage = msg => {
      if (msg.data.type === 'worker-ready') {
        onReady();
      }
    };

    console.log('waiting to be ready');
    return workerReady;
  }
}

// This is called from the main thread
export function supportNestedWorkers(worker) {
  worker.addEventListener('message', e => {
    if (e.data.type === 'spawn-idb-worker') {
      startWorker(e.data.argBuffer, e.data.resultBuffer).then(() => {
        worker.postMessage({ type: 'worker-ready' });
      });
    }
  });
}
