function isWorker() {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    self instanceof WorkerGlobalScope
  );
}

function startWorkerFromMain(argBuffer, resultBuffer, parentWorker) {
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

  import('./indexeddb-main-thread-worker-ef816922.js').then(({ default: IndexedDBWorker }) => {
    let worker = new IndexedDBWorker();
    // listenForPerfData(worker);

    // This is another way to load the worker. It won't be inlined
    // into the script, which might be better for debugging, but makes
    // it more difficult to distribute.
    // let worker = new Worker(new URL('./indexeddb.worker.js', import.meta.url));

    worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

    worker.addEventListener('message', msg => {
      // Forward any messages to the worker that's supposed
      // to be the parent
      parentWorker.postMessage(msg.data);
    });
  });
}

let hasInitialized = false;

function initBackend(worker) {
  if (hasInitialized) {
    return;
  }
  hasInitialized = true;

  worker.addEventListener('message', e => {
    switch (e.data.type) {
      case '__absurd:spawn-idb-worker':
        startWorkerFromMain(e.data.argBuffer, e.data.resultBuffer, worker);
        break;
    }
  });

  // if(true) {
  //   window.__startProfile = () => {
  //   }
  // }
}

export { initBackend };
