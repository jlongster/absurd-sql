import initSqlJs from '@jlongster/sql.js/dist/sql-wasm-debug.js';
import { BlockedFS } from '../..';
import * as uuid from 'uuid';
import MemoryBackend from '../../memory/backend';
import IndexedDBBackend from '../../indexeddb/backend';
import * as queries from './queries';

// Various global state for the demo

let currentBackendType = 'idb';
let cacheSize = 0;
let pageSize = 4096;
let dbName = `db21.sqlite`;
let recordProfile = false;

let memoryBackend = new MemoryBackend({});
let idbBackend = new IndexedDBBackend();
let BFS;

// Helper methods

let SQL = null;
async function init() {
  if (SQL == null) {
    SQL = await initSqlJs({ locateFile: file => file });
    BFS = new BlockedFS(SQL.FS, idbBackend);
    SQL.register_for_idb(BFS);

    if (typeof SharedArrayBuffer === 'undefined') {
      output(
        '<code>SharedArrayBuffer</code> is not available in your browser. Falling back.'
      );
    }

    SQL.FS.mkdir('/blocked');
    SQL.FS.mount(BFS, {}, '/blocked');
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

let _db = null;
function closeDatabase() {
  if (_db) {
    output(`Closed db`);
    _db.close();
    _db = null;
  }
}

async function getDatabase() {
  await init();
  if (_db == null) {
    let path = `/blocked/${dbName}`;

    let { node } = SQL.FS.open(path, 'a+');
    await node.contents.readIfFallback();

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

  let curPageSize = getPageSize(_db);

  if (curPageSize !== pageSize) {
    output('Page size has changed, running VACUUM to restructure db');
    _db.exec('VACUUM');
    // Vacuuming resets the cache size, so set it back
    _db.exec(`PRAGMA cache_size=-${cacheSize}`);
    output(`Page size is now ${getPageSize(_db)}`);
  }

  return _db;
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

async function populate() {
  let count = undefined;
  if (currentBackendType === 'memory') {
    output(
      'Cannot write 1,000,000 items to memory backend, reducing to 100,000'
    );
    count = 100000;
  }
  // count = Math.random() * 100 + 1000;

  let db = await getDatabase();

  if (recordProfile) {
    BFS.backend.startProfile();
  }

  queries.populate(db, output, uuid, count);

  if (recordProfile) {
    BFS.backend.stopProfile();
  }

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

async function countAll() {
  let db = await getDatabase();
  if (recordProfile) {
    BFS.backend.startProfile();
  }

  queries.countAll(db, output);

  if (recordProfile) {
    BFS.backend.stopProfile();
  }
}

async function randomReads() {
  let db = await getDatabase();
  if (recordProfile) {
    BFS.backend.startProfile();
  }

  queries.randomReads(db, output);

  if (recordProfile) {
    BFS.backend.stopProfile();
  }
}

async function deleteFile() {
  await init();
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
  populate,
  countAll,
  randomReads,
  deleteFile
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
              BFS.backend = memoryBackend;
            } else {
              BFS.backend = idbBackend;
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
