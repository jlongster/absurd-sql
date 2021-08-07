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
      }
    }
  });

  for (let input of document.querySelectorAll('input[type=radio]')) {
    input.addEventListener('change', e => {
      let name = e.target.name;
      let value = e.target.value;
      worker.postMessage({ type: 'options', name, value });
    });
  }

  // Make sure all inputs reflect the initial state (browsers try to
  // be smart and keep the state from before)
  document.querySelector('input[name="backend"][value="idb"]').checked = true;
  document.querySelector('input[name="cacheSize"][value="0"]').checked = true;
  document.querySelector('input[name="pageSize"][value="4096"]').checked = true;

  let profile = document.querySelector('input[name="profile"]');
  profile.addEventListener('click', e => {
    worker.postMessage({ type: 'profiling', on: e.target.checked });
  });
  console.log(profile.checked)
  worker.postMessage({ type: 'profiling', on: profile.checked });
}

let methods = ['init', 'populate', 'countAll', 'randomReads', 'deleteFile'];

for (let method of methods) {
  let btn = document.querySelector(`#${method}`);
  if (btn) {
    btn.addEventListener('click', () =>
      worker.postMessage({ type: 'ui-invoke', name: method })
    );
  }
}

init();

window.runQuery = sql => {
  let reqId = Math.random();

  let promise = new Promise(resolve => {
    let handler = e => {
      if (e.data.type === 'query-results' && e.data.id === reqId) {
        worker.removeEventListener('message', handler);
        resolve(e.data.data);
      }
    };
    worker.addEventListener('message', handler);
  });

  worker.postMessage({ type: 'run-query', sql, id: reqId });
  return promise;
};
