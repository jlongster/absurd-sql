import { Reader, Writer } from './serialize';
import { File } from './virtual-file';
import { startWorker } from './start-indexeddb-worker';

let argBuffer = new SharedArrayBuffer(4096 * 9);
let writer = new Writer(argBuffer, { name: 'args (backend)', debug: false });

let resultBuffer = new SharedArrayBuffer(4096 * 9);
let reader = new Reader(resultBuffer, { name: 'results', debug: false });

function positionToKey(pos, blockSize) {
  // We are forced to round because of floating point error. `pos`
  // should always be divisible by `blockSize`
  return Math.round(pos / blockSize);
}

function invokeWorker(method, args) {
  // console.log('invoking', method, args);
  switch (method) {
    case 'readBlocks': {
      let { name, positions, blockSize } = args;

      let res = [];
      for (let pos of positions) {
        writer.string('readBlock');
        writer.string(name);
        writer.int32(positionToKey(pos, blockSize));
        writer.finalize();

        let data = reader.bytes();
        reader.done();
        res.push({ pos, data });
      }

      return res;
    }

    case 'writeBlocks': {
      let { name, writes, blockSize } = args;
      writer.string('writeBlocks');
      writer.string(name);
      for (let write of writes) {
        writer.int32(positionToKey(write.pos, blockSize));
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

  readBlocks(positions, blockSize) {
    if (Math.random() < 0.005) {
      console.log('reading', positions);
    }

    if (this.stats) {
      this.stats.read += positions.length;
    }

    return invokeWorker('readBlocks', {
      name: this.getStoreName(),
      positions,
      blockSize
    });
  }

  writeBlocks(writes, blockSize) {
    // console.log('_writing', this.filename, writes);
    if (this.stats) {
      this.stats.writes += writes.length;
    }

    return invokeWorker('writeBlocks', {
      name: this.getStoreName(),
      writes,
      blockSize
    });
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
