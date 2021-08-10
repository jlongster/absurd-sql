import { initBackend } from '../../indexeddb/main-thread';
import { listenForPerfData } from 'perf-deets/frontend';

let worker;

function fixed(num, places) {
  let factor = Math.pow(10, places);
  let clipped = (num * factor) | 0;
  return clipped / factor;
}

function output(msg) {
  let outputEl = document.querySelector('.output');
  let el = document.createElement('div');
  el.innerHTML = msg;
  outputEl.append(el);
  outputEl.scrollTop = 100000;
}

function clearTimings() {
  document.querySelector('.timings-data').innerHTML = '';
}

function outputTiming(timing) {
  let div = document.createElement('div');
  div.textContent = fixed(timing, 2).toString();
  document.querySelector('.timings-data').appendChild(div);
}

function init() {
  worker = new Worker(new URL('./main.worker.js', import.meta.url));
  initBackend(worker);
  listenForPerfData(worker);

  worker.postMessage({ type: 'ui-invoke', name: 'init' });

  worker.addEventListener('message', e => {
    switch (e.data.type) {
      case 'output': {
        output(e.data.msg);
        break;
      }
      case 'clearTimings': {
        clearTimings();
        break;
      }
      case 'outputTiming': {
        outputTiming(e.data.timing);
        break;
      }
    }
  });

  let more = document.querySelector('.more');
  let moreText = document.querySelector('.more-text');
  moreText.addEventListener('click', () => {
    moreText.style.display = 'none';
    more.style.display = 'inline';
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
  worker.postMessage({ type: 'profiling', on: profile.checked });

  let rawIDB = document.querySelector('input[name="raw-indexeddb"]');
  rawIDB.addEventListener('click', e => {
    document.querySelector('.disable-if-raw-idb').style.opacity = e.target
      .checked
      ? 0.3
      : 1;
    worker.postMessage({
      type: 'options',
      name: 'raw-idb',
      on: e.target.checked
    });
  });
  worker.postMessage({
    type: 'options',
    name: 'raw-idb',
    on: rawIDB.checked
  });
}

let methods = [
  'init',
  'populateSmall',
  'populateLarge',
  'sumAll',
  'randomReads',
  'deleteFile',
  'readBench',
  'writeBench'
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
