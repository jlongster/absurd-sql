import initSqlJs from '@jlongster/sql.js';
import { SQLiteFS } from '../..';
import MemoryBackend from '../../memory/backend';
import IndexedDBBackend from '../../indexeddb/backend';
import * as queries from './queries';
import * as rawIDBQueries from './queries-raw-idb';

// Various global state for the demo
let currentBackendType = 'idb';
let cacheSize = 0;
let pageSize = 4096;
let dbName = `db21.sqlite`;
let recordProfile = false;
let useRawIDB = false;

let memoryBackend = new MemoryBackend({});
let idbBackend = new IndexedDBBackend();
let sqlFS;

// Helper methods

let SQL = null;
async function init() {
  if (SQL == null) {
    SQL = await initSqlJs({ locateFile: file => file });
    sqlFS = new SQLiteFS(SQL.FS, idbBackend);
    SQL.register_for_idb(sqlFS);

    if (typeof SharedArrayBuffer === 'undefined') {
      output(
        '<code>SharedArrayBuffer</code> is not available in your browser. Falling back.'
      );
    }

    SQL.FS.mkdir('/blocked');
    SQL.FS.mount(sqlFS, {}, '/blocked');
  }
}

function getPageSize(db) {
  let stmt = db.prepare('PRAGMA page_size');
  stmt.step();
  let row = stmt.getAsObject();
  stmt.free();
  return row.page_size;
}

function output(msg) {
  self.postMessage({ type: 'output', msg });
}

function clearTimings() {
  self.postMessage({ type: 'clearTimings' });
}

function outputTiming(timing) {
  self.postMessage({ type: 'outputTiming', timing });
}

let _db = null;
function closeDatabase() {
  if (_db) {
    output(`Closed db`);
    _db.close();
    _db = null;
  }
}

async function getRawIDBDatabase() {
  return new Promise((resolve, reject) => {
    let req = globalThis.indexedDB.open('raw-db');
    req.onsuccess = e => {
      resolve(e.target.result);
    };
    req.onupgradeneeded = e => {
      let db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
    };
    req.onblocked = e => {
      console.log('opening db is blocked');
    };
  });
}

async function getDatabase() {
  await init();
  if (_db == null) {
    if (useRawIDB) {
      _db = await getRawIDBDatabase();
      return _db;
    }

    let path = `/blocked/${dbName}`;

    if (typeof SharedArrayBuffer === 'undefined') {
      let stream = SQL.FS.open(path, 'a+');
      await stream.node.contents.readIfFallback();
      SQL.FS.close(stream);
    }

    _db = new SQL.Database(path, { filename: true });

    // Should ALWAYS use the journal in memory mode. Doesn't make
    // any sense at all to write the journal. It's way slower
    _db.exec(`
      PRAGMA cache_size=-${cacheSize};
      PRAGMA journal_mode=MEMORY;
      PRAGMA page_size=${pageSize};
    `);
    output(`Opened ${dbName} (${currentBackendType}) cache size: ${cacheSize}`);
  }

  if (!useRawIDB) {
    let curPageSize = getPageSize(_db);

    if (curPageSize !== pageSize) {
      output('Page size has changed, running VACUUM to restructure db');
      _db.exec('VACUUM');
      // Vacuuming resets the cache size, so set it back
      _db.exec(`PRAGMA cache_size=-${cacheSize}`);
      output(`Page size is now ${getPageSize(_db)}`);
    }
  }

  return _db;
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

async function populate(count, { timings = true } = {}) {
  let q = useRawIDB ? rawIDBQueries : queries;
  let db = await getDatabase();

  q.clear(db, output);

  if (recordProfile) {
    sqlFS.backend.startProfile();
  }

  // Only reason this needs to `await` is for the raw idb
  // implementation; sqlite would be sync
  await q.populate(db, count, output, timings ? outputTiming : () => {});

  if (recordProfile) {
    sqlFS.backend.stopProfile();
  }

  if (!useRawIDB) {
    let { node } = SQL.FS.lookupPath(`/blocked/${dbName}`);
    let file = node.contents;

    output(
      'File is now: ' +
        formatNumber(file.meta.size / 1024) +
        'KB as ' +
        formatNumber(file.meta.size / 4096) +
        ' blocks'
    );
  }
}

async function populateSmall() {
  clearTimings();

  return populate(100);
}

async function populateLarge() {
  clearTimings();

  let count = 400000;
  if (currentBackendType === 'memory') {
    output(
      'Cannot write 1,000,000 items to memory backend, reducing to 100,000'
    );
    count = 100000;
  }
  return populate(count);
}

async function sumAll({ clear = true } = {}) {
  if (clear) {
    clearTimings();
  }

  let q = useRawIDB ? rawIDBQueries : queries;
  let db = await getDatabase();
  if (recordProfile) {
    sqlFS.backend.startProfile();
  }

  await q.sumAll(db, output, outputTiming);

  if (recordProfile) {
    sqlFS.backend.stopProfile();
  }
}

async function randomReads({ clear = true } = {}) {
  if (clear) {
    clearTimings();
  }

  let q = useRawIDB ? rawIDBQueries : queries;
  let db = await getDatabase();
  if (recordProfile) {
    sqlFS.backend.startProfile();
  }

  await q.randomReads(db, output, outputTiming);

  if (recordProfile) {
    sqlFS.backend.stopProfile();
  }
}

async function prepBench() {
  clearTimings();

  // Delete the file to ensure we start with a fresh db that isn't
  // muddled by any previous work (even if we clear the db, this makes
  // sure it's not badly partitioned or something)
  await deleteFile();

  // Force the db to open and wait a bit to ensure everything is ready
  // (so we don't see any perf hit on the first read)
  await getDatabase();
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function readBench() {
  await prepBench();

  for (let i of [100, 500, 1000, 5000, 10000, 50000, 100000]) {
    // Setting up for reads requires us to do writes... this is
    // basically duplicating the write benchmark, but keeping it this
    // way so it's easy to parse the timing numbers. If we combined
    // the benchmarks we'd get mixed numbers and have to separate them
    await populate(i, { timings: false });
    await sumAll({ clear: false });
  }
}

async function writeBench() {
  await prepBench();

  for (let i of [100, 500, 1000, 5000, 10000, 50000, 100000]) {
    await populate(i);
  }
}

async function deleteFile() {
  await init();
  closeDatabase();

  if (useRawIDB) {
    globalThis.indexedDB.deleteDatabase('raw-db');
    return;
  }

  let filepath = `/blocked/${dbName}`;

  let exists = true;
  try {
    SQL.FS.stat(filepath);
  } catch (e) {
    exists = false;
  }

  if (exists) {
    SQL.FS.unlink(filepath);
  }
  _db = null;
}

let methods = {
  init,
  populateSmall,
  populateLarge,
  sumAll,
  randomReads,
  deleteFile,
  readBench,
  writeBench
};

if (typeof self !== 'undefined') {
  self.onmessage = msg => {
    switch (msg.data.type) {
      case 'ui-invoke':
        if (methods[msg.data.name] == null) {
          throw new Error('Unknown method: ' + msg.data.name);
        }
        methods[msg.data.name]();
        break;

      case 'run-query': {
        getDatabase().then(db => {
          let stmt = db.prepare(msg.data.sql);
          let rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          self.postMessage({
            type: 'query-results',
            data: rows,
            id: msg.data.id
          });
        });
        break;
      }

      case 'profiling': {
        recordProfile = msg.data.on;
        break;
      }

      case 'options':
        switch (msg.data.name) {
          case 'backend':
            closeDatabase();
            currentBackendType = msg.data.value;
            // We dont really support swapping the backend like this,
            // but it works for the demo
            if (currentBackendType === 'memory') {
              sqlFS.backend = memoryBackend;
            } else {
              sqlFS.backend = idbBackend;
            }
            break;

          case 'cacheSize': {
            cacheSize = parseInt(msg.data.value);

            getDatabase().then(db => {
              db.exec(`
                PRAGMA cache_size=-${cacheSize};
              `);
              output(`Cache size is now ${cacheSize}KB`);
            });

            break;
          }

          case 'pageSize': {
            closeDatabase();
            pageSize = parseInt(msg.data.value);
            // This will force the db to load which checks the
            // requested page size and vacuums if necessary
            getDatabase();
            break;
          }

          case 'raw-idb': {
            if (msg.data.on !== useRawIDB) {
              closeDatabase();
              useRawIDB = msg.data.on;
              if (useRawIDB) {
                output('Switched to using raw IndexedDB');
              } else {
                output('Switched to using SQLIte');
              }
            }
            break;
          }
        }
        break;
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
