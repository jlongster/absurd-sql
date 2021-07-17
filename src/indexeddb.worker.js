import { Reader, Writer } from './serialize';

let idb = globalThis.indexedDB;

let openDbs = new Map();

async function loadDb(name) {
  return new Promise((resolve, reject) => {
    if (openDbs.get(name)) {
      resolve(openDbs.get(name));
      return;
    }

    let req = idb.open(name, 1);
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
        db.createObjectStore('data', { keyPath: 'key' });
      }
    };
    req.onblocked = e => console.log('blocked', e);
    req.onerror = req.onabort = e => reject(e.target.error);
  });
}

async function getStore(name, mode) {
  let db = await loadDb(name);
  let trans = db.transaction(['data'], mode || 'readwrite');
  return { trans, store: trans.objectStore('data') };
}

async function get(store, key, mapper = x => x) {
  return new Promise((resolve, reject) => {
    let req = store.get(key);
    req.onsuccess = e => {
      resolve(mapper(req.result));
    };
    req.onerror = e => reject(e);
  });
}

async function makeCursor(store, start, dir = 'next', cb) {
  let keyRange;
  if (dir === 'prev') {
    keyRange = IDBKeyRange.upperBound(start);
  } else {
    keyRange = IDBKeyRange.lowerBound(start);
  }

  let req = store.openCursor(keyRange, dir);
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
}

async function set(store, item) {
  return new Promise((resolve, reject) => {
    let req = store.put(item);
    req.onsuccess = e => resolve(req.result);
    req.onerror = e => reject(e);
  });
}

async function bulkSet(trans, store, items) {
  await new Promise((resolve, reject) => {
    for (let item of items) {
      store.put(item);
    }

    trans.oncomplete = e => resolve();
    trans.onerror = e => reject(e);
  });
}

async function handleRead(writer, name, position, prevPos, cb) {
  let { trans, store } = await getStore(name, 'readonly');

  let dir = prevPos > position ? 'prev' : 'next';

  makeCursor(store, position, dir, cursor => {
    if (cursor) {
      let data = cursor ? cursor.value : null;

      if (cursor == null) {
        writer.bytes(new ArrayBuffer(4096 * 4));
      } else {
        writer.bytes(data.value);
      }
      writer.finalize();

      cb(cursor);
    }
  });
}

async function handleWrites(writer, name, writes) {
  let { trans, store } = await getStore(name);

  try {
    await bulkSet(
      trans,
      store,
      writes.map(w => ({ key: w.pos, value: w.data }))
    );

    writer.int32(0);
    writer.finalize();
  } catch (err) {
    console.log(err);
    writer.int32(-1);
    writer.finalize();
  }
}

async function handleReadMeta(writer, name) {
  let { trans, store } = await getStore(name);
  let oncomplete = new Promise(resolve => (trans.oncomplete = resolve));

  try {
    console.log('getting meta');
    let res = await get(store, -1);

    if (trans.commit) {
      trans.commit();
    } else {
      await oncomplete;
    }

    console.log('getting meta (done)');
    let meta = res && res.value;
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
  let { trans, store } = await getStore(name);
  let oncomplete = new Promise(resolve => (trans.oncomplete = resolve));

  try {
    console.log('setting meta', meta);
    await set(store, { key: -1, value: meta });

    if (trans.commit) {
      trans.commit();
    } else {
      await oncomplete;
    }

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
        handleRead(writer, name, pos, prevPos, cursor => {
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
              if (cursor.direction === 'next' && nextPos > cursor.key) {
                // console.log('SUCCESS');
                cursor.advance(nextPos - cursor.key);
              } else if (cursor.direction === 'prev' && nextPos < cursor.key) {
                cursor.advance(cursor.key - nextPos);
              } else {
                // console.log('FAIL');
                console.log(cursor.request);
                let trans = cursor.request.transaction;
                if (trans.commit) {
                  trans.commit();
                }

                streamRead(writer, name, nextPos, pos);
              }
            } else {
              streamRead(writer, name, nextPos, pos);
            }
          } else {
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
      reader.done();

      // Noop
      writer.int32(0);
      writer.finalize();

      listen(reader, writer);
      break;
    }

    case 'unlockFile': {
      let name = reader.string();
      reader.done();

      // Noop
      writer.int32(0);
      writer.finalize();

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
