import { Reader, Writer } from './serialize';

console.log('IDB WORKER');

let idb = globalThis.indexedDB;

let _db = null;

let requests = [];

function getDb() {
  return _db;
}

async function loadDb() {
  return new Promise((resolve, reject) => {
    if (_db) {
      resolve();
    }

    let req = idb.open('sqlite3', 5);
    req.onsuccess = event => {
      console.log('db is open!');
      _db = event.target.result;

      _db.onversionchange = () => {
        _db.close();
      };

      resolve(_db);
    };
    req.onupgradeneeded = event => {
      let db = event.target.result;
      // db.createObjectStore('db3.sqlite', { keyPath: 'key' });
    };
    req.onblocked = e => console.log('blocked', e);
    req.onerror = req.onabort = e => reject(e.target.error);
  });
}

async function getStore(name) {
  let db = getDb();

  // if (!db.objectStoreNames.contains(name)) {
  //   db.createObjectStore(name, { keyPath: 'key' });
  // }

  let trans = db.transaction([name], 'readwrite');
  requests.push(trans);

  return { trans, store: trans.objectStore(name) };
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

async function handleReads(writer, name, positions) {
  let { trans, store } = await getStore(name);
  let oncomplete = new Promise(resolve => (trans.oncomplete = resolve));

  let start = Date.now();
  let data = await Promise.all(
    positions.map(pos =>
      get(store, pos, data => ({
        pos,
        data: data ? data.value : new ArrayBuffer(4096 * 8)
      }))
    )
  );
  // console.log('result', Date.now() - start);

  // requests = requests.filter(r => r !== trans);
  if (trans.commit) {
    trans.commit();
  } else {
    await oncomplete;
  }

  if (data[0].pos === 0) {
    let a = new Uint8Array(data[0].data);
    console.log(a[0].toString(16));
    console.log(a[1].toString(16));
    console.log(a[2].toString(16));
    console.log(a[3].toString(16));
  }

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
  console.log('listening');

  // eslint-disable-next-line
  await loadDb();

  while (1) {
    // reader.wait('loop', 10000);
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
  switch (msg.data.type) {
    case 'init': {
      postMessage({ type: 'worker-ready' });
      let [argBuffer, resultBuffer] = msg.data.buffers;
      listen(argBuffer, resultBuffer);
      break;
    }

    case 'abort': {
      console.log('aborting', requests.length);
      requests.forEach(r => r.abort());
    }
  }
};
