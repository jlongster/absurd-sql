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

function invokeWorker() {}

export default class IndexedDBBackend {
  constructor(defaultChunkSize) {
    this.files = {};
    this.defaultChunkSize = defaultChunkSize;
  }

  async init() {
    await startWorker();
  }

  getFile(fileName) {
    return this.files[fileName];
  }

  getOrCreateFile(fileName) {
    if (this.files[fileName] == null) {
      this.files[fileName] = { data: new ArrayBuffer(0), size: 0 };
    }
    return this.files[fileName];
  }

  deleteFile(fileName) {
    this.files[fileName] = null;
  }

  lockFile(fileName) {
    if (this.locks.get(fileName)) {
      console.log('false');
      return false;
    }
    this.locks.set(fileName, true);
    console.log('returning true');
    return true;
  }

  unlockFile(fileName) {
    this.locks.set(fileName, false);
  }

  readMeta(fileName, defaultMeta) {
    let exists = this.getFile(fileName) != null;
    let file = this.getOrCreateFile(fileName);
    return exists
      ? { size: file.data.byteLength, chunkSize: this.defaultChunkSize }
      : defaultMeta;
  }

  writeMeta(fileName, meta) {
    let file = this.getOrCreateFile(fileName);
    file.size = meta.size;
  }

  readChunks(fileName, positions, chunkSize) {
    console.log('_reading', fileName, positions);
    // if (positions.length > 0) {
    //   console.log('reading', positions);
    // }
    let data = this.files[fileName].data;

    return positions.map(pos => {
      let buffer = new ArrayBuffer(chunkSize);

      if (pos < data.byteLength) {
        new Uint8Array(buffer).set(
          new Uint8Array(data, pos, Math.min(chunkSize, data.byteLength - pos))
        );
      }

      return { pos, data: buffer };
    });
  }

  writeChunks(fileName, writes) {
    console.log('_writing', fileName, writes);
    // if (writes.length > 0) {
    //   console.log('writing', writes.map(w => w.pos));
    // }
    let file = this.getOrCreateFile(fileName);
    let data = file.data;

    for (let write of writes) {
      let fullLength = write.pos + write.data.byteLength;

      if (fullLength > data.byteLength) {
        // Resize file
        let buffer = new ArrayBuffer(fullLength);
        new Uint8Array(buffer).set(new Uint8Array(data));
        this.files[fileName].data = data = buffer;
      }

      new Uint8Array(data).set(new Uint8Array(write.data), write.pos);
    }
  }
}
