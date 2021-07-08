let worker;

function init() {
  worker = new Worker(new URL('./idb-test.worker.js', import.meta.url));
  worker.postMessage({ type: 'init' });
}

function write() {
  worker.postMessage({ type: 'write' });
}

function read() {
  worker.postMessage({ type: 'read' });
}

document.querySelector('#write').addEventListener('click', write);
document.querySelector('#read').addEventListener('click', read);

init();
