import { Reader, Writer } from './serialize';
import * as perf from './perf';

let openDbs = new Map();
let transactions = new Map();

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

let LOCK_TYPES = {
  NONE: 0,
  SHARED: 1,
  RESERVED: 2,
  PENDING: 3,
  EXCLUSIVE: 4
};

class Transaction {
  constructor(db, initialMode = 'readonly') {
    this.db = db;
    this.cache = new Map();
    this.trans = this.db.transaction(['data'], initialMode);
    this.store = this.trans.objectStore('data');
    this.lockType =
      initialMode === 'readonly' ? LOCK_TYPES.SHARED : LOCK_TYPES.EXCLUSIVE;
  }

  async prefetchFirstBlock(timeout) {
    // TODO: handle timeout

    // Do a read
    let block = await this.get(0);

    // Cache it
    this.cache.set(0, block);
    return block;
  }

  async waitComplete() {
    return new Promise((resolve, reject) => {
      if (this.lockType === LOCK_TYPES.EXCLUSIVE) {
        // Wait until all writes are committed
        this.trans.oncomplete = e => resolve();
        this.trans.onerror = e => reject(e);

        // If `commit` is available, eagerly commit it for better perf
        if (this.trans.commit) {
          this.trans.commit();
        }
      } else {
        // No need to wait on anything in a read-only transaction
        resolve();
      }
    });
  }

  async upgradeExclusive() {
    if (this.trans.commit) {
      this.trans.commit();
    }

    this.trans = this.db.transaction(['data'], 'readwrite');
    this.store = this.trans.objectStore('data');
    this.lockType = LOCK_TYPES.EXCLUSIVE;

    let cached0 = this.cache.get(0);
    if (cached0 == null) {
      throw new Error('Unable to upgrade, first block is not cached');
    }

    // Do a read
    let block = await trans.prefetchFirstBlock(500);
    if (block === null) {
      // BUSY
    }

    for (let i = 24; i < 40; i++) {
      if (block[i] !== cached0[i]) {
        return false;
      }
    }

    return true;
  }

  async get(key) {
    return new Promise((resolve, reject) => {
      let cached = this.cache.get(key);
      if (cached) {
        return cached;
      }

      perf.record('get');
      let req = this.store.get(key);
      req.onsuccess = e => {
        perf.endRecording('get');

        this.cache.set(key, req.result);
        resolve(req.result);
      };
      req.onerror = e => reject(e);
    });
  }

  async set(store, item) {
    return new Promise((resolve, reject) => {
      store.put(item.value, item.key);
      req.onsuccess = e => resolve(req.result);
      req.onerror = e => reject(e);
    });
  }

  makeCursor(start, dir = 'next', cb) {
    let keyRange;
    if (dir === 'prev') {
      keyRange = IDBKeyRange.upperBound(start);
    } else {
      keyRange = IDBKeyRange.lowerBound(start);
    }

    // Note that we don't cache anything returned from cursors
    let req = this.store.openCursor(keyRange, dir);
    req.onsuccess = e => {
      try {
        cb(e.target.result);
      } catch (e) {
        console.log(e);
      }
    };
    req.onerror = e => {
      console.log('cursor error', e);
    };
    return req;
  }

  async bulkSet(items) {
    await new Promise((resolve, reject) => {
      for (let item of items) {
        this.store.put(item.value, item.key);
      }
    });
  }
}

async function loadDb(name) {
  return new Promise((resolve, reject) => {
    if (openDbs.get(name)) {
      resolve(openDbs.get(name));
      return;
    }

    let req = globalThis.indexedDB.open(name, 1);
    req.onsuccess = event => {
      console.log('db is open!', name);
      let db = event.target.result;

      db.onversionchange = () => {
        // TODO: Notify the user somehow
        console.log('closing because version changed');
        db.close();
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

async function getOrMakeTransaction(name) {
  let trans = transactions.get(name);
  if (trans == null) {
    let trans = new Transaction(await loadDb(name));
    await trans.init();
    return trans;
  }
  return trans;
}

function getTransaction(name) {
  return transactions.get(name);
}

async function withTransaction(name, mode, func) {
  let trans = transactions.get(name);
  if (trans) {
    if (mode === 'readwrite' && trans.lockType === LOCK_TYPES.SHARED) {
      throw new Error('Attempted write but only has SHARED lock');
    }
    return func(trans);
  }

  let trans = new Transaction(await loadDb(name), mode);
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
  console.log('locking', name, lockType, performance.now());

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
      // If not upgrading and we already have a lock, make sure it's a
      // shared lock. Anything else is invalid
      assert(
        trans.lockType === lockType,
        `Downgrading lock to ${lockType} is invalid`
      );
      assert(
        trans.lockType === LOCK_TYPES.SHARED,
        `Invalid lock state reached: ${trans.lockType}`
      );

      writer.int32(0);
      writer.finalize();
    }
  } else {
    assert(
      trans.lockType === LOCK_TYPES.SHARED,
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
  console.log('unlocking', name, lockType, performance.now());

  let trans = getTransaction(name);
  if (trans == null) {
    throw new Error('Unlock error: no transaction running');
  }
  await trans.waitComplete();

  transactions.delete(name);

  writer.int32(0);
  writer.finalize();
}

async function handleRead(writer, name, position, prevPos, cb) {
  // How to read it?

  let trans = getTransaction(name);

  if (trans) {
  } else {
    return withTransaction(name, 'readonly', async trans => {
      cb(await trans.get(position));
    });
  }

  return withTransaction(trans => {
    let dir = prevPos > position ? 'prev' : 'next';

    perf.record('stream');
    let req = trans.makeCursor(position, dir, cursor => {
      perf.endRecording('stream');
      perf.endRecording('stream-next');

      let data = cursor ? cursor.value : null;

      if (cursor == null) {
        writer.bytes(new ArrayBuffer(0));
      } else {
        writer.bytes(data);
      }
      writer.finalize();

      cb(cursor, req);
    });
  });
}

async function handleWrites(writer, name, writes) {
  let trans = await getTransaction(name);

  try {
    await trans.bulkSet(writes.map(w => ({ key: w.pos, value: w.data })));

    writer.int32(0);
    writer.finalize();
  } catch (err) {
    console.log(err);
    writer.int32(-1);
    writer.finalize();
  }
}

async function handleReadMeta(writer, name) {
  let trans = await getOrMakeTransaction(name);

  try {
    console.log('getting meta');
    let res = await trans.get(-1);

    await trans.waitComplete();

    console.log('getting meta (done)');
    let meta = res;
    writer.int32(meta ? meta.size : -1);
    writer.int32(meta ? meta.blockSize : -1);
    writer.finalize();
  } catch (err) {
    console.log(err);
    writer.int32(-1);
    writer.int32(-1);
    writer.finalize();
  }
}

async function handleWriteMeta(writer, name, meta) {
  let trans = await getOrMakeTransaction(name);

  try {
    console.log('setting meta', meta);
    await trans.set({ key: -1, value: meta });

    writer.int32(0);
    writer.finalize();
  } catch (err) {
    console.log(err);
    writer.int32(-1);
    writer.finalize();
  }
}

async function handleDeleteFile(writer, name) {
  // fileCache[name] = null;

  writer.int32(0);
  writer.finalize();
}

async function listen(reader, writer) {
  let method = reader.string();

  switch (method) {
    case 'stats-start': {
      reader.done();

      perf.start();

      writer.int32(0);
      writer.finalize();
      listen(reader, writer);
      break;
    }

    case 'stats': {
      reader.done();

      await perf.end();

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

      streamRead(writer, name, pos);

      function streamRead(writer, name, pos, prevPos) {
        handleRead(writer, name, pos, prevPos, (cursor, req) => {
          // We _could_ timeout here. This is mainly for the case
          // where there's lots of sequential reads at once. It might
          // make sense to timeout and jump back into the main
          // `listen` loop to avoid any weirdness with keeping a
          // read transaction open for a long time
          //
          // TODO: According to
          // https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology#gloss_transaction,
          // the browser may terminate a transaction that takes too
          // long. That's fine, but we need to handle that case and
          // check if the cursor is still valid, If not, we need to
          // start a new cursor
          //
          // "Transactions are expected to be short-lived" <- hah
          // whatever. thank you `Atomics.wait`
          let method = reader.peek(() => reader.string());

          if (method === 'readBlock') {
            // Pop off the method name since we only peeked it
            reader.string();
            let nextName = reader.string();
            let nextPos = reader.int32();
            reader.done();

            if (cursor && nextName === name) {
              if (
                cursor.direction === 'next' &&
                nextPos > cursor.key &&
                nextPos < cursor.key + 50
              ) {
                // console.log('SUCCESS');
                perf.record('stream-next');
                cursor.advance(nextPos - cursor.key);
              } else if (
                cursor.direction === 'prev' &&
                nextPos < cursor.key &&
                nextPos > cursor.key - 50
              ) {
                // console.log('SUCCESS');
                perf.record('stream-next');
                cursor.advance(cursor.key - nextPos);
              } else {
                // console.log('FAIL');
                let trans = req.transaction;
                if (trans.commit) {
                  trans.commit();
                }

                streamRead(writer, name, nextPos, pos);
              }
            } else {
              let trans = req.transaction;
              if (trans.commit) {
                trans.commit();
              }

              streamRead(writer, name, nextPos, pos);
            }
          } else {
            let trans = req.transaction;
            if (trans.commit) {
              trans.commit();
            }

            listen(reader, writer);
          }
        });
      }

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
      let blockSize = reader.int32();
      reader.done();
      await handleWriteMeta(writer, name, { size, blockSize });
      listen(reader, writer);
      break;
    }

    case 'deleteFile': {
      let name = reader.string();
      reader.done();

      await handleDeleteFile(writer, name);
      listen(reader, writer);
      break;
    }

    case 'lockFile': {
      let name = reader.string();
      let lockType = reader.int32();
      reader.done();

      handleLock(writer, name, lockType);
      listen(reader, writer);
      break;
    }

    case 'unlockFile': {
      let name = reader.string();
      let lockType = reader.int32();
      reader.done();

      handleUnlock(writer, name, lockType);
      listen(reader, writer);
      break;
    }

    // TODO: handle close

    default:
      throw new Error('Unknown method: ' + method);
  }
}

self.onmessage = msg => {
  switch (msg.data.type) {
    case 'init': {
      postMessage({ type: 'worker-ready' });
      let [argBuffer, resultBuffer] = msg.data.buffers;
      let reader = new Reader(argBuffer, { name: 'args', debug: false });
      let writer = new Writer(resultBuffer, { name: 'results', debug: false });
      listen(reader, writer);
      break;
    }
  }
};
