import initSqlJs from 'sql.js/dist/sql-wasm-debug.js';
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

let pageSize = 4096;
// let backend = new MemoryBackend(pageSize, {});
let backend = new IndexedDBBackend(pageSize);
let dbName = 'db19.sqlite';

let SQL = null;
async function init() {
  if (SQL == null) {
    SQL = await initSqlJs({ locateFile: file => file });

    let BFS = new BlockedFS(SQL.FS, backend);
    SQL.register_for_idb(BFS);

    await BFS.init();

    SQL.FS.mkdir('/blocked');
    SQL.FS.mount(BFS, {}, '/blocked');
  }
}

let _db1 = null;
let _db2 = null;
async function getDatabase1() {
  await init();
  if (_db1 == null) {
    _db1 = new SQL.CustomDatabase(`/blocked/${dbName}`);
  }
  return _db1;
}

let count = 500;

async function populate1() {
  let db = await getDatabase1();
  console.log(pageSize);
  db.exec(`
    -- PRAGMA cache_size=0;
    PRAGMA journal_mode=MEMORY;
    -- PRAGMA locking_mode=EXCLUSIVE;
    PRAGMA page_size=${pageSize};
  `);

  db.exec(`VACUUM`);

  console.log(pageSize, db.exec(`PRAGMA page_size`)[0]);

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
  for (let i = 0; i < 1000000; i++) {
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
  let db = await getDatabase1();

  db.exec(`
    PRAGMA journal_mode=MEMORY;
    PRAGMA page_size=${pageSize};
  `);

  db.exec('BEGIN TRANSACTION');
  console.log('trans----');
  try {
    let stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
    for (let i = 0; i < 2; i++) {
      stmt.run([uuid.v4(), ((Math.random() * 100000) | 0).toString()]);
      console.log('x', i);
    }

    console.log('reading----');
    let stmt2 = db.prepare(`SELECT key FROM kv LIMIT 1 OFFSET 100`);
    stmt2.step();
    console.log(stmt2.getAsObject());
    stmt2.free();
    console.log('done----');

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log('done insert');
}

async function commit1() {
  let db = await getDatabase1();
  db.prepare('COMMIT').run();
}

async function run() {
  console.log('running');
  let FS = SQL.FS;
  let db = await getDatabase1();
  // let off = (Math.random() * count) | 0;
  let off = 0;

  let { node } = FS.lookupPath(`/blocked/${dbName}`);
  let file = node.contents;

  db.exec(`
    PRAGMA cache_size=0;
    PRAGMA journal_mode=MEMORY;
    --PRAGMA page_size=${pageSize};
  `);

  console.log('STATS (start)', file.ops.startStats());

  let start = Date.now();
  for (let i = 0; i < 10; i++) {
    console.log(i);
    let off = i * 10000;

    let stmt = db.prepare(`SELECT key FROM kv LIMIT 500 OFFSET ${off}`);
    while (stmt.step()) {
      let row = stmt.getAsObject();
      if (typeof document !== 'undefined') {
        let output = document.querySelector('#output');
        let div = document.createElement('div');
        div.textContent = JSON.stringify(row);
        output.appendChild(div);
      } else {
        // console.log(row);
      }
    }
    stmt.free();
  }
  console.log('Done reading', Date.now() - start);

  console.log('stats');
  file.ops.stats();
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
  console.log('WORKER', Math.random());
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
