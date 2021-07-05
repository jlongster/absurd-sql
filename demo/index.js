import initSqlJs from 'sql.js/dist/sql-wasm-debug';
import BlockedFS from '../blockedfs';
import * as uuid from 'uuid';
import MemoryBackend from '../backend-memory';

let output = document.querySelector('#output');

function randomBuffer(size) {
  let buffer = new ArrayBuffer(size);
  let view = new Uint8Array(buffer);
  for (let i = 0; i < size; i++) {
    view[i] = (Math.random() * 255) | 0;
  }
  console.log(buffer);
  return buffer;
}

let backend = new MemoryBackend({}, 4096);

let SQL = null;
async function init() {
  if (SQL == null) {
    SQL = await initSqlJs({ locateFile: file => file });
    SQL._register_for_idb();

    SQL.FS.mkdir('/tmp/blocked');
    SQL.FS.mount(new BlockedFS(SQL.FS, backend), {}, '/tmp/blocked');

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
  await init();
  if (_db1 == null) {
    _db1 = new SQL.CustomDatabase('/tmp/blocked/db3.sqlite');
  }
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

  db.prepare('BEGIN TRANSACTION').run();
  let stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
  for (let i = 0; i < 3; i++) {
    stmt.run([uuid.v4(), ((Math.random() * 100000) | 0).toString()]);
  }
  // db.prepare('COMMIT').run();

  let file = backend.getFile('db3.sqlite');

  console.log(
    'done',
    (file.size / 1024).toFixed(2) + 'KB',
    file.size / backend.defaultChunkSize + ' blocks'
  );
}

async function populate2() {
  let db = await getDatabase2();

  db.exec('BEGIN TRANSACTION');
  try {
    let stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
    console.log('x3');
    for (let i = 0; i < 3; i++) {
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
  output.innerHTML = '';

  let db = await getDatabase1();
  // let off = (Math.random() * count) | 0;
  let off = 0;
  let stmt = db.prepare(`PRAGMA locking_mode`);
  while (stmt.step()) {
    let row = stmt.getAsObject();

    let div = document.createElement('div');
    div.textContent = JSON.stringify(row);
    output.appendChild(div);
  }
  stmt.free();
}

async function vacuum() {
  output.innerHTML = '';

  let db = await getDatabase1();
  db.exec(`VACUUM`);

  let stmt = db.prepare(`PRAGMA page_size`);
  stmt.step();
  output.innerHTML = JSON.stringify(stmt.getAsObject());
  stmt.free();
}

async function size() {
  output.innerHTML = '';
  let db = await getDatabase1();
  let page_size = 1024;
  db.exec(`PRAGMA page_size=${page_size}`);
  output.innerHTML = `set page_size to ${page_size}`;
}

document.querySelector('#populate1').addEventListener('click', populate1);
document.querySelector('#populate2').addEventListener('click', populate2);
document.querySelector('#commit1').addEventListener('click', commit1);
document.querySelector('#run').addEventListener('click', run);
document.querySelector('#vacuum').addEventListener('click', vacuum);
document.querySelector('#size').addEventListener('click', size);

init();
