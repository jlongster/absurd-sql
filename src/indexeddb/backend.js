import { Reader, Writer } from './shared-channel';
import { File } from '../blocked-file';
import * as perf from 'perf-deets';

// These are temporarily global, but will be easy to clean up later
let reader, writer;

function positionToKey(pos, blockSize) {
  // We are forced to round because of floating point error. `pos`
  // should always be divisible by `blockSize`
  return Math.round(pos / blockSize);
}

function startWorker(reader, writer) {
  // In a normal world, we'd spawn the worker here as a child worker.
  // However Safari doesn't support nested workers, so we have to
  // proxy them through the main thread
  self.postMessage({
    type: '__absurd:spawn-idb-worker',
    argBuffer: writer.buffer,
    resultBuffer: reader.buffer
  });

  self.addEventListener('message', e => {
    switch (e.data.type) {
      // case '__absurd:worker-ready':
      //   onReady();
      //   break;

      // Normally you would use `postMessage` control the profiler in
      // a worker (just like this worker go those events), and the
      // perf library automatically handles those events. We don't do
      // that for the special backend worker though because it's
      // always blocked when it's not processing. Instead we forward
      // these events by going through the atomics layer to unblock it
      // to make sure it starts immediately
      case '__perf-deets:start-profile':
        writer.string('profile-start');
        writer.finalize();
        reader.int32();
        reader.done();
        break;

      case '__perf-deets:stop-profile':
        writer.string('profile-stop');
        writer.finalize();
        reader.int32();
        reader.done();
        break;
    }
  });
}

class FileOps {
  constructor(filename) {
    this.filename = filename;
  }

  // TODO: This should be renamed to `getDatabaseName`
  getStoreName() {
    return this.filename.replace(/\//g, '-');
  }

  invokeWorker(method, args) {
    if (this.reader == null || this.writer == null) {
      throw new Error(
        `Attempted ${method} on ${this.filename} but file not open`
      );
    }

    let reader = this.reader;
    let writer = this.writer;

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

      case 'closeFile': {
        writer.string('closeFile');
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

  lock(lockType) {
    return this.invokeWorker('lockFile', {
      name: this.getStoreName(),
      lockType
    });
  }

  unlock(lockType) {
    return this.invokeWorker('unlockFile', {
      name: this.getStoreName(),
      lockType
    });
  }

  delete() {
    // Close the file if it's open
    if (this.reader || this.writer) {
      this.close();
    }

    let req = globalThis.indexedDB.deleteDatabase(this.getStoreName());
    req.onerror = () => {
      console.warn(`Deleting ${this.filename} database failed`);
    };
  }

  open() {
    let argBuffer = new SharedArrayBuffer(4096 * 9);
    this.writer = new Writer(argBuffer, {
      name: 'args (backend)',
      debug: false
    });

    let resultBuffer = new SharedArrayBuffer(4096 * 9);
    this.reader = new Reader(resultBuffer, {
      name: 'results',
      debug: false
    });

    // TODO: We could pool workers and reuse them so opening files
    // aren't so slow
    startWorker(this.reader, this.writer);
  }

  close() {
    this.invokeWorker('closeFile', { name: this.getStoreName() });
    this.reader = null;
    this.writer = null;
    this.worker = null;
  }

  readMeta() {
    return this.invokeWorker('readMeta', { name: this.getStoreName() });
  }

  writeMeta(meta) {
    return this.invokeWorker('writeMeta', { name: this.getStoreName(), meta });
  }

  readBlocks(positions, blockSize) {
    if (this.stats) {
      this.stats.read += positions.length;
    }

    return this.invokeWorker('readBlocks', {
      name: this.getStoreName(),
      positions,
      blockSize
    });
  }

  writeBlocks(writes, blockSize) {
    if (this.stats) {
      this.stats.writes += writes.length;
    }

    return this.invokeWorker('writeBlocks', {
      name: this.getStoreName(),
      writes,
      blockSize
    });
  }
}

export default class IndexedDBBackend {
  createFile(filename) {
    let file = new File(filename, new FileOps(filename));

    // If we don't need perf data, there's no reason for us to hold a
    // reference to the files. If we did we'd have to worry about
    // memory leaks
    if (process.env.NODE_ENV !== 'production' || process.env.PERF_BUILD) {
      if (this._files == null) {
        this._files = new Set();
      }
      this._files.add(file);
    }

    return file;
  }

  // Instead of controlling the profiler from the main thread by
  // posting a message to this worker, you can control it inside the
  // worker manually with these methods
  startProfile() {
    perf.start();
    for (let file of this._files) {
      // If the writer doesn't exist, that means the file has been
      // deleted
      if (file.ops.writer) {
        let writer = file.ops.writer;
        let reader = file.ops.reader;
        writer.string('profile-start');
        writer.finalize();
        reader.int32();
        reader.done();
      }
    }
  }

  stopProfile() {
    perf.stop();
    for (let file of this._files) {
      if (file.ops.writer) {
        let writer = file.ops.writer;
        let reader = file.ops.reader;
        writer.string('profile-stop');
        writer.finalize();
        reader.int32();
        reader.done();
      }
    }
  }
}
