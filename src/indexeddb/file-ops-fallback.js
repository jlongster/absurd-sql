import { LOCK_TYPES, isSafeToWrite, getPageSize } from '../sqlite-util';

function positionToKey(pos, blockSize) {
  // We are forced to round because of floating point error. `pos`
  // should always be divisible by `blockSize`
  return Math.round(pos / blockSize);
}

async function openDb(name) {
  return new Promise((resolve, reject) => {
    let req = globalThis.indexedDB.open(name, 1);
    req.onsuccess = event => {
      let db = event.target.result;

      db.onversionchange = () => {
        console.log('closing because version changed');
        db.close();
      };
      db.onclose = () => {};

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

export class FileOpsFallback {
  constructor(filename) {
    this.filename = filename;
    this.dbName = this.filename.replace(/\//g, '-');
    this.cachedFirstBlock = null;
    this.blocks = new Map();
    this.writeQueue = [];
    this.lockType = 0;
  }

  async getDb() {
    if (this._openDb) {
      return this._openDb;
    }

    this._openDb = await openDb(this.dbName);
    return this._openDb;
  }

  closeDb() {
    if (this._openDb) {
      this._openDb.close();
      this._openDb = null;
    }
  }

  async readIfFallback() {
    // OK We need to fix this better - we don't block on the writes
    // being flushed from closing the file, and we can't read in
    // everything here because we might get old data. Need to track
    // the last write and force it to be sequential
    if (this.blocks.size > 0) {
      return;
    }

    let db = await this.getDb(this.dbName);

    let trans = db.transaction(['data'], 'readonly');
    let store = trans.objectStore('data');

    return new Promise((resolve, reject) => {
      // Open a cursor and iterate through the entire file
      let req = store.openCursor(IDBKeyRange.lowerBound(-1));
      req.onerror = reject;
      req.onsuccess = e => {
        let cursor = e.target.result;
        if (cursor) {
          this.blocks.set(cursor.key, cursor.value);
          cursor.continue();
        } else {
          resolve(this.readMeta());
        }
      };
    });
  }

  queueWrite(key, value) {
    this.writeQueue.push({ key, value });
  }

  // We need a snapshot of the current write + state in which it was
  // written. We do writes async, so we can't check this state over
  // time because it may change from underneath us
  prepareFlush() {
    let writeState = {
      cachedFirstBlock: this.cachedFirstBlock,
      writes: this.writeQueue,
      lockType: this.lockType
    };
    this.writeQueue = [];
    return writeState;
  }

  async flushWriteState(db, writeState) {
    // We need grab a readwrite lock on the db, and then read to check
    // to make sure we can write to it
    let trans = db.transaction(['data'], 'readwrite');
    let store = trans.objectStore('data');

    await new Promise((resolve, reject) => {
      let req = store.get(0);
      req.onsuccess = e => {
        if (writeState.lockType > LOCK_TYPES.NONE) {
          if (!isSafeToWrite(req.result, writeState.cachedFirstBlock)) {
            // TODO: We need to send a message to users somehow
            console.log("OH NO WE CAN'T WRITE");
            reject('screwed');
            return;
          }
        }

        // Flush all the writes
        for (let write of writeState.writes) {
          store.put(write.value, write.key);
        }

        trans.onsuccess = () => {
          resolve();
        };
        trans.onerror = () => {
          console.log('Flushing writes failed');
          reject();
        };
      };
      req.onerror = reject;
    });
  }

  lock(lockType) {
    // Locks always succeed here. Essentially we're only working
    // locally (we can't see any writes from anybody else) and we just
    // want to track the lock so we know when it downgrades from write
    // to read
    this.cachedFirstBlock = this.blocks.get(0);
    this.lockType = lockType;
    return true;
  }

  unlock(lockType) {
    if (this.lockType > LOCK_TYPES.SHARED && lockType === LOCK_TYPES.SHARED) {
      // Downgrading the lock from a write lock to a read lock. This
      // is where we actually flush out all the writes async if
      // possible
      let writeState = this.prepareFlush();
      this.getDb(this.dbName).then(db => this.flushWriteState(db, writeState));
    }
    this.lockType = lockType;
    return true;
  }

  delete() {
    let req = globalThis.indexedDB.deleteDatabase(this.dbName);
    req.onerror = () => {
      console.warn(`Deleting ${this.filename} database failed`);
    };
    req.onsuccess = () => {};
  }

  open() {}

  close() {
    // Clear out the in-memory data in close (it will have to be fully
    // read in before opening again)
    // this.buffer = null;

    if (this._openDb) {
      // The order is important here: we want to flush out any pending
      // writes, and we expect the db to open. We use that and then
      // immediately close it, but since we are going to close it we
      // don't want anything else to use that db connection. So we
      // clear it out and then close it later
      let db = this._openDb;
      this._openDb = null;

      let writeState = this.prepareFlush();
      this.flushWriteState(db, writeState).then(() => {
        db.close();
      });
    }
  }

  readMeta() {
    let metaBlock = this.blocks.get(-1);
    if (metaBlock) {
      let block = this.blocks.get(0);

      return {
        size: metaBlock.size,
        blockSize: getPageSize(new Uint8Array(block))
      };
    }
    return null;
  }

  writeMeta(meta) {
    this.blocks.set(-1, meta);
    this.queueWrite(-1, meta);
  }

  readBlocks(positions, blockSize) {
    if (this.blocks == null) {
      throw new Error(
        "File was opened, but not read yet. This environment doesn't support SharedArrayWorker, " +
          'so you must use `readIfFallback` to read the whole file into memory first'
      );
    }

    let res = [];
    for (let pos of positions) {
      res.push({
        pos,
        data: this.blocks.get(positionToKey(pos, blockSize))
      });
    }
    return res;
  }

  writeBlocks(writes, blockSize) {
    for (let write of writes) {
      let key = positionToKey(write.pos, blockSize);
      this.blocks.set(key, write.data);
      this.queueWrite(key, write.data);
    }
  }
}
