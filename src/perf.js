import { detect } from 'detect-browser';

const browser = detect();

let token =
  'ya29.a0ARrdaM-_xk7Cr1YHQYTGXZ832ixgEK_yeY7jMweC30zPOCPJJzH2FK-YBuowimaJy_hJ7IxeMtHCxtueTvh9WzEfWcsHAg9jzvGrdOVJtfol62YSTis-qRIBBli40_p4Ofg1L7OfENO3fImOf5ecLWaYGU8_';
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

async function writeData(sheetName, arr) {
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
  console.log(
    `Logged timings to spreadsheet (${sheetName}))`,
    await res.text()
  );
}

export async function end() {
  await Promise.all(
    Object.keys(timings).map(name => {
      let timing = timings[name];
      return writeData(name, timing.data.map(x => [x.start, x.took]));
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
    throw new Error('timer already started');
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
