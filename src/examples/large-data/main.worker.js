import initSqlJs from '@jlongster/sql.js/dist/sql-wasm-debug.js';
import { BlockedFS } from '../..';
import * as uuid from 'uuid';
import MemoryBackend from '../../memory/backend';
import IndexedDBBackend from '../../indexeddb/backend';

// Various global state for the demo

let currentBackendType = 'idb';
let cacheSize = 0;
let pageSize = 4096;
let dbName = `db20.sqlite`;

let memoryBackend = new MemoryBackend(pageSize, {});
// For now, keep the block size 4096. We were trying to align sqlite's
// `page_size` with this for optimal perf, but we don't want to
// actually rely on the db file layout. The web is too different and
// you'll probably want to share the same file with other systems
// that can read it natively.
//
// We should support arbitrary block sizes here, which is the size of
// the chunk of data in each IDB entry. However if you make this
// bigger, sqlite will be requesting smaller pages but we will be
// re-requesting the same pages many times. In the future that will be
// cached.
let idbBackend = new IndexedDBBackend(pageSize);
let BFS;

// Helper methods

let SQL = null;
async function init() {
  if (SQL == null) {
    SQL = await initSqlJs({ locateFile: file => file });
    BFS = new BlockedFS(SQL.FS, idbBackend);
    SQL.register_for_idb(BFS);

    await memoryBackend.init();

    try {
      await idbBackend.init();
    } catch (e) {
      if (e.message.includes('SharedArrayBuffer')) {
        output(
          '<code>SharedArrayBuffer</code> is not available in your browser. It is required, but in the future we will provide a fallback.'
        );
      }
      throw e;
    }

    SQL.FS.mkdir('/blocked');
    SQL.FS.mount(BFS, {}, '/blocked');
  }
}

function output(msg) {
  self.postMessage({ type: 'output', msg });
}

function getDBName() {
  // Changing the page size should change the database since it change
  // the structural layout of it. We don't actually support changing
  // the page size yet, which should load everything into memory and
  // then write it out with the new page (block) size.
  return dbName.replace('.sqlite', `.${pageSize}.sqlite`);
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
    _db = new SQL.Database(`/blocked/${getDBName()}`, { filename: true });
    // Should ALWAYS use the journal in memory mode. Doesn't make
    // any sense at all to write the journal
    //
    // It's also important to use the same page size that our storage
    // system uses. This will change in the future so that you don't
    // have to worry about sqlite's page size (requires some
    // optimizations)
    _db.exec(`
      PRAGMA cache_size=-${cacheSize};
      PRAGMA page_size=${pageSize};
      PRAGMA journal_mode=MEMORY;
    `);
    output(
      `Opened ${getDBName()} (${currentBackendType}) cache size: ${cacheSize}`
    );
  }
  return _db;
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

async function populate() {
  let db = await getDatabase();

  output('Clearing existing data');
  db.exec(`
    BEGIN TRANSACTION;
    DROP TABLE IF EXISTS kv;
    CREATE TABLE kv (key TEXT, value TEXT);
    COMMIT;
  `);

  let start = Date.now();
  db.exec('BEGIN TRANSACTION');
  let stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');

  let count = 1000000;
  if (currentBackendType === 'memory') {
    output(
      'Cannot write 1,000,000 items to memory backend, reducing to 100,000'
    );
    count = 100000;
  }

  output(`Inserting ${formatNumber(count)} items`);

  for (let i = 0; i < count; i++) {
    stmt.run([uuid.v4(), ((Math.random() * 100000) | 0).toString()]);
  }
  db.exec('COMMIT');
  output('Done! Took: ' + (Date.now() - start));

  let { node } = SQL.FS.lookupPath(`/blocked/${getDBName()}`);
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

  let { node } = SQL.FS.lookupPath(`/blocked/${getDBName()}`);
  let file = node.contents;
  file.startStats();

  output('Running <code>SELECT COUNT(*) FROM kv</code>');
  let start = Date.now();

  let stmt;
  try {
    stmt = db.prepare(`SELECT COUNT(*) FROM kv`);
  } catch (err) {
    output('Error (make sure you write data first): ' + err.message);
    throw err;
  }
  while (stmt.step()) {
    let row = stmt.getAsObject();
    output('<code>' + JSON.stringify(row) + '</code>');
  }
  stmt.free();

  output(
    'Done reading, took ' +
      formatNumber(Date.now() - start) +
      'ms (detailed stats in console)'
  );
  output('That just scanned through all 50MB of data!');

  file.stats();
}

async function randomReads() {
  let db = await getDatabase();

  let { node } = SQL.FS.lookupPath(`/blocked/${getDBName()}`);
  let file = node.contents;
  file.startStats();

  output(
    'Running <code>SELECT key FROM kv LIMIT 1000 OFFSET ?</code> 20 times with increasing offset'
  );
  let start = Date.now();

  let stmt;
  try {
    stmt = db.prepare(`SELECT key FROM kv LIMIT 1000 OFFSET ?`);
  } catch (err) {
    output('Error (make sure you write data first): ' + err.message);
    throw err;
  }

  for (let i = 0; i < 8; i++) {
    let off = i * 10000;
    stmt.bind([off]);
    output('Using offset: ' + formatNumber(off));

    let num = 0;
    while (stmt.step()) {
      num++;
      let row = stmt.getAsObject();
      if (num === 999) {
        output('(999 items hidden)');
      } else if (num > 998) {
        output('<code>' + JSON.stringify(row) + '</code>');
      }
    }

    stmt.reset();
  }

  stmt.free();

  output(
    'Done reading, took ' +
      formatNumber(Date.now() - start) +
      'ms (detailed stats in console)'
  );

  file.stats();
}

async function deleteFile() {
  await init();
  let filepath = `/blocked/${getDBName()}`;

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
        console.log(msg.data);
        if (methods[msg.data.name] == null) {
          throw new Error('Unknown method: ' + msg.data.name);
        }
        console.log(msg.data.name);
        methods[msg.data.name]();
        break;

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
            console.log(msg.data.value);
            pageSize = parseInt(msg.data.value);
            memoryBackend.defaultBlockSize = pageSize;
            idbBackend.defaultBlockSize = pageSize;
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
