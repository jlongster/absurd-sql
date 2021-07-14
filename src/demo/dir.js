import { supportNestedWorkers } from '../start-indexeddb-worker';

let worker;

function init() {
  worker = new Worker(new URL('./dir.worker.js', import.meta.url));
  worker.postMessage({ type: 'init' });

  supportNestedWorkers(worker);
}

// document.querySelector('#write').addEventListener('click', write);
// document.querySelector('#read').addEventListener('click', read);

init();
