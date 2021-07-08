import { Reader, Writer } from './serialize';
// import { FileOps } from './backend-memory';

let _db = null;

async function getDb() {
  return new Promise((resolve, reject) => {
    if (_db) {
      resolve(_db);
    } else {
      let req = indexedDB.open('sqlite3', 3);
      req.onsuccess = event => {
        _db = event.target.result;
        resolve(_db);
      };
      req.onupgradeneeded = event => {
        let db = event.target.result;
        db.createObjectStore('db3.sqlite', { keyPath: 'key' });
      };
      req.onerror = req.onabort = e => reject(e.target.error);
    }
  });
}

async function getStore(name) {
  let db = await getDb();

  // if (!db.objectStoreNames.contains(name)) {
  //   db.createObjectStore(name, { keyPath: 'key' });
  // }

  let trans = db.transaction([name], 'readwrite');
  return { trans, store: trans.objectStore(name) };
}

async function get(store, key, mapper) {
  return new Promise((resolve, reject) => {
    let req = store.get(key);
    req.onsuccess = e => resolve(mapper(req.result));
    req.onerror = e => reject(e);
  });
}

async function set(store, item) {
  return new Promise((resolve, reject) => {
    let req = store.put(item);
    req.onsuccess = e => resolve(req.result);
    req.onerror = e => reject(e);
  });
}

async function bulkSet(trans, store, items) {
  console.log('setting', items.length);
  await new Promise((resolve, reject) => {
    for (let item of items) {
      store.put(item);
    }

    trans.oncomplete = e => resolve();
    trans.onerror = e => reject(e);
  });
}

async function handleReads(writer, name, positions) {
  let { store } = await getStore(name);

  let data = await Promise.all(
    positions.map(pos =>
      get(store, pos, data => ({
        pos,
        data: data ? data.value : new ArrayBuffer(4096 * 8)
      }))
    )
  );

  for (let read of data) {
    writer.int32(read.pos);
    writer.bytes(read.data);
  }
  writer.finalize();
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
  let { store } = await getStore(name);

  try {
    let res = await get(store, -1);
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
  let { store } = await getStore(name);

  try {
    await set(store, { key: -1, value: meta });

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

async function listen(argBuffer, resultBuffer) {
  let reader = new Reader(argBuffer, { name: 'args', debug: false });
  let writer = new Writer(resultBuffer, { name: 'results', debug: false });

  // eslint-disable-next-line
  while (1) {
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
        break;
      }

      case 'readBlocks': {
        let name = reader.string();
        let positions = [];
        while (!reader.done()) {
          let pos = reader.int32();
          positions.push(pos);
        }

        await handleReads(writer, name, positions);
        break;
      }

      case 'readMeta': {
        let name = reader.string();
        reader.done();
        await handleReadMeta(writer, name);
        break;
      }

      case 'writeMeta': {
        let name = reader.string();
        let size = reader.int32();
        let blockSize = reader.int32();
        reader.done();
        await handleWriteMeta(writer, name, { size, blockSize });
        break;
      }

      case 'deleteFile': {
        let name = reader.string();
        reader.done();

        await handleDeleteFile(writer, name);
        break;
      }

      case 'lockFile': {
        let name = reader.string();
        reader.done();

        // Noop
        writer.int32(0);
        writer.finalize();
        break;
      }

      case 'unlockFile': {
        let name = reader.string();
        reader.done();

        // Noop
        writer.int32(0);
        writer.finalize();
        break;
      }

      default:
        throw new Error('Unknown method: ' + method);
    }
  }
}

self.onmessage = msg => {
  postMessage({ type: 'worker-ready' });

  let [argBuffer, resultBuffer] = msg.data;
  listen(argBuffer, resultBuffer);
};
