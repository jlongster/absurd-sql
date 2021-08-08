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
    this.lockType = null;
  }

  async readIfFallback() {
    this.db = await openDb(this.dbName);

    let trans = this.db.transaction(['data'], 'readonly');
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
          this.cachedFirstBlock = this.blocks.get(0);
          resolve();
        }
      };
    });
  }

  queueWrite(key, value) {
    this.writeQueue.push({ key, value });
  }

  async flushWrites() {
    // We need grab a readwrite lock on the db, and then read to check
    // to make sure we can write to it
    let trans = this.db.transaction(['data'], 'readwrite');
    let store = trans.objectStore('data');

    await new Promise((resolve, reject) => {
      let req = store.get(0);
      req.onsuccess = e => {
        if (
          !isSafeToWrite(
            new Uint8Array(req.result),
            new Uint8Array(this.cachedFirstBlock)
          )
        ) {
          console.log('SCREWED');
          reject('screwed');
          return;
        }

        // Flush all the writes
        for (let write of this.writeQueue) {
          store.put(write.value, write.key);

          if (write.key === 0) {
            this.cachedFirstBlock = write.value;
          }
        }

        trans.onsuccess = () => {
          resolve();
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
    this.lockType = lockType;
    return true;
  }

  unlock(lockType) {
    if (this.lockType > LOCK_TYPES.SHARED && lockType === LOCK_TYPES.SHARED) {
      // Downgrading the lock from a write lock to a read lock. This
      // is where we actually flush out all the writes async if
      // possible
      this.flushWrites();
    }
    return true;
  }

  delete() {}

  open() {}

  close() {
    // Clear out the in-memory data in close (it will have to be fully
    // read in before opening again)
    this.buffer = null;
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
