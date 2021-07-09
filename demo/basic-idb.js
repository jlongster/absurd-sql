import { supportNestedWorkers } from '../start-indexeddb-worker';

let worker;

function init() {
  worker = new Worker(new URL('./basic-memory.js', import.meta.url));
  worker.postMessage({ type: 'ui-invoke', name: 'init' });

  supportNestedWorkers(worker);
}

let methods = [
  'init',
  'populate1',
  'populate2',
  'commit1',
  'run',
  'vacuum',
  'size'
];

for (let method of methods) {
  let btn = document.querySelector(`#${method}`);
  if (btn) {
    btn.addEventListener('click', () =>
      worker.postMessage({ type: 'ui-invoke', name: method })
    );
  }
}

init();
