import { Reader, Writer } from './serialize';
import { File } from './virtual-file';
import { startWorker } from './start-indexeddb-worker';

let argBuffer = new SharedArrayBuffer(4096 * 9);
let writer = new Writer(argBuffer, { name: 'args', debug: false });

let resultBuffer = new SharedArrayBuffer(4096 * 9);
let reader = new Reader(resultBuffer, { name: 'results', debug: false });

function invokeWorker(method, args) {
  // console.log('invoking', method, args);
  switch (method) {
    case 'readBlocks': {
      let { name, positions } = args;
      writer.string('readBlocks');
      writer.string(name);
      for (let pos of positions) {
        writer.int32(pos);
      }
      writer.finalize();

      let res = [];
      while (!reader.done()) {
        let pos = reader.int32();
        let data = reader.bytes();
        res.push({ pos, data });
      }

      return res;
    }

    case 'writeBlocks': {
      let { name, writes } = args;
      writer.string('writeBlocks');
      writer.string(name);
      for (let write of writes) {
        writer.int32(write.pos);
        writer.bytes(write.data);
      }
      writer.finalize();

      // Block for empty response

      let res = reader.int32();
      reader.done();
      return res;
    }

    case 'readMeta': {
      writer.string('readMeta');
      writer.string(args.name);
      writer.finalize();

      let size = reader.int32();
      let blockSize = reader.int32();
      reader.done();
      return size === -1 ? null : { size, blockSize };
    }

    case 'writeMeta': {
      let { name, meta } = args;
      writer.string('writeMeta');
      writer.string(name);
      writer.int32(meta.size);
      writer.int32(meta.blockSize);
      writer.finalize();

      let res = reader.int32();
      reader.done();
      return res;
    }

    case 'deleteFile': {
      writer.string('deleteFile');
      writer.string(args.name);
      writer.finalize();

      let res = reader.int32();
      reader.done();
      return res;
    }

    case 'lockFile': {
      writer.string('lockFile');
      writer.string(args.name);
      writer.finalize();

      let res = reader.int32();
      reader.done();
      return res === 0;
    }

    case 'unlockFile': {
      writer.string('unlockFile');
      writer.string(args.name);
      writer.finalize();

      let res = reader.int32();
      reader.done();
      return res;
    }
  }
}

class FileOps {
  constructor(filename) {
    this.filename = filename;
  }

  startStats() {
    this.stats = {
      read: 0,
      write: 0
    };
  }

  endStats() {
    let stats = this.stats;
    this.stats = {};
    return stats;
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
  }

  readBlocks(positions) {
    // console.log('_reading', this.filename, positions);
    if (Math.random() < 0.01) {
      console.log('reading');
    }

    if (this.stats) {
      this.stats.read += positions.length;
    }

    return invokeWorker('readBlocks', {
      name: this.getStoreName(),
      positions
    });
  }

  writeBlocks(writes) {
    // console.log('_writing', this.filename, writes);
    if (this.stats) {
      this.stats.writes += writes.length;
    }

    return invokeWorker('writeBlocks', { name: this.getStoreName(), writes });
  }
}

export default class IndexedDBBackend {
  constructor(defaultBlockSize) {
    this.defaultBlockSize = defaultBlockSize;
  }

  async init() {
    await startWorker(argBuffer, resultBuffer);
  }

  // lookupFile() {
  // }

  createFile(filename) {
    // let meta = invokeWorker('readMeta', { filename });
    return new File(filename, this.defaultBlockSize, new FileOps(filename));
  }
}
