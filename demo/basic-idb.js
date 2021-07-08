let worker;

function init() {
  worker = new Worker(new URL('./basic-memory.js', import.meta.url));
  worker.postMessage({ name: 'init' });
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
    btn.addEventListener('click', () => worker.postMessage({ name: method }));
  }
}

init();
