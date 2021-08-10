import { Reader, Writer } from './shared-channel';
import * as perf from 'perf-deets';
import { LOCK_TYPES, isSafeToWrite } from '../sqlite-util';

let isProbablySafari = /^((?!chrome|android).)*safari/i.test(
  navigator.userAgent
);

// Don't need a map anymore, we use a worker per file
let openDbs = new Map();
let transactions = new Map();

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

// We use long-lived transactions, and `Transaction` keeps the
// transaction state. It implements an optimal way to perform
// read/writes with knowledge of how sqlite asks for them, and also
// implements a locking mechanism that maps to how sqlite locks work.
class Transaction {
  constructor(db, initialMode = 'readonly') {
    this.db = db;
    perf.count('transactions');
    this.trans = this.db.transaction(['data'], initialMode);
    this.store = this.trans.objectStore('data');
    this.lockType =
      initialMode === 'readonly' ? LOCK_TYPES.SHARED : LOCK_TYPES.EXCLUSIVE;

    // There is no need for us to cache blocks. Use sqlite's
    // `cache_size` for that and it will automatically do it. However,
    // we do still keep a cache of the first block for the duration of
    // this transaction because of how locking works; this avoids a
    // few extra reads and allows us to detect changes during
    // upgrading (see `upgradeExclusive`)
    this.cachedFirstBlock = null;

    this.cursor = null;
    this.prevReads = null;
  }

  async prefetchFirstBlock(timeout) {
    // TODO: implement timeout

    // Get the first block and cache it
    let block = await this.get(0);
    this.cachedFirstBlock = block;
    return block;
  }

  async waitComplete() {
    return new Promise((resolve, reject) => {
      // Eagerly commit it for better perf. Note that **this assumes
      // the transaction is open** as `commit` will throw an error if
      // it's already closed (which should never be the case for us)
      this.commit();

      if (this.lockType === LOCK_TYPES.EXCLUSIVE) {
        // Wait until all writes are committed
        this.trans.oncomplete = e => resolve();

        // TODO: Is it OK to add this later, after an error might have
        // happened? Will it hold the error and fire this when we
        // attached it? We might want to eagerly create the promise
        // when creating the transaction and return it here
        this.trans.onerror = e => reject(e);
      } else {
        if (isProbablySafari) {
          // Safari has a bug where sometimes the IDB gets blocked
          // permanently if you refresh the page with an open
          // transaction. You have to restart the browser to fix it.
          // We wait for readonly transactions to finish too, but this
          // is a perf hit
          this.trans.oncomplete = e => resolve();
        } else {
          // No need to wait on anything in a read-only transaction.
          // Note that errors during reads area always handled by the
          // read request.
          resolve();
        }
      }
    });
  }

  commit() {
    // Safari doesn't support this method yet (this is just an
    // optimization)
    if (this.trans.commit) {
      this.trans.commit();
    }
  }

  async upgradeExclusive() {
    this.commit();

    // console.log('updating transaction readwrite');
    perf.count('transactions');
    this.trans = this.db.transaction(['data'], 'readwrite');
    this.store = this.trans.objectStore('data');
    this.lockType = LOCK_TYPES.EXCLUSIVE;

    let cached0 = this.cachedFirstBlock;

    // Do a read
    let block = await this.prefetchFirstBlock(500);
    // TODO: when timeouts are implemented, detect timeout and return BUSY

    return isSafeToWrite(block, cached0);
  }

  downgradeShared() {
    this.commit();

    // console.log('downgrading transaction readonly');
    perf.count('transactions');
    this.trans = this.db.transaction(['data'], 'readonly');
    this.store = this.trans.objectStore('data');
    this.lockType = LOCK_TYPES.SHARED;
  }

  async get(key) {
    return new Promise((resolve, reject) => {
      perf.record('get');
      let req = this.store.get(key);
      req.onsuccess = e => {
        perf.endRecording('get');
        resolve(req.result);
      };
      req.onerror = e => reject(e);
    });
  }

  getReadDirection() {
    // There are a two ways we can read data: a direct `get` request
    // or opening a cursor and iterating through data. We don't know
    // what future reads look like, so we don't know the best strategy
    // to pick. Always choosing one strategy forgoes a lot of
    // optimization, because iterating with a cursor is a lot faster
    // than many `get` calls. On the other hand, opening a cursor is
    // slow, and so is calling `advance` to move a cursor over a huge
    // range (like moving it 1000 items later), so many `get` calls would
    // be faster. In general:
    //
    // * Many `get` calls are faster when doing random accesses
    // * Iterating with a cursor is faster if doing mostly sequential
    //   accesses
    //
    // We implement a heuristic and keeps track of the last 3 reads
    // and detects when they are mostly sequential. If they are, we
    // open a cursor and start reading by iterating it. If not, we do
    // direct `get` calls.
    //
    // On top of all of this, each browser has different perf
    // characteristics. We will probably want to make these thresholds
    // configurable so the user can change them per-browser if needed,
    // as well as fine-tuning them for their usage of sqlite.

    let prevReads = this.prevReads;
    if (prevReads) {
      // Has there been 3 forward sequential reads within 10 blocks?
      if (
        prevReads[0] < prevReads[1] &&
        prevReads[1] < prevReads[2] &&
        prevReads[2] - prevReads[0] < 10
      ) {
        return 'next';
      }

      // Has there been 3 backwards sequential reads within 10 blocks?
      if (
        prevReads[0] > prevReads[1] &&
        prevReads[1] > prevReads[2] &&
        prevReads[0] - prevReads[2] < 10
      ) {
        return 'prev';
      }
    }

    return null;
  }

  read(position) {
    let waitCursor = () => {
      return new Promise((resolve, reject) => {
        if (this.cursorPromise != null) {
          throw new Error(
            'waitCursor() called but something else is already waiting'
          );
        }
        this.cursorPromise = { resolve, reject };
      });
    };

    if (this.cursor) {
      let cursor = this.cursor;

      if (
        cursor.direction === 'next' &&
        position > cursor.key &&
        position < cursor.key + 100
      ) {
        perf.record('stream-next');

        cursor.advance(position - cursor.key);
        return waitCursor();
      } else if (
        cursor.direction === 'prev' &&
        position < cursor.key &&
        position > cursor.key - 100
      ) {
        perf.record('stream-next');

        cursor.advance(cursor.key - position);
        return waitCursor();
      } else {
        // Ditch the cursor
        this.cursor = null;
        return this.read(position);
      }
    } else {
      // We don't already have a cursor. We need to a fresh read;
      // should we open a cursor or call `get`?

      let dir = this.getReadDirection();
      if (dir) {
        // Open a cursor
        this.prevReads = null;

        let keyRange;
        if (dir === 'prev') {
          keyRange = IDBKeyRange.upperBound(position);
        } else {
          keyRange = IDBKeyRange.lowerBound(position);
        }

        let req = this.store.openCursor(keyRange, dir);
        perf.record('stream');

        req.onsuccess = e => {
          perf.endRecording('stream');
          perf.endRecording('stream-next');

          let cursor = e.target.result;
          this.cursor = cursor;

          if (this.cursorPromise == null) {
            throw new Error('Got data from cursor but nothing is waiting it');
          }
          this.cursorPromise.resolve(cursor ? cursor.value : null);
          this.cursorPromise = null;
        };
        req.onerror = e => {
          console.log('Cursor failure:', e);

          if (this.cursorPromise == null) {
            throw new Error('Got data from cursor but nothing is waiting it');
          }
          this.cursorPromise.reject(e);
          this.cursorPromise = null;
        };

        return waitCursor();
      } else {
        if (this.prevReads == null) {
          this.prevReads = [0, 0, 0];
        }
        this.prevReads.push(position);
        this.prevReads.shift();

        return this.get(position);
      }
    }
  }

  async set(item) {
    this.prevReads = null;

    return new Promise((resolve, reject) => {
      let req = this.store.put(item.value, item.key);
      req.onsuccess = e => resolve(req.result);
      req.onerror = e => reject(e);
    });
  }

  async bulkSet(items) {
    this.prevReads = null;

    for (let item of items) {
      this.store.put(item.value, item.key);
    }
  }
}

async function loadDb(name) {
  return new Promise((resolve, reject) => {
    if (openDbs.get(name)) {
      resolve(openDbs.get(name));
      return;
    }

    let req = globalThis.indexedDB.open(name, 2);
    req.onsuccess = event => {
      let db = event.target.result;

      db.onversionchange = () => {
        // TODO: Notify the user somehow
        console.log('closing because version changed');
        db.close();
        openDbs.delete(name);
      };

      db.onclose = () => {
        openDbs.delete(name);
      };

      openDbs.set(name, db);
      resolve(db);
    };
    req.onupgradeneeded = event => {
      let db = event.target.result;
      if (!db.objectStoreNames.contains('data')) {
        db.createObjectStore('data');
      }
    };
    req.onblocked = e => console.log('blocked', e);
    req.onerror = req.onabort = e => reject(e.target.error);
  });
}

function closeDb(name) {
  let openDb = openDbs.get(name);
  if (openDb) {
    openDb.close();
    openDbs.delete(name);
  }
}

function getTransaction(name) {
  return transactions.get(name);
}

async function withTransaction(name, mode, func) {
  let trans = transactions.get(name);
  if (trans) {
    // If a transaction already exists, that means the file has been
    // locked. We don't fully support arbitrary nested transactions,
    // as seen below (we won't upgrade a `readonly` to `readwrite`
    // automatically) and this is mainly for the use case where sqlite
    // locks the db and creates a transaction for the duraction of the
    // lock. We don't actually write code in a way that assumes nested
    // transactions, so just error here
    if (mode === 'readwrite' && trans.lockType === LOCK_TYPES.SHARED) {
      throw new Error('Attempted write but only has SHARED lock');
    }
    return func(trans);
  }

  // Outside the scope of a lock, create a temporary transaction
  trans = new Transaction(await loadDb(name), mode);
  await func(trans);
  await trans.waitComplete();
}

// Locking strategy:
//
// * We map sqlite's locks onto IndexedDB's transaction semantics.
//   Read transactions may execute in parallel. Read/write
//   transactions are queued up and wait until all preceding
//   read transactions finish executing. Read transactions started
//   after a read/write transaction wait until it is finished.
//
// * IDB transactions will wait forever until they can execute (for
//   example, they may be blocked on a read/write transaction). We
//   don't want to allow sqlite transactions to wait forever, so
//   we manually timeout if a transaction takes too long to
//   start executing. This simulates the behavior of a sqlite
//   bailing if it can't require a lock.
//
// * A SHARED lock wants to read from the db. We start a read
//   transaction and read the first block, and if we read it within
//   500ms we consider the lock successful. Otherwise the lock
//   failed and we return SQLITE_BUSY. (There's no perf downside
//   to reading the first block - it has to be read anyway to check
//   bytes 24-39 for the change counter)
//
// * A RESERVED lock means the db wants to start writing (think of
//   `BEGIN TRANSACTION`). Only one process can obtain a RESERVED
//   lock at a time, but normally sqlite still leads new read locks
//   happen. It isn't until an EXCLUSIVE lock is held that reads are
//   blocked. However, since we need to guarantee only one RESERVED
//   lock at once (otherwise data could change from another process
//   within a transaction, causing faulty caches etc) the simplest
//   thing to do is go ahead and grab a read/write transaction that
//   represents the RESERVED lock. This will block all reads from
//   happening, and is essentially the same as an EXCLUSIVE lock.
//
//     * The main problem here is we can't "upgrade" a `readonly`
//       transaction to `readwrite`, but native sqlite can upgrade a
//       lock from SHARED to RESERVED. We need to start a new
//       transaction to do so, and because of that there might be
//       other `readwrite` transactions that get run during the
//       "upgrade" which invalidates the whole locking process and
//       and corrupts data.
//
// * Ideally, we could tell sqlite to skip SHARED locks entirely. We
//   don't need them since we can rely on IndexedDB's semantics.
//   Then when it wants to start writing, we get a RESERVED lock
//   without having to upgrade from SHARED. This would save us
//   the cost of a `readonly` transaction when writing; right now
//   it must open a `readonly` transaction and then immediately open
//   a `readwrite` to upgrade it. I thought of deferring opening the
//   `readonly` transaction until something is actually read, but
//   unfortunately sqlite opens it, reads the first block, and then
//   upgrades it. So there's no way around it. (We can't assume it's
//   a `readwrite` transaction at that point since that would assume
//   all SHARED locks are `readwrite`, removing the possibility of
//   concurrent reads).
//
// * Upgrading to an EXCLUSIVE lock is a noop, since we treat RESERVED
//   locks as EXCLUSIVE.
async function handleLock(writer, name, lockType) {
  // console.log('locking', name, lockType, performance.now());

  let trans = transactions.get(name);
  if (trans) {
    if (lockType > trans.lockType) {
      // Upgrade SHARED to EXCLUSIVE
      assert(
        trans.lockType === LOCK_TYPES.SHARED,
        `Uprading lock type from ${trans.lockType} is invalid`
      );
      assert(
        lockType === LOCK_TYPES.RESERVED || lockType === LOCK_TYPES.EXCLUSIVE,
        `Upgrading lock type to ${lockType} is invalid`
      );

      let success = await trans.upgradeExclusive();
      writer.int32(success ? 0 : -1);
      writer.finalize();
    } else {
      // If not upgrading and we already have a lock, make sure this
      // isn't a downgrade
      assert(
        trans.lockType === lockType,
        `Downgrading lock to ${lockType} is invalid`
      );

      writer.int32(0);
      writer.finalize();
    }
  } else {
    assert(
      lockType === LOCK_TYPES.SHARED,
      `New locks must start as SHARED instead of ${lockType}`
    );

    let trans = new Transaction(await loadDb(name));
    if ((await trans.prefetchFirstBlock(500)) == null) {
      // BUSY
    }

    transactions.set(name, trans);

    writer.int32(0);
    writer.finalize();
  }
}

async function handleUnlock(writer, name, lockType) {
  let trans = getTransaction(name);

  if (lockType === LOCK_TYPES.SHARED) {
    if (trans == null) {
      throw new Error('Unlock error (SHARED): no transaction running');
    }

    if (trans.lockType === LOCK_TYPES.EXCLUSIVE) {
      trans.downgradeShared();
    }
  } else if (lockType === LOCK_TYPES.NONE) {
    // I thought we could assume a lock is always open when `unlock`
    // is called, but it also calls `unlock` when closing the file no
    // matter what. Do nothing if there's no lock currently
    if (trans) {
      // TODO: this is where an error could bubble up. Handle it
      await trans.waitComplete();
      transactions.delete(name);
    }
  }

  writer.int32(0);
  writer.finalize();
}

async function handleRead(writer, name, position) {
  return withTransaction(name, 'readonly', async trans => {
    let data = await trans.read(position);

    if (data == null) {
      writer.bytes(new ArrayBuffer(0));
    } else {
      writer.bytes(data);
    }
    writer.finalize();
  });
}

async function handleWrites(writer, name, writes) {
  return withTransaction(name, 'readwrite', async trans => {
    await trans.bulkSet(writes.map(w => ({ key: w.pos, value: w.data })));

    writer.int32(0);
    writer.finalize();
  });
}

async function handleReadMeta(writer, name) {
  return withTransaction(name, 'readonly', async trans => {
    try {
      console.log('Reading meta...');
      let res = await trans.get(-1);
      console.log(`Got meta for ${name}:`, res);

      if (res == null) {
        // No data yet
        writer.int32(-1);
        writer.int32(4096);
        writer.finalize();
      } else {
        // let meta = res;

        // Also read the first block to get the page size
        let block = await trans.get(0);

        // There should always be a first block if we have meta, but
        // in case of a corrupted db, default to this size
        let blockSize = 4096;
        if (block) {
          let arr = new Uint16Array(block);
          blockSize = arr[8] * 256;
        }

        writer.int32(res.size);
        writer.int32(blockSize);
        writer.finalize();
      }
    } catch (err) {
      console.log(err);
      writer.int32(-1);
      writer.int32(-1);
      writer.finalize();
    }
  });
}

async function handleWriteMeta(writer, name, meta) {
  return withTransaction(name, 'readwrite', async trans => {
    try {
      await trans.set({ key: -1, value: meta });

      writer.int32(0);
      writer.finalize();
    } catch (err) {
      console.log(err);
      writer.int32(-1);
      writer.finalize();
    }
  });
}

// `listen` continually listens for requests via the shared buffer.
// Right now it's implemented in a tail-call style (`listen` is
// recursively called) because I thought that was necessary for
// various reasons. We can convert this to a `while(1)` loop with
// and use `await` though
async function listen(reader, writer) {
  let method = reader.string();

  switch (method) {
    case 'profile-start': {
      reader.done();

      perf.start();

      writer.int32(0);
      writer.finalize();
      listen(reader, writer);
      break;
    }

    case 'profile-stop': {
      reader.done();

      perf.stop();
      // The perf library posts a message; make sure it has time to
      // actually post it before blocking the thread again
      await new Promise(resolve => setTimeout(resolve, 1000));

      writer.int32(0);
      writer.finalize();
      listen(reader, writer);
      break;
    }

    case 'writeBlocks': {
      let name = reader.string();
      let writes = [];
      while (!reader.done()) {
        let pos = reader.int32();
        let data = reader.bytes();
        writes.push({ pos, data });
      }

      await handleWrites(writer, name, writes);
      listen(reader, writer);
      break;
    }

    case 'readBlock': {
      let name = reader.string();
      let pos = reader.int32();
      reader.done();

      await handleRead(writer, name, pos);
      listen(reader, writer);
      break;
    }

    case 'readMeta': {
      let name = reader.string();
      reader.done();
      await handleReadMeta(writer, name);
      listen(reader, writer);
      break;
    }

    case 'writeMeta': {
      let name = reader.string();
      let size = reader.int32();
      // let blockSize = reader.int32();
      reader.done();
      await handleWriteMeta(writer, name, { size });
      listen(reader, writer);
      break;
    }

    case 'closeFile': {
      let name = reader.string();
      reader.done();

      // This worker is done, shut down
      writer.int32(0);
      writer.finalize();
      closeDb(name);
      self.close();
      break;
    }

    case 'lockFile': {
      let name = reader.string();
      let lockType = reader.int32();
      reader.done();

      await handleLock(writer, name, lockType);
      listen(reader, writer);
      break;
    }

    case 'unlockFile': {
      let name = reader.string();
      let lockType = reader.int32();
      reader.done();

      await handleUnlock(writer, name, lockType);
      listen(reader, writer);
      break;
    }

    default:
      throw new Error('Unknown method: ' + method);
  }
}

self.onmessage = msg => {
  switch (msg.data.type) {
    case 'init': {
      // postMessage({ type: '__absurd:worker-ready' });
      let [argBuffer, resultBuffer] = msg.data.buffers;
      let reader = new Reader(argBuffer, { name: 'args', debug: false });
      let writer = new Writer(resultBuffer, { name: 'results', debug: false });
      listen(reader, writer);
      break;
    }
  }
};
