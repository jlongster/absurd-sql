import IndexedDBWorker from './worker.js';
import * as Plot from '@observablehq/plot';

let workerReady = null;

function isWorker() {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    self instanceof WorkerGlobalScope
  );
}

function percentile(data, p) {
  let sorted = [...data];
  sorted.sort((n1, n2) => n1.y - n2.y);
  return sorted.slice(0, Math.ceil(sorted.length * p) | 0);
}

function percentilePoint(data, p) {
  let result = percentile(data, p);
  return result[result.length - 1];
}

function fixed(num, places) {
  let factor = Math.pow(10, places);
  let clipped = (num * factor) | 0;
  return clipped / factor;
}

function makeDataPoint(label, value) {
  let p = document.createElement('div');
  p.innerHTML = `<strong>${label}</strong> ${value}`;
  p.style.marginRight = '10px';
  p.style.border = '1px solid #C3D0FF';
  p.style.borderRadius = '6px';
  p.style.padding = '1px 5px';
  return p;
}

let loggedResults = [];
let cleanupTimer;

function clearPerfResults() {
  let m = document.querySelector('.perf-results .ready');
  if (m) {
    m.style.display = 'none';
  }
  loggedResults = [];
}

function appendPerfResults(name, data) {
  // We track which data has been output, and after a certain time
  // assue things have settled and remove any stale data. We do this
  // instead of clearing everything when a new recording starts so
  // that it keeps the current state (like scroll position) which is
  // nice if you are watching and graph and wanting to compare it
  // across runs
  loggedResults.push(name);
  clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    for (let el of document.querySelectorAll('.data')) {
      if (!loggedResults.includes(el.dataset.dataName)) {
        el.remove();
      }
    }
  }, 500);

  let c = document.querySelector('.perf-results');
  if (!c) {
    c = document.createElement('div');
    c.className = 'perf-results';
    c.style.maxHeight = 'calc(100vh - 10px)';
    c.style.padding = '15px';
    c.style.margin = '5px';
    c.style.boxSizing = 'border-box';
    c.style.position = 'fixed';
    c.style.top = 0;
    c.style.right = 0;
    c.style.display = 'flex';
    c.style.flexDirection = 'column';
    c.style.alignItems = 'flex-end';
    c.style.backgroundColor = '#E3F0FF';

    let btnDiv = document.createElement('div');
    let msg = document.createElement('span');
    msg.className = 'ready';
    msg.textContent = 'Perf results are ready!';
    msg.style.marginRight = '15px';
    btnDiv.appendChild(msg);

    let btn = document.createElement('button');
    btn.textContent = 'open';

    btn.addEventListener('click', e => {
      let r = document.querySelector('.perf-results .results');
      if (r.style.display === 'none') {
        r.style.display = 'flex';
        e.target.textContent = 'close';
      } else {
        r.style.display = 'none';
        e.target.textContent = 'open';
      }
    });

    btnDiv.appendChild(btn);
    c.appendChild(btnDiv);

    document.body.appendChild(c);
  }

  let r = c.querySelector('.results');
  if (!r) {
    let rc = document.createElement('div');
    rc.style.overflow = 'auto';

    r = document.createElement('div');
    r.className = 'results';
    r.style.display = 'none';
    r.style.flex = '1';
    r.style.flexDirection = 'column';

    rc.appendChild(r);
    c.appendChild(rc);
  }

  let m = document.querySelector('.perf-results .ready');
  m.style.display = 'inline';

  let svgCont = document.createElement('div');
  svgCont.className = 'data ' + name;
  svgCont.dataset.dataName = name;
  svgCont.style.marginTop = '15px';

  let text = document.createElement('div');
  text.style.font = '13px system-ui, sans-serif';
  text.style.display = 'flex';
  text.style.justifyContent = 'space-between';

  let label = document.createElement('div');
  label.textContent = name;
  text.appendChild(label);

  let spacer = document.createElement('div');
  spacer.style.flex = '1';
  text.appendChild(spacer);

  text.appendChild(
    makeDataPoint('total', fixed(data.reduce((t, n) => t + n.y, 0), 3))
  );
  text.appendChild(makeDataPoint('count', data.length));
  text.appendChild(
    makeDataPoint('p50', fixed(percentilePoint(data, 0.5).y, 3))
  );
  text.appendChild(
    makeDataPoint('p95', fixed(percentilePoint(data, 0.95).y, 3))
  );

  svgCont.appendChild(text);

  let svg = Plot.plot({
    y: { grid: true, label: 'took (ms)', labelOffset: 40, inset: 10 },
    x: { grid: true, label: 'run time (ms)', labelOffset: 40 },
    marginTop: 30,
    marginLeft: 50,
    marginRight: 30,
    marginBottom: 50,
    marks: [
      Plot.dot(percentile(data, 0.95), {
        x: 'x',
        y: 'y',
        r: 2,
        fill: '#1271BF',
        fillOpacity: Math.max(1 - Math.min(data.length / 500, 0.8), 0.1)
      })
    ]
  });
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('version', '1.1');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.font = '13px system-ui, sans-serif';
  svg.style.backgroundColor = 'white';
  svg.style.marginTop = '5px';

  let scale = 1.5;
  svg.setAttribute('width', 640 * (scale / 2));
  svg.setAttribute('height', 400 * (scale / 2));

  svgCont.appendChild(svg);

  let existing = r.querySelector('.data.' + name);
  console.log(name, existing);
  if (existing) {
    existing.parentNode.replaceChild(svgCont, existing);
  } else {
    r.appendChild(svgCont);
  }
}

function listenForPerfData(worker) {
  worker.addEventListener('message', msg => {
    switch (msg.data.type) {
      case 'clear-perf': {
        clearPerfResults();
        break;
      }
      case 'log-perf': {
        appendPerfResults(msg.data.name, msg.data.data);
        break;
      }
    }
  });
}

function startWorkerFromMain(argBuffer, resultBuffer) {
  if (workerReady) {
    return workerReady;
  }

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

  let onReady;
  workerReady = new Promise(resolve => (onReady = resolve));

  let worker = new IndexedDBWorker();

  // This is another way to load the worker. It won't be inlined
  // into the script, which might be better for debugging, but makes
  // it more difficult to distribute.
  // let worker = new Worker(new URL('./indexeddb.worker.js', import.meta.url));

  worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

  worker.addEventListener('message', msg => {
    switch (msg.data.type) {
      case 'worker-ready':
        onReady();
        break;
    }
  });

  listenForPerfData(worker);

  return workerReady;
}

export function initBackend(worker) {
  listenForPerfData(worker);

  worker.addEventListener('message', e => {
    if (e.data.type === 'spawn-idb-worker') {
      startWorkerFromMain(e.data.argBuffer, e.data.resultBuffer).then(() => {
        worker.postMessage({ type: 'worker-ready' });
      });
    }
  });
}
