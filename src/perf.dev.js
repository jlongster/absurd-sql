let buffer = 40000;
let baseTime;
let timings = {};

const descriptions = {
  get: 'Calls to `store.get`',
  'stream-next': 'Advancing a cursor',
  stream: 'Opening a cursor',
  read: 'Full process for reading a block'
};

function last(arr) {
  return arr.length === 0 ? null : arr[arr.length - 1];
}

let showWarning = true;

async function writeData(name, data) {
  self.postMessage({ type: 'log-perf', name, data });

  // console.log(`--- ${sheetName} (${descriptions[sheetName]}) ---`);
  // console.log(`Count: ${data.length}`);
  // console.log(`p50: ${last(percentile(data, 0.5))[1]}`);
  // console.log(`p95: ${last(percentile(data, 0.95))[1]}`);
}

export async function end() {
  await Promise.all(
    Object.keys(timings).map(name => {
      let timing = timings[name];
      return writeData(
        name,
        timing.data.map(x => ({ x: x.start + x.took, y: x.took }))
      );
    })
  );
}

export function start() {
  self.postMessage({ type: 'clear-perf' });

  timings = {};
  baseTime = performance.now();
}

export function record(name) {
  if (timings[name] == null) {
    timings[name] = { start: null, data: [] };
  }
  let timer = timings[name];

  if (timer.start != null) {
    throw new Error(`timer already started ${name}`);
  }
  timer.start = performance.now();
}

export function endRecording(name) {
  let now = performance.now();
  let timer = timings[name];

  if (timer && timer.start != null) {
    let took = now - timer.start;
    let start = timer.start - baseTime;
    timer.start = null;

    if (timer.data.length < buffer) {
      timer.data.push({ start, took });
    }
  }
}
