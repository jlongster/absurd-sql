import * as perf from 'perf-deets';

let FINALIZED = 0xdeadbeef;

let WRITEABLE = 0;
let READABLE = 1;

class Reader {
  constructor(
    buffer,
    { initialOffset = 4, useAtomics = true, stream = true, debug, name } = {}
  ) {
    this.buffer = buffer;
    this.atomicView = new Int32Array(buffer);
    this.offset = initialOffset;
    this.useAtomics = useAtomics;
    this.stream = stream;
    this.debug = debug;
    this.name = name;
  }

  log(...args) {
    if (this.debug) {
      console.log(`[reader: ${this.name}]`, ...args);
    }
  }

  waitWrite(name) {
    if (this.useAtomics) {
      this.log(`waiting for ${name}`);

      while (Atomics.load(this.atomicView, 0) === WRITEABLE) {
        // console.log('waiting for write...');
        Atomics.wait(this.atomicView, 0, WRITEABLE, 500);
      }

      this.log(`resumed for ${name}`);
    } else {
      if (this.atomicView[0] !== READABLE) {
        throw new Error('`waitWrite` expected array to be readable');
      }
    }
  }

  flip() {
    this.log('flip');
    if (this.useAtomics) {
      let prev = Atomics.compareExchange(
        this.atomicView,
        0,
        READABLE,
        WRITEABLE
      );

      if (prev !== READABLE) {
        throw new Error('Read data out of sync! This is disastrous');
      }

      Atomics.notify(this.atomicView, 0);
    } else {
      this.atomicView[0] = WRITEABLE;
    }

    this.offset = 4;
  }

  done() {
    this.waitWrite('done');

    let dataView = new DataView(this.buffer, this.offset);
    let done = dataView.getUint32(0) === FINALIZED;

    if (done) {
      this.log('done');
      this.flip();
    }

    return done;
  }

  peek(fn) {
    this.peekOffset = this.offset;
    let res = fn();
    this.offset = this.peekOffset;
    this.peekOffset = null;
    return res;
  }

  string() {
    this.waitWrite('string');

    let byteLength = this._int32();
    let length = byteLength / 2;

    let dataView = new DataView(this.buffer, this.offset, byteLength);
    let chars = [];
    for (let i = 0; i < length; i++) {
      chars.push(dataView.getUint16(i * 2));
    }
    let str = String.fromCharCode.apply(null, chars);
    this.log('string', str);

    this.offset += byteLength;

    if (this.peekOffset == null) {
      this.flip();
    }
    return str;
  }

  _int32() {
    let byteLength = 4;

    let dataView = new DataView(this.buffer, this.offset);
    let num = dataView.getInt32();
    this.log('_int32', num);

    this.offset += byteLength;
    return num;
  }

  int32() {
    this.waitWrite('int32');
    let num = this._int32();
    this.log('int32', num);

    if (this.peekOffset == null) {
      this.flip();
    }
    return num;
  }

  bytes() {
    this.waitWrite('bytes');

    let byteLength = this._int32();

    let bytes = new ArrayBuffer(byteLength);
    new Uint8Array(bytes).set(
      new Uint8Array(this.buffer, this.offset, byteLength)
    );
    this.log('bytes', bytes);

    this.offset += byteLength;

    if (this.peekOffset == null) {
      this.flip();
    }
    return bytes;
  }
}

class Writer {
  constructor(
    buffer,
    { initialOffset = 4, useAtomics = true, stream = true, debug, name } = {}
  ) {
    this.buffer = buffer;
    this.atomicView = new Int32Array(buffer);
    this.offset = initialOffset;
    this.useAtomics = useAtomics;
    this.stream = stream;

    this.debug = debug;
    this.name = name;

    if (this.useAtomics) {
      // The buffer starts out as writeable
      Atomics.store(this.atomicView, 0, WRITEABLE);
    } else {
      this.atomicView[0] = WRITEABLE;
    }
  }

  log(...args) {
    if (this.debug) {
      console.log(`[writer: ${this.name}]`, ...args);
    }
  }

  waitRead(name) {
    if (this.useAtomics) {
      this.log(`waiting for ${name}`);
      // Switch to writable
      // Atomics.store(this.atomicView, 0, 1);

      let prev = Atomics.compareExchange(
        this.atomicView,
        0,
        WRITEABLE,
        READABLE
      );

      if (prev !== WRITEABLE) {
        throw new Error(
          'Wrote something into unwritable buffer! This is disastrous'
        );
      }

      Atomics.notify(this.atomicView, 0);

      while (Atomics.load(this.atomicView, 0) === READABLE) {
        // console.log('waiting to be read...');
        Atomics.wait(this.atomicView, 0, READABLE, 500);
      }

      this.log(`resumed for ${name}`);
    } else {
      this.atomicView[0] = READABLE;
    }

    this.offset = 4;
  }

  finalize() {
    this.log('finalizing');
    let dataView = new DataView(this.buffer, this.offset);
    dataView.setUint32(0, FINALIZED);
    this.waitRead('finalize');
  }

  string(str) {
    this.log('string', str);

    let byteLength = str.length * 2;
    this._int32(byteLength);

    let dataView = new DataView(this.buffer, this.offset, byteLength);
    for (let i = 0; i < str.length; i++) {
      dataView.setUint16(i * 2, str.charCodeAt(i));
    }

    this.offset += byteLength;
    this.waitRead('string');
  }

  _int32(num) {
    let byteLength = 4;

    let dataView = new DataView(this.buffer, this.offset);
    dataView.setInt32(0, num);

    this.offset += byteLength;
  }

  int32(num) {
    this.log('int32', num);
    this._int32(num);
    this.waitRead('int32');
  }

  bytes(buffer) {
    this.log('bytes', buffer);

    let byteLength = buffer.byteLength;
    this._int32(byteLength);
    new Uint8Array(this.buffer, this.offset).set(new Uint8Array(buffer));

    this.offset += byteLength;
    this.waitRead('bytes');
  }
}

function range(start, end, step) {
  let r = [];
  for (let i = start; i <= end; i += step) {
    r.push(i);
  }
  return r;
}

function getBoundaryIndexes(blockSize, start, end) {
  let startC = start - (start % blockSize);
  let endC = end - 1 - ((end - 1) % blockSize);

  return range(startC, endC, blockSize);
}

function readChunks(chunks, start, end) {
  let buffer = new ArrayBuffer(end - start);
  let bufferView = new Uint8Array(buffer);
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];

    // TODO: jest has a bug where we can't do `instanceof ArrayBuffer`
    if (chunk.data.constructor.name !== 'ArrayBuffer') {
      throw new Error('Chunk data is not an ArrayBuffer');
    }

    let cstart = 0;
    let cend = chunk.data.byteLength;

    if (start > chunk.pos) {
      cstart = start - chunk.pos;
    }
    if (end < chunk.pos + chunk.data.byteLength) {
      cend = end - chunk.pos;
    }

    if (cstart > chunk.data.byteLength || cend < 0) {
      continue;
    }

    let len = cend - cstart;

    bufferView.set(
      new Uint8Array(chunk.data, cstart, len),
      chunk.pos - start + cstart
    );
  }

  return buffer;
}

function writeChunks(bufferView, blockSize, start, end) {
  let indexes = getBoundaryIndexes(blockSize, start, end);
  let cursor = 0;

  return indexes
    .map(index => {
      let cstart = 0;
      let cend = blockSize;
      if (start > index && start < index + blockSize) {
        cstart = start - index;
      }
      if (end > index && end < index + blockSize) {
        cend = end - index;
      }

      let len = cend - cstart;
      let chunkBuffer = new ArrayBuffer(blockSize);

      if (start > index + blockSize || end <= index) {
        return null;
      }

      let off = bufferView.byteOffset + cursor;

      let available = bufferView.buffer.byteLength - off;
      if (available <= 0) {
        return null;
      }

      let readLength = Math.min(len, available);

      new Uint8Array(chunkBuffer).set(
        new Uint8Array(bufferView.buffer, off, readLength),
        cstart
      );
      cursor += readLength;

      return {
        pos: index,
        data: chunkBuffer,
        offset: cstart,
        length: readLength
      };
    })
    .filter(Boolean);
}

class File {
  constructor(filename, defaultBlockSize, ops, meta = null) {
    this.filename = filename;
    this.defaultBlockSize = defaultBlockSize;
    this.buffer = new Map();
    this.ops = ops;
    this.meta = meta;
    this._metaDirty = false;
  }

  bufferChunks(chunks) {
    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i];
      this.buffer.set(chunk.pos, chunk);
    }
  }

  open() {
    this.meta = this.ops.readMeta();

    if (this.meta == null) {
      this.meta = {};

      // New file
      this.setattr({
        size: 0,
        blockSize: this.defaultBlockSize
      });

      this.fsync();
    }
  }

  close() {
    this.fsync();
    this.ops.close();
  }

  delete() {
    this.ops.delete();
  }

  load(indexes) {
    let status = indexes.reduce(
      (acc, b) => {
        let inMemory = this.buffer.get(b);
        if (inMemory) {
          acc.chunks.push(inMemory);
        } else {
          acc.missing.push(b);
        }
        return acc;
      },
      { chunks: [], missing: [] }
    );

    let missingChunks = [];
    if (status.missing.length > 0) {
      missingChunks = this.ops.readBlocks(status.missing, this.meta.blockSize);
    }
    return status.chunks.concat(missingChunks);
  }

  read(bufferView, offset, length, position) {
    // console.log('reading', this.filename, offset, length, position);
    let buffer = bufferView.buffer;

    if (length <= 0) {
      return 0;
    }
    if (position < 0) {
      // TODO: is this right?
      return 0;
    }
    if (position >= this.meta.size) {
      let view = new Uint8Array(buffer, offset);
      for (let i = 0; i < length; i++) {
        view[i] = 0;
      }

      return length;
    }

    perf.record('read');

    position = Math.max(position, 0);
    let dataLength = Math.min(length, this.meta.size - position);

    let start = position;
    let end = position + dataLength;

    let indexes = getBoundaryIndexes(this.meta.blockSize, start, end);

    let chunks = this.load(indexes);
    let readBuffer = readChunks(chunks, start, end);

    if (buffer.byteLength - offset < readBuffer.byteLength) {
      throw new Error('Buffer given to `read` is too small');
    }
    let view = new Uint8Array(buffer);
    view.set(new Uint8Array(readBuffer), offset);

    // TODO: I don't need to do this. `unixRead` does this for us.
    for (let i = dataLength; i < length; i++) {
      view[offset + i] = 0;
    }

    perf.endRecording('read');

    return length;
  }

  write(bufferView, offset, length, position) {
    // console.log('writing', this.filename, offset, length, position);
    let buffer = bufferView.buffer;

    if (length <= 0) {
      return 0;
    }
    if (position < 0) {
      return 0;
    }
    if (buffer.byteLength === 0) {
      return 0;
    }

    length = Math.min(length, buffer.byteLength - offset);

    let writes = writeChunks(
      new Uint8Array(buffer, offset, length),
      this.meta.blockSize,
      position,
      position + length
    );

    // Find any partial chunks and read them in and merge with
    // existing data
    let { partialWrites, fullWrites } = writes.reduce(
      (state, write) => {
        if (write.length !== this.meta.blockSize) {
          state.partialWrites.push(write);
        } else {
          state.fullWrites.push({
            pos: write.pos,
            data: write.data
          });
        }
        return state;
      },
      { fullWrites: [], partialWrites: [] }
    );

    let reads = [];
    if (partialWrites.length > 0) {
      reads = this.load(partialWrites.map(w => w.pos));
    }

    let allWrites = fullWrites.concat(
      reads.map(read => {
        let write = partialWrites.find(w => w.pos === read.pos);

        // MuTatIoN!
        new Uint8Array(read.data).set(
          new Uint8Array(write.data, write.offset, write.length),
          write.offset,
          write.length
        );

        return read;
      })
    );

    this.bufferChunks(allWrites);

    if (position + length > this.meta.size) {
      this.setattr({ size: position + length });
    }

    return length;
  }

  lock(lockType) {
    return this.ops.lock(lockType);
  }

  unlock(lockType) {
    return this.ops.unlock(lockType);
  }

  fsync() {
    if (this.buffer.size > 0) {
      this.ops.writeBlocks([...this.buffer.values()], this.meta.blockSize);
    }

    if (this._metaDirty) {
      this.ops.writeMeta(this.meta);
      this._metaDirty = false;
    }

    this.buffer = new Map();
  }

  setattr(attr) {
    if (attr.mode !== undefined) {
      this.meta.mode = attr.mode;
      this._metaDirty = true;
    }

    if (attr.timestamp !== undefined) {
      this.meta.timestamp = attr.timestamp;
      this._metaDirty = true;
    }

    if (attr.size !== undefined) {
      this.meta.size = attr.size;
      this._metaDirty = true;
    }

    if (attr.blockSize !== undefined) {
      if (this.meta.blockSize != null) {
        throw new Error('Changing blockSize is not allowed yet');
      }
      this.meta.blockSize = attr.blockSize;
      this._metaDirty = true;
    }
  }

  getattr() {
    return this.meta;
  }
}

// These are temporarily global, but will be easy to clean up later
let reader, writer;

function positionToKey(pos, blockSize) {
  // We are forced to round because of floating point error. `pos`
  // should always be divisible by `blockSize`
  return Math.round(pos / blockSize);
}

function invokeWorker(method, args) {
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

class FileOps {
  constructor(filename) {
    this.filename = filename;
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
    return invokeWorker('deleteFile', { name: this.getStoreName() });
  }

  close() {
    return invokeWorker('closeFile', { name: this.getStoreName() });
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

function startWorker(reader, writer) {
  let onReady;
  let workerReady = new Promise(resolve => (onReady = resolve));

  self.postMessage({
    type: '__absurd:spawn-idb-worker',
    argBuffer: writer.buffer,
    resultBuffer: reader.buffer
  });

  self.addEventListener('message', e => {
    switch (e.data.type) {
      case '__absurd:worker-ready':
        onReady();
        break;

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

      case '__perf-deets:end-profile':
        writer.string('profile-end');
        writer.finalize();
        reader.int32();
        reader.done();
        break;
    }
  });

  return workerReady;
}

class IndexedDBBackend {
  constructor(defaultBlockSize) {
    this.defaultBlockSize = defaultBlockSize;
  }

  async init() {
    let argBuffer = new SharedArrayBuffer(4096 * 9);
    writer = this.writer = new Writer(argBuffer, {
      name: 'args (backend)',
      debug: false
    });

    let resultBuffer = new SharedArrayBuffer(4096 * 9);
    reader = new Reader(resultBuffer, {
      name: 'results',
      debug: false
    });

    await startWorker(reader, writer);
  }

  createFile(filename) {
    return new File(filename, this.defaultBlockSize, new FileOps(filename));
  }

  // Instead of controlling the profiler from the main thread by
  // posting a message to this worker, you can control it inside the
  // worker manually with these methods
  startProfile() {
    perf.start();
    writer.string('profile-start');
    writer.finalize();
    reader.int32();
    reader.done();
  }

  stopProfile() {
    perf.stop();
    writer.string('profile-stop');
    writer.finalize();
    reader.int32();
    reader.done();
  }
}

export default IndexedDBBackend;
