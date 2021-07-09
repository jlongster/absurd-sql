import initSqlJs from 'sql.js/dist/sql-wasm-debug';
import BlockedFS from '../blockedfs';
import * as uuid from 'uuid';
import MemoryBackend from '../backend-memory';
import IndexedDBBackend from '../backend-indexeddb';

function randomBuffer(size) {
  let buffer = new ArrayBuffer(size);
  let view = new Uint8Array(buffer);
  for (let i = 0; i < size; i++) {
    view[i] = (Math.random() * 255) | 0;
  }
  return buffer;
}

// let backend = new MemoryBackend(4096, {});
let backend = new IndexedDBBackend(4096);

let SQL = null;
async function init() {
  if (SQL == null) {
    SQL = await initSqlJs({ locateFile: file => file });
    SQL._register_for_idb();

    let BFS = new BlockedFS(SQL.FS, backend);
    await BFS.init();

    SQL.FS.mkdir('/tmp/blocked');
    SQL.FS.mount(BFS, {}, '/tmp/blocked');

    SQL.FS.create('/tmp/blocked/db3.sqlite', SQL.FS.getMode(true, true));
    SQL.FS.create(
      '/tmp/blocked/db3.sqlite-journal',
      SQL.FS.getMode(true, true)
    );
  }
}

let _db1 = null;
let _db2 = null;
async function getDatabase1() {
  console.log('1');
  await init();
  console.log('2');
  if (_db1 == null) {
    console.log('creating');
    _db1 = new SQL.CustomDatabase('/tmp/blocked/db3.sqlite');
    console.log('creating (done)');
  }
  console.log('3');
  return _db1;
}
async function getDatabase2() {
  await init();
  if (_db2 == null) {
    _db2 = new SQL.CustomDatabase('/tmp/blocked/db3.sqlite');
  }
  return _db2;
}

let count = 500;

async function populate1() {
  let db = await getDatabase1();
  console.log('dddbbb');
  db.exec(`
    -- PRAGMA cache_size=0;
    PRAGMA journal_mode=MEMORY;
    -- PRAGMA locking_mode=EXCLUSIVE;
  `);

  console.log('1 ---------------------');

  db.exec(`
    BEGIN TRANSACTION;
    DROP TABLE IF EXISTS kv;
    CREATE TABLE kv (key TEXT, value TEXT);
    COMMIT;
  `);

  console.log('2 ---------------------');

  console.log('writing');
  let start = Date.now();
  db.exec('BEGIN TRANSACTION');
  let stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
  for (let i = 0; i < 1100000; i++) {
    stmt.run([uuid.v4(), ((Math.random() * 100000) | 0).toString()]);
  }
  db.exec('COMMIT');
  console.log('Done!', Date.now() - start);

  // let file = backend.getFile('db3.sqlite');

  // console.log(
  //   'done',
  //   (file.meta.size / 1024).toFixed(2) + 'KB',
  //   file.meta.size / backend.defaultBlockSize + ' blocks'
  // );
}

async function populate2() {
  let db = await getDatabase2();

  db.exec('BEGIN TRANSACTION');
  try {
    let stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
    console.log('x3');
    for (let i = 0; i < 3000; i++) {
      stmt.run([uuid.v4(), ((Math.random() * 100000) | 0).toString()]);
      console.log('x', i);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

async function commit1() {
  let db = await getDatabase1();
  db.prepare('COMMIT').run();
}

async function run() {
  console.log('running...');
  let db = await getDatabase1();
  console.log('got database222', Math.random());
  // let off = (Math.random() * count) | 0;
  let off = 0;

  let start = Date.now();

  let stmt = db.prepare(`SELECT COUNT(*) FROM kv`);
  while (stmt.step()) {
    let row = stmt.getAsObject();
    if (typeof document !== 'undefined') {
      let output = document.querySelector('#output');
      let div = document.createElement('div');
      div.textContent = JSON.stringify(row);
      output.appendChild(div);
    } else {
      console.log(row);
    }
  }
  stmt.free();

  console.log('Done reading', Date.now() - start);
}

async function vacuum() {
  let db = await getDatabase1();
  db.exec(`VACUUM`);

  let stmt = db.prepare(`PRAGMA page_size`);
  stmt.step();

  if (typeof document !== 'undefined') {
    let output = document.querySelector('#output');
    output.innerHTML = JSON.stringify(stmt.getAsObject());
  } else {
    console.log(JSON.stringify(stmt.getAsObject()));
  }

  stmt.free();
}

async function size() {
  // output.innerHTML = '';
  let db = await getDatabase1();
  let page_size = 1024;
  db.exec(`PRAGMA page_size=${page_size}`);
  // output.innerHTML = `set page_size to ${page_size}`;
}

let methods = {
  init,
  populate1,
  populate2,
  commit1,
  run,
  vacuum,
  size
};

if (typeof self !== 'undefined') {
  console.log('WORKER');
  self.onmessage = msg => {
    if (msg.data.type === 'ui-invoke') {
      if (methods[msg.data.name] == null) {
        throw new Error('Unknown method: ' + msg.data.name);
      }
      console.log(msg.data.name);
      methods[msg.data.name]();
    }
  };
} else {
  for (let method of Object.keys(methods)) {
    let btn = document.querySelector(`#${method}`);
    if (btn) {
      btn.addEventListener('click', methods[method]);
    }
  }
  init();
}
