import { File } from './virtual-file';

let resultSab = new SharedArrayBuffer(10000);
let invokeSab = new SharedArrayBuffer(10000);

let worker;
let workerReady;
function startWorker() {
  worker = new Worker('syncify.js');

  let onReady;
  workerReady = new Promise(resolve => (onReady = resolve));

  worker.onmessage = msg => {
    switch (msg.data.type) {
      case 'syncify-ready':
        onReady();
    }
  };

  return workerReady;
}

function invokeWorker(name, args) {
}

class FileOps {
  constructor(filename, meta = null) {
    this.filename = filename;
    this.meta = meta;
  }

  getStoreName() {
    // TODO: better sanitization
    return this.filename.replace(/\//g, '-');
  }

  lock() {
    return invokeWorker('lockFile', { name: this.getStoreName() });
  }

  unlock() {
    return invokeWorker('unlockFile', { name: this.getStoreName() });
  }

  delete() {
    invokeWorker('deleteFile', { name: this.getStoreName() });
  }

  readMeta() {
    return invokeWorker('readMeta', { name: this.getStoreName() });
  }

  writeMeta(meta) {
    return invokeWorker('writeMeta', { name: this.getStoreName(), meta });
    // this.meta.size = meta.size;
    // this.meta.blockSize = meta.blockSize;
  }

  readBlocks(positions) {
    console.log('_reading', this.filename, positions);
    return invokeWorker('readBlocks', { name: this.getStoreName(), positions });
  }

  writeBlocks(writes) {
    console.log('_writing', this.filename, writes);
    return invokeWorker('writeBlocks', { name: this.getStoreName(), writes });
  }
}

export default class IndexedDBBackend {
  constructor(defaultBlockSize, fileData) {
    this.files = {};
    this.defaultBlockSize = defaultBlockSize;
  }

  async init() {
    await startWorker();
  }

  // lookupFile() {
  // }

  createFile(filename) {
    let meta = invokeWorker('readMeta', { filename });
    return new File(filename, new FileOps(filename, meta));
  }
}
