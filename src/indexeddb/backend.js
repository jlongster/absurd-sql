import { Reader, Writer } from './shared-channel';
import { File } from '../blocked-file';
import { startWorker } from './start-indexeddb-worker';

// These are temporarily global, but will be easy to clean up later
let reader, writer;

function positionToKey(pos, blockSize) {
  // We are forced to round because of floating point error. `pos`
  // should always be divisible by `blockSize`
  return Math.round(pos / blockSize);
}

function invokeWorker(method, args) {
  switch (method) {
    case 'stats-start': {
      writer.string('stats-start');
      writer.finalize();
      reader.int32();
      reader.done();
      break;
    }

    case 'stats': {
      writer.string('stats');
      writer.finalize();
      reader.int32();
      reader.done();
      break;
    }

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
        res.push({
          pos,
          // If th length is 0, the block didn't exist. We return a
          // blank block in that case
          data: data.byteLength === 0 ? new ArrayBuffer(blockSize) : data
        });
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
      writer.int32(args.lockType);
      writer.finalize();

      let res = reader.int32();
      reader.done();
      return res === 0;
    }

    case 'unlockFile': {
      writer.string('unlockFile');
      writer.string(args.name);
      writer.int32(args.lockType);
      writer.finalize();

      let res = reader.int32();
      reader.done();
      return res === 0;
    }
  }
}

class FileOps {
  constructor(filename) {
    this.filename = filename;
  }

  startStats() {
    return invokeWorker('stats-start');
  }

  stats() {
    return invokeWorker('stats');
  }

  getStoreName() {
    return this.filename.replace(/\//g, '-');
  }

  lock(lockType) {
    return invokeWorker('lockFile', { name: this.getStoreName(), lockType });
  }

  unlock(lockType) {
    return invokeWorker('unlockFile', { name: this.getStoreName(), lockType });
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
    // if (Math.random() < 0.005) {
    //   console.log('reading', positions);
    // }

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
    let argBuffer = new SharedArrayBuffer(4096 * 9);
    writer = new Writer(argBuffer, { name: 'args (backend)', debug: false });

    let resultBuffer = new SharedArrayBuffer(4096 * 9);
    reader = new Reader(resultBuffer, { name: 'results', debug: false });

    await startWorker(argBuffer, resultBuffer);
  }

  createFile(filename) {
    return new File(filename, this.defaultBlockSize, new FileOps(filename));
  }
}
