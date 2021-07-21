import { detect } from 'detect-browser';

const browser = detect();

let token = '';
let sheetId = '1p1isUZkWe8oc12LL0kqaT3UFT_MR8vEoEieEruHW-xE';

let buffer = 40000;
let baseTime;
let timings = {};

let range;
if (browser.name === 'chrome') {
  range = 'A3';
} else if (browser.name === 'safari') {
  range = 'D3';
} else if (browser.name === 'firefox') {
  range = 'G3';
} else {
  throw new Error('Unknown browser: ' + browser.name);
}

const descriptions = {
  get: 'Calls to `store.get`',
  'stream-next': 'Advancing a cursor',
  stream: 'Opening a cursor',
  read: 'Full process for reading a block'
};

function last(arr) {
  return arr.length === 0 ? null : arr[arr.length - 1];
}

function percentile(data, p) {
  let sorted = [...data];
  sorted.sort((n1, n2) => n1[1] - n2[1]);
  return sorted.slice(0, Math.ceil(sorted.length * p) | 0);
}

let showWarning = true;

async function writeData(sheetName, data) {
  let arr = percentile(data, 0.95);

  if (arr.length > buffer) {
    arr = arr.slice(-buffer);
  } else {
    while (arr.length < buffer) {
      arr.push(['', '']);
    }
  }

  let res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ values: arr })
    }
  );
  if (res.status == 200) {
    console.log(`Logged timings to spreadsheet (${sheetName}))`);
  } else {
    if (showWarning) {
      showWarning = false;
      console.warn(
        'Unable to log perf data to spreadsheet. Is the OAuth token expired?'
      );
    }

    console.log(`--- ${sheetName} (${descriptions[sheetName]}) ---`);
    console.log(`Count: ${data.length}`);
    console.log(`p50: ${last(percentile(data, 0.5))[1]}`);
    console.log(`p95: ${last(percentile(data, 0.95))[1]}`);
  }
}

export async function end() {
  await Promise.all(
    Object.keys(timings).map(name => {
      let timing = timings[name];
      return writeData(name, timing.data.map(x => [x.start + x.took, x.took]));
    })
  );
}

export function start() {
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
