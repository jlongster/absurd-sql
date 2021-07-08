import BlockedFS from '../blockedfs';
import IndexedDBBackend from '../backend-indexeddb';

let backend = new IndexedDBBackend(256);
let dbFile;

async function init() {
  await backend.init();
  dbFile = backend.createFile('foo.db');
  dbFile.open();
}

function write() {
  let buffer = new ArrayBuffer(100);
  let view = new Uint8Array(buffer);
  for (let i = 0; i < 100; i++) {
    view[i] = i;
  }

  let res = dbFile.write(view, 0, 100, 129);
  dbFile.fsync();
}

function read() {
  let buffer = new ArrayBuffer(100);
  dbFile.read(new Uint8Array(buffer), 0, 100, 120);
  console.log(buffer)
}

self.onmessage = msg => {
  switch (msg.data.type) {
    case 'init':
      init();
      break;
    case 'write':
      write();
      break;
    case 'read':
      read();
      break;
  }
};
