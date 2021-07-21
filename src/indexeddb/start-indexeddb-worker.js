import IndexedDBWorker from './worker.js';

let workerReady = null;

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

    // This is another way to load the worker. It won't be inlined
    // into the script, which might be better for debugging, but makes
    // it more difficult to distribute.
    // let worker = new Worker(new URL('./indexeddb.worker.js', import.meta.url));

    worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

    worker.onmessage = msg => {
      if (msg.data.type === 'worker-ready') {
        onReady();
      }
    };

    return workerReady;
  }
}

// This is called from the main thread to setup a proxy for spawning
// workers. It's necessary for browsers that don't support spawning
// workers from workers (only Safari).
export function supportNestedWorkers(worker) {
  worker.addEventListener('message', e => {
    if (e.data.type === 'spawn-idb-worker') {
      startWorker(e.data.argBuffer, e.data.resultBuffer).then(() => {
        worker.postMessage({ type: 'worker-ready' });
      });
    }
  });
}
