import { initBackend } from '../../indexeddb/main-thread';
import { listenForPerfData } from 'perf-deets/frontend';

let worker;

function init() {
  worker = new Worker(new URL('./main.worker.js', import.meta.url));
  initBackend(worker);
  listenForPerfData(worker);

  worker.postMessage({ type: 'ui-invoke', name: 'init' });

  let output = document.querySelector('.output');
  worker.addEventListener('message', e => {
    switch (e.data.type) {
      case 'output': {
        let el = document.createElement('div');
        el.innerHTML = e.data.msg;
        output.append(el);
        output.scrollTop = 100000;
        break;
      }
      case 'results': {
        output.innerHTML = '';
        for (let result of e.data.results) {
          let el = document.createElement('div');
          el.innerHTML = `<div style="margin-bottom: 5px"><a href="${result.url}">${result.title}</a></div> ${result.content}`;
          el.className = 'comment';
          output.append(el);
        }
        break;
      }
      case 'count': {
        document.querySelector('.count').textContent = e.data.count;
        document.querySelector('#load').textContent = 'Load data';
      }
    }
  });

  document.querySelector('.search').addEventListener('input', e => {
    worker.postMessage({ type: 'search', name: e.target.value });
  });

  worker.postMessage({ type: 'ui-invoke', name: 'count' });
}

let methods = ['load'];

for (let method of methods) {
  let btn = document.querySelector(`#${method}`);
  if (btn) {
    btn.addEventListener('click', () => {
      if(method === 'load') {
        document.querySelector('#load').textContent = 'Loading...';
      }
      worker.postMessage({ type: 'ui-invoke', name: method });
    });
  }
}

init();
