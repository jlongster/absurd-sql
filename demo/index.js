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

let _db = null;
async function getDatabase() {
  await init();
  if (_db == null) {
    console.log('opening');
    _db = new SQL.CustomDatabase('/tmp/blocked/db3.sqlite');
  }
  return _db;
}

let count = 500;

async function populate() {
  let db = await getDatabase();
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
  db.prepare('COMMIT').run();

  console.log('3 ---------------------');

  db.prepare('BEGIN TRANSACTION').run();
  stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
  let stmt2 = db.prepare('SELECT COUNT(*) FROM kv');
  for (let i = 0; i < 2; i++) {
    stmt.run([uuid.v4(), ((Math.random() * 100000) | 0).toString()]);
    stmt2.run();
  }
  db.prepare('ROLLBACK').run();

  let file = backend.getFile('db3.sqlite');

  console.log(
    'done',
    (file.size / 1024).toFixed(2) + 'KB',
    file.size / backend.defaultChunkSize + ' blocks'
  );
}

async function run() {
  output.innerHTML = '';

  let db = await getDatabase();
  // let off = (Math.random() * count) | 0;
  let off = 0;
  let stmt = db.prepare(`PRAGMA journal_mode`);
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

  let db = await getDatabase();
  db.exec(`VACUUM`);

  let stmt = db.prepare(`PRAGMA page_size`);
  stmt.step();
  output.innerHTML = JSON.stringify(stmt.getAsObject());
  stmt.free();
}

async function size() {
  output.innerHTML = '';
  let db = await getDatabase();
  let page_size = 1024;
  db.exec(`PRAGMA page_size=${page_size}`);
  output.innerHTML = `set page_size to ${page_size}`;
}

document.querySelector('#populate').addEventListener('click', populate);
document.querySelector('#run').addEventListener('click', run);
document.querySelector('#vacuum').addEventListener('click', vacuum);
document.querySelector('#size').addEventListener('click', size);

init();
