// The reason for this strange abstraction is because we can't rely on
// nested worker support (Safari doesn't support it). We need to proxy
// creating a child worker through the main thread, and this requires
// a bit of glue code. We don't want to duplicate this code in each
// backend that needs it, so this module abstracts it out. It has to
// have a strange shape because we don't want to eagerly bundle the
// backend code, so users of this code need to pass an `() =>
// import('worker.js')` expression to get the worker module to run.

function isWorker() {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    self instanceof WorkerGlobalScope
  );
}

function makeStartWorkerFromMain(getModule) {
  return (argBuffer, resultBuffer, parentWorker) => {
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

    getModule().then(({ default: BackendWorker }) => {
      let worker = new BackendWorker();

      worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

      worker.addEventListener('message', msg => {
        // Forward any messages to the worker that's supposed
        // to be the parent
        parentWorker.postMessage(msg.data);
      });
    });
  };
}

export function makeInitBackend(spawnEventName, getModule) {
  const startWorkerFromMain = makeStartWorkerFromMain(getModule);

  return worker => {
    worker.addEventListener('message', e => {
      switch (e.data.type) {
        case spawnEventName:
          startWorkerFromMain(e.data.argBuffer, e.data.resultBuffer, worker);
          break;
      }
    });
  };
}
