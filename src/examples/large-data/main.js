import { supportNestedWorkers } from '../..';

let worker;

function init() {
  worker = new Worker(new URL('./main.worker.js', import.meta.url));
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

  supportNestedWorkers(worker);
}

let methods = ['init', 'populate', 'countAll', 'randomReads'];

for (let method of methods) {
  let btn = document.querySelector(`#${method}`);
  if (btn) {
    btn.addEventListener('click', () =>
      worker.postMessage({ type: 'ui-invoke', name: method })
    );
  }
}

init();
