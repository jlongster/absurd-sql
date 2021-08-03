import * as perf from './perf';

function range(start, end, step) {
  let r = [];
  for (let i = start; i <= end; i += step) {
    r.push(i);
  }
  return r;
}

export function getBoundaryIndexes(blockSize, start, end) {
  let startC = start - (start % blockSize);
  let endC = end - 1 - ((end - 1) % blockSize);

  return range(startC, endC, blockSize);
}

export function readChunks(chunks, start, end) {
  let buffer = new ArrayBuffer(end - start);
  let bufferView = new Uint8Array(buffer);

  let cursor = 0;
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
    cursor += len;
  }

  return buffer;
}

export function writeChunks(bufferView, blockSize, start, end) {
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

export class File {
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
    this.ops.close()
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

  startStats() {
    this.ops.startStats();
  }

  stats() {
    perf.end();
    this.ops.stats();
  }
}
