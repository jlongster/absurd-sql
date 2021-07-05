function range(start, end, step) {
  let r = [];
  for (let i = start; i <= end; i += step) {
    r.push(i);
  }
  return r;
}

export function getBoundaryIndexes(chunkSize, start, end) {
  let startC = start - (start % chunkSize);
  let endC = end - 1 - ((end - 1) % chunkSize);

  return range(startC, endC, chunkSize);
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

    bufferView.set(new Uint8Array(chunk.data, cstart, len), cursor);
    cursor += len;
  }

  return buffer;
}

export function writeChunks(bufferView, chunkSize, start, end) {
  let indexes = getBoundaryIndexes(chunkSize, start, end);
  let cursor = 0;

  return indexes
    .map(index => {
      let cstart = 0;
      let cend = chunkSize;
      if (start > index && start < index + chunkSize) {
        cstart = start - index;
      }
      if (end > index && end < index + chunkSize) {
        cend = end - index;
      }

      let len = cend - cstart;
      let chunkBuffer = new ArrayBuffer(chunkSize);

      if (start > index + chunkSize || end <= index) {
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
  constructor(fileName, chunkSize, backend) {
    this.fileName = fileName;
    this.chunkSize = chunkSize;
    this.buffer = [];
    this.backend = backend;
    this.snapshots = [];

    if (chunkSize <= 0) {
      throw new Error('Invalid chunk size: ' + chunkSize);
    }
  }

  bufferChunks(chunks) {
    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i];
      this.buffer.push(chunk);
    }
  }

  open() {
    this.meta = this.backend.readMeta(this.fileName, {
      size: 0,
      chunkSize: this.chunkSize
    });
  }

  close() {
    this.fsync();
  }

  load(indexes) {
    let status = indexes.reduce(
      (acc, b) => {
        let buffer = [...this.buffer].reverse();
        let inMemory = buffer.find(c => c.pos === b);
        if (inMemory) {
          acc.chunks.push(inMemory);
        } else {
          acc.missing.push(b);
        }
        return acc;
      },
      { chunks: [], missing: [] }
    );

    let missingChunks = this.backend.readChunks(
      this.fileName,
      status.missing,
      this.chunkSize
    );

    return status.chunks.concat(missingChunks);
  }

  read(bufferView, offset, length, position) {
    console.log('reading', this.fileName, offset, length, position);
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

    position = Math.max(position, 0);
    let dataLength = Math.min(length, this.meta.size - position);

    let start = position;
    let end = position + dataLength;

    let indexes = getBoundaryIndexes(this.chunkSize, start, end);

    let chunks = this.load(indexes);
    let readBuffer = readChunks(chunks, start, end);

    if (buffer.byteLength - offset < readBuffer.byteLength) {
      throw new Error('Buffer given to `read` is too small');
    }
    let view = new Uint8Array(buffer);
    view.set(new Uint8Array(readBuffer), offset);

    for (let i = dataLength; i < length; i++) {
      view[offset + i] = 0;
    }

    return length;
  }

  write(bufferView, offset, length, position) {
    console.log('writing', this.fileName, offset, length, position);

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
      this.chunkSize,
      position,
      position + length
    );

    // Find any partial chunks and read them in and merge with
    // existing data
    let { partialWrites, fullWrites } = writes.reduce(
      (state, write) => {
        if (write.length !== this.chunkSize) {
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

  startAtomicWrite() {
    this.snapshots.push(this.buffer.length);
  }

  commitAtomicWrite() {
    if (this.snapshots.length === 0) {
      throw new Error('committing without snapshot');
    }
    this.snapshots.pop();
  }

  rollbackAtomicWrite() {
    console.log('rolling back', this.snapshots);
    if (this.snapshots.length === 0) {
      throw new Error('rolling back without snapshot');
    }
    let snapshot = this.snapshots[this.snapshots.length - 1];
    this.buffer = this.buffer.slice(0, snapshot);
    this.snapshots.pop();
    console.log('rolled back', this.snapshots);
  }

  fsync() {
    // TODO: both of these writes should happen in a transaction

    console.log('fsync', this.fileName, this.buffer);

    if (this.buffer.length > 0) {
      this.backend.writeChunks(this.fileName, this.buffer);
    }

    if (this._metaDirty) {
      this.backend.writeMeta(this.fileName, this.meta);
      this._metaDirty = false;
    }

    this.buffer = [];
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
  }

  getattr() {
    return this.meta;
  }

  // repartition(chunkSize) {
  //   // Load it all into memory
  //   let buffer = this.readAll();

  //   this.chunkSize = chunkSize;
  //   this.write(allData, 0, allData.byteLength, 0);
  //   this._metaDirty = true;

  //   this.fsync();
  // }
}
