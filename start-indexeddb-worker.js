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

  if (typeof Worker === 'undefined' || isWorker()) {
    // No `Worker` available - this context does not support nested
    // workers sadly. We need to proxy creating a worker to the main
    // thread.
    if (!isWorker()) {
      // We're on the main thread? Weird: it doesn't have workers
      throw new Error(
        'Web workers not available, even from the main thread. sqlite3 requires web workers to work.'
      );
    }

    self.postMessage({ type: 'spawn-idb-worker', argBuffer, resultBuffer });

    self.addEventListener('message', e => {
      if (e.data.type === 'worker-ready') {
        onReady();
      }
    });
  } else {
    console.log('STARTING WORKER');
    let worker = new Worker(new URL('indexeddb-worker.js', import.meta.url));
    windowWorker = worker;
    worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

    worker.onmessage = msg => {
      if (msg.data.type === 'worker-ready') {
        onReady();
      }
    };

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

// if (!isWorker()) {
//   window.addEventListener('beforeunload', function(event) {
//     windowWorker.postMessage({ type: 'abort' });
//   });
// }
