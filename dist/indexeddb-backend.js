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

// Noops in prod
async function end() {}

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
    end();
    this.ops.stats();
  }
}

function decodeBase64(base64, enableUnicode) {
    var binaryString = atob(base64);
    if (enableUnicode) {
        var binaryView = new Uint8Array(binaryString.length);
        for (var i = 0, n = binaryString.length; i < n; ++i) {
            binaryView[i] = binaryString.charCodeAt(i);
        }
        return String.fromCharCode.apply(null, new Uint16Array(binaryView.buffer));
    }
    return binaryString;
}

function createURL(base64, sourcemapArg, enableUnicodeArg) {
    var sourcemap = sourcemapArg === undefined ? null : sourcemapArg;
    var enableUnicode = enableUnicodeArg === undefined ? false : enableUnicodeArg;
    var source = decodeBase64(base64, enableUnicode);
    var start = source.indexOf('\n', 10) + 1;
    var body = source.substring(start) + (sourcemap ? '\/\/# sourceMappingURL=' + sourcemap : '');
    var blob = new Blob([body], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}

function createBase64WorkerFactory(base64, sourcemapArg, enableUnicodeArg) {
    var url;
    return function WorkerFactory(options) {
        url = url || createURL(base64, sourcemapArg, enableUnicodeArg);
        return new Worker(url, options);
    };
}

var WorkerFactory = createBase64WorkerFactory('Lyogcm9sbHVwLXBsdWdpbi13ZWItd29ya2VyLWxvYWRlciAqLwooZnVuY3Rpb24gKCkgewogICd1c2Ugc3RyaWN0JzsKCiAgbGV0IEZJTkFMSVpFRCA9IDB4ZGVhZGJlZWY7CgogIGxldCBXUklURUFCTEUgPSAwOwogIGxldCBSRUFEQUJMRSA9IDE7CgogIGNsYXNzIFJlYWRlciB7CiAgICBjb25zdHJ1Y3RvcigKICAgICAgYnVmZmVyLAogICAgICB7IGluaXRpYWxPZmZzZXQgPSA0LCB1c2VBdG9taWNzID0gdHJ1ZSwgc3RyZWFtID0gdHJ1ZSwgZGVidWcsIG5hbWUgfSA9IHt9CiAgICApIHsKICAgICAgdGhpcy5idWZmZXIgPSBidWZmZXI7CiAgICAgIHRoaXMuYXRvbWljVmlldyA9IG5ldyBJbnQzMkFycmF5KGJ1ZmZlcik7CiAgICAgIHRoaXMub2Zmc2V0ID0gaW5pdGlhbE9mZnNldDsKICAgICAgdGhpcy51c2VBdG9taWNzID0gdXNlQXRvbWljczsKICAgICAgdGhpcy5zdHJlYW0gPSBzdHJlYW07CiAgICAgIHRoaXMuZGVidWcgPSBkZWJ1ZzsKICAgICAgdGhpcy5uYW1lID0gbmFtZTsKICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbcmVhZGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0V3JpdGUobmFtZSkgewogICAgICBpZiAodGhpcy51c2VBdG9taWNzKSB7CiAgICAgICAgdGhpcy5sb2coYHdhaXRpbmcgZm9yICR7bmFtZX1gKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBXUklURUFCTEUpIHsKICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCd3YWl0aW5nIGZvciB3cml0ZS4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFLCA1MDApOwogICAgICAgIH0KCiAgICAgICAgdGhpcy5sb2coYHJlc3VtZWQgZm9yICR7bmFtZX1gKTsKICAgICAgfSBlbHNlIHsKICAgICAgICBpZiAodGhpcy5hdG9taWNWaWV3WzBdICE9PSBSRUFEQUJMRSkgewogICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdgd2FpdFdyaXRlYCBleHBlY3RlZCBhcnJheSB0byBiZSByZWFkYWJsZScpOwogICAgICAgIH0KICAgICAgfQogICAgfQoKICAgIGZsaXAoKSB7CiAgICAgIHRoaXMubG9nKCdmbGlwJyk7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICBsZXQgcHJldiA9IEF0b21pY3MuY29tcGFyZUV4Y2hhbmdlKAogICAgICAgICAgdGhpcy5hdG9taWNWaWV3LAogICAgICAgICAgMCwKICAgICAgICAgIFJFQURBQkxFLAogICAgICAgICAgV1JJVEVBQkxFCiAgICAgICAgKTsKCiAgICAgICAgaWYgKHByZXYgIT09IFJFQURBQkxFKSB7CiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlYWQgZGF0YSBvdXQgb2Ygc3luYyEgVGhpcyBpcyBkaXNhc3Ryb3VzJyk7CiAgICAgICAgfQoKICAgICAgICBBdG9taWNzLm5vdGlmeSh0aGlzLmF0b21pY1ZpZXcsIDApOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IFdSSVRFQUJMRTsKICAgICAgfQoKICAgICAgdGhpcy5vZmZzZXQgPSA0OwogICAgfQoKICAgIGRvbmUoKSB7CiAgICAgIHRoaXMud2FpdFdyaXRlKCdkb25lJyk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgbGV0IGRvbmUgPSBkYXRhVmlldy5nZXRVaW50MzIoMCkgPT09IEZJTkFMSVpFRDsKCiAgICAgIGlmIChkb25lKSB7CiAgICAgICAgdGhpcy5sb2coJ2RvbmUnKTsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQoKICAgICAgcmV0dXJuIGRvbmU7CiAgICB9CgogICAgcGVlayhmbikgewogICAgICB0aGlzLnBlZWtPZmZzZXQgPSB0aGlzLm9mZnNldDsKICAgICAgbGV0IHJlcyA9IGZuKCk7CiAgICAgIHRoaXMub2Zmc2V0ID0gdGhpcy5wZWVrT2Zmc2V0OwogICAgICB0aGlzLnBlZWtPZmZzZXQgPSBudWxsOwogICAgICByZXR1cm4gcmVzOwogICAgfQoKICAgIHN0cmluZygpIHsKICAgICAgdGhpcy53YWl0V3JpdGUoJ3N0cmluZycpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSB0aGlzLl9pbnQzMigpOwogICAgICBsZXQgbGVuZ3RoID0gYnl0ZUxlbmd0aCAvIDI7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0LCBieXRlTGVuZ3RoKTsKICAgICAgbGV0IGNoYXJzID0gW107CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHsKICAgICAgICBjaGFycy5wdXNoKGRhdGFWaWV3LmdldFVpbnQxNihpICogMikpOwogICAgICB9CiAgICAgIGxldCBzdHIgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIGNoYXJzKTsKICAgICAgdGhpcy5sb2coJ3N0cmluZycsIHN0cik7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwoKICAgICAgaWYgKHRoaXMucGVla09mZnNldCA9PSBudWxsKSB7CiAgICAgICAgdGhpcy5mbGlwKCk7CiAgICAgIH0KICAgICAgcmV0dXJuIHN0cjsKICAgIH0KCiAgICBfaW50MzIoKSB7CiAgICAgIGxldCBieXRlTGVuZ3RoID0gNDsKCiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBsZXQgbnVtID0gZGF0YVZpZXcuZ2V0SW50MzIoKTsKICAgICAgdGhpcy5sb2coJ19pbnQzMicsIG51bSk7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGludDMyKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgnaW50MzInKTsKICAgICAgbGV0IG51bSA9IHRoaXMuX2ludDMyKCk7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CgogICAgICBpZiAodGhpcy5wZWVrT2Zmc2V0ID09IG51bGwpIHsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGJ5dGVzKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgnYnl0ZXMnKTsKCiAgICAgIGxldCBieXRlTGVuZ3RoID0gdGhpcy5faW50MzIoKTsKCiAgICAgIGxldCBieXRlcyA9IG5ldyBBcnJheUJ1ZmZlcihieXRlTGVuZ3RoKTsKICAgICAgbmV3IFVpbnQ4QXJyYXkoYnl0ZXMpLnNldCgKICAgICAgICBuZXcgVWludDhBcnJheSh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQsIGJ5dGVMZW5ndGgpCiAgICAgICk7CiAgICAgIHRoaXMubG9nKCdieXRlcycsIGJ5dGVzKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CgogICAgICBpZiAodGhpcy5wZWVrT2Zmc2V0ID09IG51bGwpIHsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQogICAgICByZXR1cm4gYnl0ZXM7CiAgICB9CiAgfQoKICBjbGFzcyBXcml0ZXIgewogICAgY29uc3RydWN0b3IoCiAgICAgIGJ1ZmZlciwKICAgICAgeyBpbml0aWFsT2Zmc2V0ID0gNCwgdXNlQXRvbWljcyA9IHRydWUsIHN0cmVhbSA9IHRydWUsIGRlYnVnLCBuYW1lIH0gPSB7fQogICAgKSB7CiAgICAgIHRoaXMuYnVmZmVyID0gYnVmZmVyOwogICAgICB0aGlzLmF0b21pY1ZpZXcgPSBuZXcgSW50MzJBcnJheShidWZmZXIpOwogICAgICB0aGlzLm9mZnNldCA9IGluaXRpYWxPZmZzZXQ7CiAgICAgIHRoaXMudXNlQXRvbWljcyA9IHVzZUF0b21pY3M7CiAgICAgIHRoaXMuc3RyZWFtID0gc3RyZWFtOwoKICAgICAgdGhpcy5kZWJ1ZyA9IGRlYnVnOwogICAgICB0aGlzLm5hbWUgPSBuYW1lOwoKICAgICAgaWYgKHRoaXMudXNlQXRvbWljcykgewogICAgICAgIC8vIFRoZSBidWZmZXIgc3RhcnRzIG91dCBhcyB3cml0ZWFibGUKICAgICAgICBBdG9taWNzLnN0b3JlKHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFKTsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aGlzLmF0b21pY1ZpZXdbMF0gPSBXUklURUFCTEU7CiAgICAgIH0KICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbd3JpdGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0UmVhZChuYW1lKSB7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICB0aGlzLmxvZyhgd2FpdGluZyBmb3IgJHtuYW1lfWApOwogICAgICAgIC8vIFN3aXRjaCB0byB3cml0YWJsZQogICAgICAgIC8vIEF0b21pY3Muc3RvcmUodGhpcy5hdG9taWNWaWV3LCAwLCAxKTsKCiAgICAgICAgbGV0IHByZXYgPSBBdG9taWNzLmNvbXBhcmVFeGNoYW5nZSgKICAgICAgICAgIHRoaXMuYXRvbWljVmlldywKICAgICAgICAgIDAsCiAgICAgICAgICBXUklURUFCTEUsCiAgICAgICAgICBSRUFEQUJMRQogICAgICAgICk7CgogICAgICAgIGlmIChwcmV2ICE9PSBXUklURUFCTEUpIHsKICAgICAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAgICAgJ1dyb3RlIHNvbWV0aGluZyBpbnRvIHVud3JpdGFibGUgYnVmZmVyISBUaGlzIGlzIGRpc2FzdHJvdXMnCiAgICAgICAgICApOwogICAgICAgIH0KCiAgICAgICAgQXRvbWljcy5ub3RpZnkodGhpcy5hdG9taWNWaWV3LCAwKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBSRUFEQUJMRSkgewogICAgICAgICAgLy8gY29uc29sZS5sb2coJ3dhaXRpbmcgdG8gYmUgcmVhZC4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgUkVBREFCTEUsIDUwMCk7CiAgICAgICAgfQoKICAgICAgICB0aGlzLmxvZyhgcmVzdW1lZCBmb3IgJHtuYW1lfWApOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IFJFQURBQkxFOwogICAgICB9CgogICAgICB0aGlzLm9mZnNldCA9IDQ7CiAgICB9CgogICAgZmluYWxpemUoKSB7CiAgICAgIHRoaXMubG9nKCdmaW5hbGl6aW5nJyk7CiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBkYXRhVmlldy5zZXRVaW50MzIoMCwgRklOQUxJWkVEKTsKICAgICAgdGhpcy53YWl0UmVhZCgnZmluYWxpemUnKTsKICAgIH0KCiAgICBzdHJpbmcoc3RyKSB7CiAgICAgIHRoaXMubG9nKCdzdHJpbmcnLCBzdHIpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSBzdHIubGVuZ3RoICogMjsKICAgICAgdGhpcy5faW50MzIoYnl0ZUxlbmd0aCk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0LCBieXRlTGVuZ3RoKTsKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHsKICAgICAgICBkYXRhVmlldy5zZXRVaW50MTYoaSAqIDIsIHN0ci5jaGFyQ29kZUF0KGkpKTsKICAgICAgfQoKICAgICAgdGhpcy5vZmZzZXQgKz0gYnl0ZUxlbmd0aDsKICAgICAgdGhpcy53YWl0UmVhZCgnc3RyaW5nJyk7CiAgICB9CgogICAgX2ludDMyKG51bSkgewogICAgICBsZXQgYnl0ZUxlbmd0aCA9IDQ7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgZGF0YVZpZXcuc2V0SW50MzIoMCwgbnVtKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CiAgICB9CgogICAgaW50MzIobnVtKSB7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CiAgICAgIHRoaXMuX2ludDMyKG51bSk7CiAgICAgIHRoaXMud2FpdFJlYWQoJ2ludDMyJyk7CiAgICB9CgogICAgYnl0ZXMoYnVmZmVyKSB7CiAgICAgIHRoaXMubG9nKCdieXRlcycsIGJ1ZmZlcik7CgogICAgICBsZXQgYnl0ZUxlbmd0aCA9IGJ1ZmZlci5ieXRlTGVuZ3RoOwogICAgICB0aGlzLl9pbnQzMihieXRlTGVuZ3RoKTsKICAgICAgbmV3IFVpbnQ4QXJyYXkodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KS5zZXQobmV3IFVpbnQ4QXJyYXkoYnVmZmVyKSk7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICB0aGlzLndhaXRSZWFkKCdieXRlcycpOwogICAgfQogIH0KCiAgLy8gTm9vcHMgaW4gcHJvZAogIGFzeW5jIGZ1bmN0aW9uIGVuZCgpIHt9CgogIGxldCBpc1Byb2JhYmx5U2FmYXJpID0gL14oKD8hY2hyb21lfGFuZHJvaWQpLikqc2FmYXJpL2kudGVzdCgKICAgIG5hdmlnYXRvci51c2VyQWdlbnQKICApOwoKICBsZXQgb3BlbkRicyA9IG5ldyBNYXAoKTsKICBsZXQgdHJhbnNhY3Rpb25zID0gbmV3IE1hcCgpOwoKICBmdW5jdGlvbiBhc3NlcnQoY29uZCwgbXNnKSB7CiAgICBpZiAoIWNvbmQpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7CiAgICB9CiAgfQoKICBsZXQgTE9DS19UWVBFUyA9IHsKICAgIE5PTkU6IDAsCiAgICBTSEFSRUQ6IDEsCiAgICBSRVNFUlZFRDogMiwKICAgIFBFTkRJTkc6IDMsCiAgICBFWENMVVNJVkU6IDQKICB9OwoKICAvLyBXZSB1c2UgbG9uZy1saXZlZCB0cmFuc2FjdGlvbnMsIGFuZCBgVHJhbnNhY3Rpb25gIGtlZXBzIHRoZQogIC8vIHRyYW5zYWN0aW9uIHN0YXRlLiBJdCBpbXBsZW1lbnRzIGFuIG9wdGltYWwgd2F5IHRvIHBlcmZvcm0KICAvLyByZWFkL3dyaXRlcyB3aXRoIGtub3dsZWRnZSBvZiBob3cgc3FsaXRlIGFza3MgZm9yIHRoZW0sIGFuZCBhbHNvCiAgLy8gaW1wbGVtZW50cyBhIGxvY2tpbmcgbWVjaGFuaXNtIHRoYXQgbWFwcyB0byBob3cgc3FsaXRlIGxvY2tzIHdvcmsuCiAgY2xhc3MgVHJhbnNhY3Rpb24gewogICAgY29uc3RydWN0b3IoZGIsIGluaXRpYWxNb2RlID0gJ3JlYWRvbmx5JykgewogICAgICB0aGlzLmRiID0gZGI7CiAgICAgIHRoaXMudHJhbnMgPSB0aGlzLmRiLnRyYW5zYWN0aW9uKFsnZGF0YSddLCBpbml0aWFsTW9kZSk7CiAgICAgIHRoaXMuc3RvcmUgPSB0aGlzLnRyYW5zLm9iamVjdFN0b3JlKCdkYXRhJyk7CiAgICAgIHRoaXMubG9ja1R5cGUgPQogICAgICAgIGluaXRpYWxNb2RlID09PSAncmVhZG9ubHknID8gTE9DS19UWVBFUy5TSEFSRUQgOiBMT0NLX1RZUEVTLkVYQ0xVU0lWRTsKCiAgICAgIC8vIFRoZXJlIGlzIG5vIG5lZWQgZm9yIHVzIHRvIGNhY2hlIGJsb2Nrcy4gVXNlIHNxbGl0ZSdzCiAgICAgIC8vIGBjYWNoZV9zaXplYCBmb3IgdGhhdCBhbmQgaXQgd2lsbCBhdXRvbWF0aWNhbGx5IGRvIGl0LiBIb3dldmVyLAogICAgICAvLyB3ZSBkbyBzdGlsbCBrZWVwIGEgY2FjaGUgb2YgdGhlIGZpcnN0IGJsb2NrIGZvciB0aGUgZHVyYXRpb24gb2YKICAgICAgLy8gdGhpcyB0cmFuc2FjdGlvbiBiZWNhdXNlIG9mIGhvdyBsb2NraW5nIHdvcmtzOyB0aGlzIGF2b2lkcyBhCiAgICAgIC8vIGZldyBleHRyYSByZWFkcyBhbmQgYWxsb3dzIHVzIHRvIGRldGVjdCBjaGFuZ2VzIGR1cmluZwogICAgICAvLyB1cGdyYWRpbmcgKHNlZSBgdXBncmFkZUV4Y2x1c2l2ZWApCiAgICAgIHRoaXMuY2FjaGVkRmlyc3RCbG9jayA9IG51bGw7CgogICAgICB0aGlzLmN1cnNvciA9IG51bGw7CiAgICAgIHRoaXMucHJldlJlYWRzID0gbnVsbDsKICAgIH0KCiAgICBhc3luYyBwcmVmZXRjaEZpcnN0QmxvY2sodGltZW91dCkgewogICAgICAvLyBUT0RPOiBpbXBsZW1lbnQgdGltZW91dAoKICAgICAgLy8gR2V0IHRoZSBmaXJzdCBibG9jayBhbmQgY2FjaGUgaXQKICAgICAgbGV0IGJsb2NrID0gYXdhaXQgdGhpcy5nZXQoMCk7CiAgICAgIHRoaXMuY2FjaGVkRmlyc3RCbG9jayA9IGJsb2NrOwogICAgICByZXR1cm4gYmxvY2s7CiAgICB9CgogICAgYXN5bmMgd2FpdENvbXBsZXRlKCkgewogICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICAgIC8vIEVhZ2VybHkgY29tbWl0IGl0IGZvciBiZXR0ZXIgcGVyZi4gTm90ZSB0aGF0ICoqdGhpcyBhc3N1bWVzCiAgICAgICAgLy8gdGhlIHRyYW5zYWN0aW9uIGlzIG9wZW4qKiBhcyBgY29tbWl0YCB3aWxsIHRocm93IGFuIGVycm9yIGlmCiAgICAgICAgLy8gaXQncyBhbHJlYWR5IGNsb3NlZCAod2hpY2ggc2hvdWxkIG5ldmVyIGJlIHRoZSBjYXNlIGZvciB1cykKICAgICAgICB0aGlzLmNvbW1pdCgpOwoKICAgICAgICBpZiAodGhpcy5sb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5FWENMVVNJVkUpIHsKICAgICAgICAgIC8vIFdhaXQgdW50aWwgYWxsIHdyaXRlcyBhcmUgY29tbWl0dGVkCiAgICAgICAgICB0aGlzLnRyYW5zLm9uY29tcGxldGUgPSBlID0+IHJlc29sdmUoKTsKCiAgICAgICAgICAvLyBUT0RPOiBJcyBpdCBPSyB0byBhZGQgdGhpcyBsYXRlciwgYWZ0ZXIgYW4gZXJyb3IgbWlnaHQgaGF2ZQogICAgICAgICAgLy8gaGFwcGVuZWQ/IFdpbGwgaXQgaG9sZCB0aGUgZXJyb3IgYW5kIGZpcmUgdGhpcyB3aGVuIHdlCiAgICAgICAgICAvLyBhdHRhY2hlZCBpdD8gV2UgbWlnaHQgd2FudCB0byBlYWdlcmx5IGNyZWF0ZSB0aGUgcHJvbWlzZQogICAgICAgICAgLy8gd2hlbiBjcmVhdGluZyB0aGUgdHJhbnNhY3Rpb24gYW5kIHJldHVybiBpdCBoZXJlCiAgICAgICAgICB0aGlzLnRyYW5zLm9uZXJyb3IgPSBlID0+IHJlamVjdChlKTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgaWYgKGlzUHJvYmFibHlTYWZhcmkpIHsKICAgICAgICAgICAgLy8gU2FmYXJpIGhhcyBhIGJ1ZyB3aGVyZSBzb21ldGltZXMgdGhlIElEQiBnZXRzIGJsb2NrZWQKICAgICAgICAgICAgLy8gcGVybWFuZW50bHkgaWYgeW91IHJlZnJlc2ggdGhlIHBhZ2Ugd2l0aCBhbiBvcGVuCiAgICAgICAgICAgIC8vIHRyYW5zYWN0aW9uLiBZb3UgaGF2ZSB0byByZXN0YXJ0IHRoZSBicm93c2VyIHRvIGZpeCBpdC4KICAgICAgICAgICAgLy8gV2Ugd2FpdCBmb3IgcmVhZG9ubHkgdHJhbnNhY3Rpb25zIHRvIGZpbmlzaCB0b28sIGJ1dCB0aGlzCiAgICAgICAgICAgIC8vIGlzIGEgcGVyZiBoaXQKICAgICAgICAgICAgdGhpcy50cmFucy5vbmNvbXBsZXRlID0gZSA9PiByZXNvbHZlKCk7CiAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAvLyBObyBuZWVkIHRvIHdhaXQgb24gYW55dGhpbmcgaW4gYSByZWFkLW9ubHkgdHJhbnNhY3Rpb24uCiAgICAgICAgICAgIC8vIE5vdGUgdGhhdCBlcnJvcnMgZHVyaW5nIHJlYWRzIGFyZWEgYWx3YXlzIGhhbmRsZWQgYnkgdGhlCiAgICAgICAgICAgIC8vIHJlYWQgcmVxdWVzdC4KICAgICAgICAgICAgcmVzb2x2ZSgpOwogICAgICAgICAgfQogICAgICAgIH0KICAgICAgfSk7CiAgICB9CgogICAgY29tbWl0KCkgewogICAgICAvLyBTYWZhcmkgZG9lc24ndCBzdXBwb3J0IHRoaXMgbWV0aG9kIHlldCAodGhpcyBpcyBqdXN0IGFuCiAgICAgIC8vIG9wdGltaXphdGlvbikKICAgICAgaWYgKHRoaXMudHJhbnMuY29tbWl0KSB7CiAgICAgICAgdGhpcy50cmFucy5jb21taXQoKTsKICAgICAgfQogICAgfQoKICAgIGFzeW5jIHVwZ3JhZGVFeGNsdXNpdmUoKSB7CiAgICAgIHRoaXMuY29tbWl0KCk7CgogICAgICAvLyBjb25zb2xlLmxvZygndXBkYXRpbmcgdHJhbnNhY3Rpb24gcmVhZHdyaXRlJyk7CiAgICAgIHRoaXMudHJhbnMgPSB0aGlzLmRiLnRyYW5zYWN0aW9uKFsnZGF0YSddLCAncmVhZHdyaXRlJyk7CiAgICAgIHRoaXMuc3RvcmUgPSB0aGlzLnRyYW5zLm9iamVjdFN0b3JlKCdkYXRhJyk7CiAgICAgIHRoaXMubG9ja1R5cGUgPSBMT0NLX1RZUEVTLkVYQ0xVU0lWRTsKCiAgICAgIGxldCBjYWNoZWQwID0gdGhpcy5jYWNoZWRGaXJzdEJsb2NrOwoKICAgICAgLy8gRG8gYSByZWFkCiAgICAgIGxldCBibG9jayA9IGF3YWl0IHRoaXMucHJlZmV0Y2hGaXJzdEJsb2NrKDUwMCk7CiAgICAgIC8vIFRPRE86IHdoZW4gdGltZW91dHMgYXJlIGltcGxlbWVudGVkLCBkZXRlY3QgdGltZW91dCBhbmQgcmV0dXJuIEJVU1kKCiAgICAgIGlmIChjYWNoZWQwID09IG51bGwgJiYgYmxvY2sgPT0gbnVsbCkgewogICAgICAgIHJldHVybiB0cnVlOwogICAgICB9IGVsc2UgewogICAgICAgIGZvciAobGV0IGkgPSAyNDsgaSA8IDQwOyBpKyspIHsKICAgICAgICAgIGlmIChibG9ja1tpXSAhPT0gY2FjaGVkMFtpXSkgewogICAgICAgICAgICByZXR1cm4gZmFsc2U7CiAgICAgICAgICB9CiAgICAgICAgfQogICAgICB9CgogICAgICByZXR1cm4gdHJ1ZTsKICAgIH0KCiAgICBkb3duZ3JhZGVTaGFyZWQoKSB7CiAgICAgIHRoaXMuY29tbWl0KCk7CgogICAgICAvLyBjb25zb2xlLmxvZygnZG93bmdyYWRpbmcgdHJhbnNhY3Rpb24gcmVhZG9ubHknKTsKICAgICAgdGhpcy50cmFucyA9IHRoaXMuZGIudHJhbnNhY3Rpb24oWydkYXRhJ10sICdyZWFkb25seScpOwogICAgICB0aGlzLnN0b3JlID0gdGhpcy50cmFucy5vYmplY3RTdG9yZSgnZGF0YScpOwogICAgICB0aGlzLmxvY2tUeXBlID0gTE9DS19UWVBFUy5TSEFSRUQ7CiAgICB9CgogICAgYXN5bmMgZ2V0KGtleSkgewogICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICAgIGxldCByZXEgPSB0aGlzLnN0b3JlLmdldChrZXkpOwogICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBlID0+IHsKICAgICAgICAgIHJlc29sdmUocmVxLnJlc3VsdCk7CiAgICAgICAgfTsKICAgICAgICByZXEub25lcnJvciA9IGUgPT4gcmVqZWN0KGUpOwogICAgICB9KTsKICAgIH0KCiAgICBnZXRSZWFkRGlyZWN0aW9uKCkgewogICAgICAvLyBUaGVyZSBhcmUgYSB0d28gd2F5cyB3ZSBjYW4gcmVhZCBkYXRhOiBhIGRpcmVjdCBgZ2V0YCByZXF1ZXN0CiAgICAgIC8vIG9yIG9wZW5pbmcgYSBjdXJzb3IgYW5kIGl0ZXJhdGluZyB0aHJvdWdoIGRhdGEuIFdlIGRvbid0IGtub3cKICAgICAgLy8gd2hhdCBmdXR1cmUgcmVhZHMgbG9vayBsaWtlLCBzbyB3ZSBkb24ndCBrbm93IHRoZSBiZXN0IHN0cmF0ZWd5CiAgICAgIC8vIHRvIHBpY2suIEFsd2F5cyBjaG9vc2luZyBvbmUgc3RyYXRlZ3kgZm9yZ29lcyBhIGxvdCBvZgogICAgICAvLyBvcHRpbWl6YXRpb24sIGJlY2F1c2UgaXRlcmF0aW5nIHdpdGggYSBjdXJzb3IgaXMgYSBsb3QgZmFzdGVyCiAgICAgIC8vIHRoYW4gbWFueSBgZ2V0YCBjYWxscy4gT24gdGhlIG90aGVyIGhhbmQsIG9wZW5pbmcgYSBjdXJzb3IgaXMKICAgICAgLy8gc2xvdywgYW5kIHNvIGlzIGNhbGxpbmcgYGFkdmFuY2VgIHRvIG1vdmUgYSBjdXJzb3Igb3ZlciBhIGh1Z2UKICAgICAgLy8gcmFuZ2UgKGxpa2UgbW92aW5nIGl0IDEwMDAgaXRlbXMgbGF0ZXIpLCBzbyBtYW55IGBnZXRgIGNhbGxzIHdvdWxkCiAgICAgIC8vIGJlIGZhc3Rlci4gSW4gZ2VuZXJhbDoKICAgICAgLy8KICAgICAgLy8gKiBNYW55IGBnZXRgIGNhbGxzIGFyZSBmYXN0ZXIgd2hlbiBkb2luZyByYW5kb20gYWNjZXNzZXMKICAgICAgLy8gKiBJdGVyYXRpbmcgd2l0aCBhIGN1cnNvciBpcyBmYXN0ZXIgaWYgZG9pbmcgbW9zdGx5IHNlcXVlbnRpYWwKICAgICAgLy8gICBhY2Nlc3NlcwogICAgICAvLwogICAgICAvLyBXZSBpbXBsZW1lbnQgYSBoZXVyaXN0aWMgYW5kIGtlZXBzIHRyYWNrIG9mIHRoZSBsYXN0IDMgcmVhZHMKICAgICAgLy8gYW5kIGRldGVjdHMgd2hlbiB0aGV5IGFyZSBtb3N0bHkgc2VxdWVudGlhbC4gSWYgdGhleSBhcmUsIHdlCiAgICAgIC8vIG9wZW4gYSBjdXJzb3IgYW5kIHN0YXJ0IHJlYWRpbmcgYnkgaXRlcmF0aW5nIGl0LiBJZiBub3QsIHdlIGRvCiAgICAgIC8vIGRpcmVjdCBgZ2V0YCBjYWxscy4KICAgICAgLy8KICAgICAgLy8gT24gdG9wIG9mIGFsbCBvZiB0aGlzLCBlYWNoIGJyb3dzZXIgaGFzIGRpZmZlcmVudCBwZXJmCiAgICAgIC8vIGNoYXJhY3RlcmlzdGljcy4gV2Ugd2lsbCBwcm9iYWJseSB3YW50IHRvIG1ha2UgdGhlc2UgdGhyZXNob2xkcwogICAgICAvLyBjb25maWd1cmFibGUgc28gdGhlIHVzZXIgY2FuIGNoYW5nZSB0aGVtIHBlci1icm93c2VyIGlmIG5lZWRlZCwKICAgICAgLy8gYXMgd2VsbCBhcyBmaW5lLXR1bmluZyB0aGVtIGZvciB0aGVpciB1c2FnZSBvZiBzcWxpdGUuCgogICAgICBsZXQgcHJldlJlYWRzID0gdGhpcy5wcmV2UmVhZHM7CiAgICAgIGlmIChwcmV2UmVhZHMpIHsKICAgICAgICAvLyBIYXMgdGhlcmUgYmVlbiAzIGZvcndhcmQgc2VxdWVudGlhbCByZWFkcyB3aXRoaW4gMTAgYmxvY2tzPwogICAgICAgIGlmICgKICAgICAgICAgIHByZXZSZWFkc1swXSA8IHByZXZSZWFkc1sxXSAmJgogICAgICAgICAgcHJldlJlYWRzWzFdIDwgcHJldlJlYWRzWzJdICYmCiAgICAgICAgICBwcmV2UmVhZHNbMl0gLSBwcmV2UmVhZHNbMF0gPCAxMAogICAgICAgICkgewogICAgICAgICAgcmV0dXJuICduZXh0JzsKICAgICAgICB9CgogICAgICAgIC8vIEhhcyB0aGVyZSBiZWVuIDMgYmFja3dhcmRzIHNlcXVlbnRpYWwgcmVhZHMgd2l0aGluIDEwIGJsb2Nrcz8KICAgICAgICBpZiAoCiAgICAgICAgICBwcmV2UmVhZHNbMF0gPiBwcmV2UmVhZHNbMV0gJiYKICAgICAgICAgIHByZXZSZWFkc1sxXSA+IHByZXZSZWFkc1syXSAmJgogICAgICAgICAgcHJldlJlYWRzWzBdIC0gcHJldlJlYWRzWzJdIDwgMTAKICAgICAgICApIHsKICAgICAgICAgIHJldHVybiAncHJldic7CiAgICAgICAgfQogICAgICB9CgogICAgICByZXR1cm4gbnVsbDsKICAgIH0KCiAgICByZWFkKHBvc2l0aW9uKSB7CiAgICAgIGxldCB3YWl0Q3Vyc29yID0gKCkgPT4gewogICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgICAgICBpZiAodGhpcy5jdXJzb3JQcm9taXNlICE9IG51bGwpIHsKICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICAgICAgICd3YWl0Q3Vyc29yKCkgY2FsbGVkIGJ1dCBzb21ldGhpbmcgZWxzZSBpcyBhbHJlYWR5IHdhaXRpbmcnCiAgICAgICAgICAgICk7CiAgICAgICAgICB9CiAgICAgICAgICB0aGlzLmN1cnNvclByb21pc2UgPSB7IHJlc29sdmUsIHJlamVjdCB9OwogICAgICAgIH0pOwogICAgICB9OwoKICAgICAgaWYgKHRoaXMuY3Vyc29yKSB7CiAgICAgICAgbGV0IGN1cnNvciA9IHRoaXMuY3Vyc29yOwoKICAgICAgICBpZiAoCiAgICAgICAgICBjdXJzb3IuZGlyZWN0aW9uID09PSAnbmV4dCcgJiYKICAgICAgICAgIHBvc2l0aW9uID4gY3Vyc29yLmtleSAmJgogICAgICAgICAgcG9zaXRpb24gPCBjdXJzb3Iua2V5ICsgMTAwCiAgICAgICAgKSB7CgogICAgICAgICAgY3Vyc29yLmFkdmFuY2UocG9zaXRpb24gLSBjdXJzb3Iua2V5KTsKICAgICAgICAgIHJldHVybiB3YWl0Q3Vyc29yKCk7CiAgICAgICAgfSBlbHNlIGlmICgKICAgICAgICAgIGN1cnNvci5kaXJlY3Rpb24gPT09ICdwcmV2JyAmJgogICAgICAgICAgcG9zaXRpb24gPCBjdXJzb3Iua2V5ICYmCiAgICAgICAgICBwb3NpdGlvbiA+IGN1cnNvci5rZXkgLSAxMDAKICAgICAgICApIHsKCiAgICAgICAgICBjdXJzb3IuYWR2YW5jZShjdXJzb3Iua2V5IC0gcG9zaXRpb24pOwogICAgICAgICAgcmV0dXJuIHdhaXRDdXJzb3IoKTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgLy8gRGl0Y2ggdGhlIGN1cnNvcgogICAgICAgICAgdGhpcy5jdXJzb3IgPSBudWxsOwogICAgICAgICAgcmV0dXJuIHRoaXMucmVhZChwb3NpdGlvbik7CiAgICAgICAgfQogICAgICB9IGVsc2UgewogICAgICAgIC8vIFdlIGRvbid0IGFscmVhZHkgaGF2ZSBhIGN1cnNvci4gV2UgbmVlZCB0byBhIGZyZXNoIHJlYWQ7CiAgICAgICAgLy8gc2hvdWxkIHdlIG9wZW4gYSBjdXJzb3Igb3IgY2FsbCBgZ2V0YD8KCiAgICAgICAgbGV0IGRpciA9IHRoaXMuZ2V0UmVhZERpcmVjdGlvbigpOwogICAgICAgIGlmIChkaXIpIHsKICAgICAgICAgIC8vIE9wZW4gYSBjdXJzb3IKICAgICAgICAgIHRoaXMucHJldlJlYWRzID0gbnVsbDsKCiAgICAgICAgICBsZXQga2V5UmFuZ2U7CiAgICAgICAgICBpZiAoZGlyID09PSAncHJldicpIHsKICAgICAgICAgICAga2V5UmFuZ2UgPSBJREJLZXlSYW5nZS51cHBlckJvdW5kKHBvc2l0aW9uKTsKICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGtleVJhbmdlID0gSURCS2V5UmFuZ2UubG93ZXJCb3VuZChwb3NpdGlvbik7CiAgICAgICAgICB9CgogICAgICAgICAgbGV0IHJlcSA9IHRoaXMuc3RvcmUub3BlbkN1cnNvcihrZXlSYW5nZSwgZGlyKTsKCiAgICAgICAgICByZXEub25zdWNjZXNzID0gZSA9PiB7CgogICAgICAgICAgICBsZXQgY3Vyc29yID0gZS50YXJnZXQucmVzdWx0OwogICAgICAgICAgICB0aGlzLmN1cnNvciA9IGN1cnNvcjsKCiAgICAgICAgICAgIGlmICh0aGlzLmN1cnNvclByb21pc2UgPT0gbnVsbCkgewogICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignR290IGRhdGEgZnJvbSBjdXJzb3IgYnV0IG5vdGhpbmcgaXMgd2FpdGluZyBpdCcpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIHRoaXMuY3Vyc29yUHJvbWlzZS5yZXNvbHZlKGN1cnNvciA/IGN1cnNvci52YWx1ZSA6IG51bGwpOwogICAgICAgICAgICB0aGlzLmN1cnNvclByb21pc2UgPSBudWxsOwogICAgICAgICAgfTsKICAgICAgICAgIHJlcS5vbmVycm9yID0gZSA9PiB7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdDdXJzb3IgZmFpbHVyZTonLCBlKTsKCiAgICAgICAgICAgIGlmICh0aGlzLmN1cnNvclByb21pc2UgPT0gbnVsbCkgewogICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignR290IGRhdGEgZnJvbSBjdXJzb3IgYnV0IG5vdGhpbmcgaXMgd2FpdGluZyBpdCcpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIHRoaXMuY3Vyc29yUHJvbWlzZS5yZWplY3QoZSk7CiAgICAgICAgICAgIHRoaXMuY3Vyc29yUHJvbWlzZSA9IG51bGw7CiAgICAgICAgICB9OwoKICAgICAgICAgIHJldHVybiB3YWl0Q3Vyc29yKCk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIGlmICh0aGlzLnByZXZSZWFkcyA9PSBudWxsKSB7CiAgICAgICAgICAgIHRoaXMucHJldlJlYWRzID0gWzAsIDAsIDBdOwogICAgICAgICAgfQogICAgICAgICAgdGhpcy5wcmV2UmVhZHMucHVzaChwb3NpdGlvbik7CiAgICAgICAgICB0aGlzLnByZXZSZWFkcy5zaGlmdCgpOwoKICAgICAgICAgIHJldHVybiB0aGlzLmdldChwb3NpdGlvbik7CiAgICAgICAgfQogICAgICB9CiAgICB9CgogICAgYXN5bmMgc2V0KGl0ZW0pIHsKICAgICAgdGhpcy5wcmV2UmVhZHMgPSBudWxsOwoKICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgICBsZXQgcmVxID0gdGhpcy5zdG9yZS5wdXQoaXRlbS52YWx1ZSwgaXRlbS5rZXkpOwogICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBlID0+IHJlc29sdmUocmVxLnJlc3VsdCk7CiAgICAgICAgcmVxLm9uZXJyb3IgPSBlID0+IHJlamVjdChlKTsKICAgICAgfSk7CiAgICB9CgogICAgYXN5bmMgYnVsa1NldChpdGVtcykgewogICAgICB0aGlzLnByZXZSZWFkcyA9IG51bGw7CgogICAgICBmb3IgKGxldCBpdGVtIG9mIGl0ZW1zKSB7CiAgICAgICAgdGhpcy5zdG9yZS5wdXQoaXRlbS52YWx1ZSwgaXRlbS5rZXkpOwogICAgICB9CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBsb2FkRGIobmFtZSkgewogICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgaWYgKG9wZW5EYnMuZ2V0KG5hbWUpKSB7CiAgICAgICAgcmVzb2x2ZShvcGVuRGJzLmdldChuYW1lKSk7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBjb25zb2xlLmxvZygnb3BlbmluZycsIG5hbWUpOwoKICAgICAgbGV0IHJlcSA9IGdsb2JhbFRoaXMuaW5kZXhlZERCLm9wZW4obmFtZSwgMSk7CiAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBldmVudCA9PiB7CiAgICAgICAgY29uc29sZS5sb2coJ2RiIGlzIG9wZW4hJywgbmFtZSk7CiAgICAgICAgbGV0IGRiID0gZXZlbnQudGFyZ2V0LnJlc3VsdDsKCiAgICAgICAgZGIub252ZXJzaW9uY2hhbmdlID0gKCkgPT4gewogICAgICAgICAgLy8gVE9ETzogTm90aWZ5IHRoZSB1c2VyIHNvbWVob3cKICAgICAgICAgIGNvbnNvbGUubG9nKCdjbG9zaW5nIGJlY2F1c2UgdmVyc2lvbiBjaGFuZ2VkJyk7CiAgICAgICAgICBkYi5jbG9zZSgpOwogICAgICAgICAgb3BlbkRicy5kZWxldGUobmFtZSk7CiAgICAgICAgfTsKCiAgICAgICAgZGIub25jbG9zZSA9ICgpID0+IHsKICAgICAgICAgIG9wZW5EYnMuZGVsZXRlKG5hbWUpOwogICAgICAgIH07CgogICAgICAgIG9wZW5EYnMuc2V0KG5hbWUsIGRiKTsKICAgICAgICByZXNvbHZlKGRiKTsKICAgICAgfTsKICAgICAgcmVxLm9udXBncmFkZW5lZWRlZCA9IGV2ZW50ID0+IHsKICAgICAgICBsZXQgZGIgPSBldmVudC50YXJnZXQucmVzdWx0OwogICAgICAgIGlmICghZGIub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygnZGF0YScpKSB7CiAgICAgICAgICBkYi5jcmVhdGVPYmplY3RTdG9yZSgnZGF0YScpOwogICAgICAgIH0KICAgICAgfTsKICAgICAgcmVxLm9uYmxvY2tlZCA9IGUgPT4gY29uc29sZS5sb2coJ2Jsb2NrZWQnLCBlKTsKICAgICAgcmVxLm9uZXJyb3IgPSByZXEub25hYm9ydCA9IGUgPT4gcmVqZWN0KGUudGFyZ2V0LmVycm9yKTsKICAgIH0pOwogIH0KCiAgZnVuY3Rpb24gY2xvc2VEYihuYW1lKSB7CiAgICBsZXQgb3BlbkRiID0gb3BlbkRicy5nZXQobmFtZSk7CiAgICBpZiAob3BlbkRiKSB7CiAgICAgIG9wZW5EYi5jbG9zZSgpOwogICAgICBvcGVuRGJzLmRlbGV0ZShuYW1lKTsKICAgIH0KICB9CgogIGZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uKG5hbWUpIHsKICAgIHJldHVybiB0cmFuc2FjdGlvbnMuZ2V0KG5hbWUpOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gd2l0aFRyYW5zYWN0aW9uKG5hbWUsIG1vZGUsIGZ1bmMpIHsKICAgIGxldCB0cmFucyA9IHRyYW5zYWN0aW9ucy5nZXQobmFtZSk7CiAgICBpZiAodHJhbnMpIHsKICAgICAgLy8gSWYgYSB0cmFuc2FjdGlvbiBhbHJlYWR5IGV4aXN0cywgdGhhdCBtZWFucyB0aGUgZmlsZSBoYXMgYmVlbgogICAgICAvLyBsb2NrZWQuIFdlIGRvbid0IGZ1bGx5IHN1cHBvcnQgYXJiaXRyYXJ5IG5lc3RlZCB0cmFuc2FjdGlvbnMsCiAgICAgIC8vIGFzIHNlZW4gYmVsb3cgKHdlIHdvbid0IHVwZ3JhZGUgYSBgcmVhZG9ubHlgIHRvIGByZWFkd3JpdGVgCiAgICAgIC8vIGF1dG9tYXRpY2FsbHkpIGFuZCB0aGlzIGlzIG1haW5seSBmb3IgdGhlIHVzZSBjYXNlIHdoZXJlIHNxbGl0ZQogICAgICAvLyBsb2NrcyB0aGUgZGIgYW5kIGNyZWF0ZXMgYSB0cmFuc2FjdGlvbiBmb3IgdGhlIGR1cmFjdGlvbiBvZiB0aGUKICAgICAgLy8gbG9jay4gV2UgZG9uJ3QgYWN0dWFsbHkgd3JpdGUgY29kZSBpbiBhIHdheSB0aGF0IGFzc3VtZXMgbmVzdGVkCiAgICAgIC8vIHRyYW5zYWN0aW9ucywgc28ganVzdCBlcnJvciBoZXJlCiAgICAgIGlmIChtb2RlID09PSAncmVhZHdyaXRlJyAmJiB0cmFucy5sb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5TSEFSRUQpIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0F0dGVtcHRlZCB3cml0ZSBidXQgb25seSBoYXMgU0hBUkVEIGxvY2snKTsKICAgICAgfQogICAgICByZXR1cm4gZnVuYyh0cmFucyk7CiAgICB9CgogICAgLy8gT3V0c2lkZSB0aGUgc2NvcGUgb2YgYSBsb2NrLCBjcmVhdGUgYSB0ZW1wb3JhcnkgdHJhbnNhY3Rpb24KICAgIHRyYW5zID0gbmV3IFRyYW5zYWN0aW9uKGF3YWl0IGxvYWREYihuYW1lKSwgbW9kZSk7CiAgICBhd2FpdCBmdW5jKHRyYW5zKTsKICAgIGF3YWl0IHRyYW5zLndhaXRDb21wbGV0ZSgpOwogIH0KCiAgLy8gTG9ja2luZyBzdHJhdGVneToKICAvLwogIC8vICogV2UgbWFwIHNxbGl0ZSdzIGxvY2tzIG9udG8gSW5kZXhlZERCJ3MgdHJhbnNhY3Rpb24gc2VtYW50aWNzLgogIC8vICAgUmVhZCB0cmFuc2FjdGlvbnMgbWF5IGV4ZWN1dGUgaW4gcGFyYWxsZWwuIFJlYWQvd3JpdGUKICAvLyAgIHRyYW5zYWN0aW9ucyBhcmUgcXVldWVkIHVwIGFuZCB3YWl0IHVudGlsIGFsbCBwcmVjZWRpbmcKICAvLyAgIHJlYWQgdHJhbnNhY3Rpb25zIGZpbmlzaCBleGVjdXRpbmcuIFJlYWQgdHJhbnNhY3Rpb25zIHN0YXJ0ZWQKICAvLyAgIGFmdGVyIGEgcmVhZC93cml0ZSB0cmFuc2FjdGlvbiB3YWl0IHVudGlsIGl0IGlzIGZpbmlzaGVkLgogIC8vCiAgLy8gKiBJREIgdHJhbnNhY3Rpb25zIHdpbGwgd2FpdCBmb3JldmVyIHVudGlsIHRoZXkgY2FuIGV4ZWN1dGUgKGZvcgogIC8vICAgZXhhbXBsZSwgdGhleSBtYXkgYmUgYmxvY2tlZCBvbiBhIHJlYWQvd3JpdGUgdHJhbnNhY3Rpb24pLiBXZQogIC8vICAgZG9uJ3Qgd2FudCB0byBhbGxvdyBzcWxpdGUgdHJhbnNhY3Rpb25zIHRvIHdhaXQgZm9yZXZlciwgc28KICAvLyAgIHdlIG1hbnVhbGx5IHRpbWVvdXQgaWYgYSB0cmFuc2FjdGlvbiB0YWtlcyB0b28gbG9uZyB0bwogIC8vICAgc3RhcnQgZXhlY3V0aW5nLiBUaGlzIHNpbXVsYXRlcyB0aGUgYmVoYXZpb3Igb2YgYSBzcWxpdGUKICAvLyAgIGJhaWxpbmcgaWYgaXQgY2FuJ3QgcmVxdWlyZSBhIGxvY2suCiAgLy8KICAvLyAqIEEgU0hBUkVEIGxvY2sgd2FudHMgdG8gcmVhZCBmcm9tIHRoZSBkYi4gV2Ugc3RhcnQgYSByZWFkCiAgLy8gICB0cmFuc2FjdGlvbiBhbmQgcmVhZCB0aGUgZmlyc3QgYmxvY2ssIGFuZCBpZiB3ZSByZWFkIGl0IHdpdGhpbgogIC8vICAgNTAwbXMgd2UgY29uc2lkZXIgdGhlIGxvY2sgc3VjY2Vzc2Z1bC4gT3RoZXJ3aXNlIHRoZSBsb2NrCiAgLy8gICBmYWlsZWQgYW5kIHdlIHJldHVybiBTUUxJVEVfQlVTWS4gKFRoZXJlJ3Mgbm8gcGVyZiBkb3duc2lkZQogIC8vICAgdG8gcmVhZGluZyB0aGUgZmlyc3QgYmxvY2sgLSBpdCBoYXMgdG8gYmUgcmVhZCBhbnl3YXkgdG8gY2hlY2sKICAvLyAgIGJ5dGVzIDI0LTM5IGZvciB0aGUgY2hhbmdlIGNvdW50ZXIpCiAgLy8KICAvLyAqIEEgUkVTRVJWRUQgbG9jayBtZWFucyB0aGUgZGIgd2FudHMgdG8gc3RhcnQgd3JpdGluZyAodGhpbmsgb2YKICAvLyAgIGBCRUdJTiBUUkFOU0FDVElPTmApLiBPbmx5IG9uZSBwcm9jZXNzIGNhbiBvYnRhaW4gYSBSRVNFUlZFRAogIC8vICAgbG9jayBhdCBhIHRpbWUsIGJ1dCBub3JtYWxseSBzcWxpdGUgc3RpbGwgbGVhZHMgbmV3IHJlYWQgbG9ja3MKICAvLyAgIGhhcHBlbi4gSXQgaXNuJ3QgdW50aWwgYW4gRVhDTFVTSVZFIGxvY2sgaXMgaGVsZCB0aGF0IHJlYWRzIGFyZQogIC8vICAgYmxvY2tlZC4gSG93ZXZlciwgc2luY2Ugd2UgbmVlZCB0byBndWFyYW50ZWUgb25seSBvbmUgUkVTRVJWRUQKICAvLyAgIGxvY2sgYXQgb25jZSAob3RoZXJ3aXNlIGRhdGEgY291bGQgY2hhbmdlIGZyb20gYW5vdGhlciBwcm9jZXNzCiAgLy8gICB3aXRoaW4gYSB0cmFuc2FjdGlvbiwgY2F1c2luZyBmYXVsdHkgY2FjaGVzIGV0YykgdGhlIHNpbXBsZXN0CiAgLy8gICB0aGluZyB0byBkbyBpcyBnbyBhaGVhZCBhbmQgZ3JhYiBhIHJlYWQvd3JpdGUgdHJhbnNhY3Rpb24gdGhhdAogIC8vICAgcmVwcmVzZW50cyB0aGUgUkVTRVJWRUQgbG9jay4gVGhpcyB3aWxsIGJsb2NrIGFsbCByZWFkcyBmcm9tCiAgLy8gICBoYXBwZW5pbmcsIGFuZCBpcyBlc3NlbnRpYWxseSB0aGUgc2FtZSBhcyBhbiBFWENMVVNJVkUgbG9jay4KICAvLwogIC8vICAgICAqIFRoZSBtYWluIHByb2JsZW0gaGVyZSBpcyB3ZSBjYW4ndCAidXBncmFkZSIgYSBgcmVhZG9ubHlgCiAgLy8gICAgICAgdHJhbnNhY3Rpb24gdG8gYHJlYWR3cml0ZWAsIGJ1dCBuYXRpdmUgc3FsaXRlIGNhbiB1cGdyYWRlIGEKICAvLyAgICAgICBsb2NrIGZyb20gU0hBUkVEIHRvIFJFU0VSVkVELiBXZSBuZWVkIHRvIHN0YXJ0IGEgbmV3CiAgLy8gICAgICAgdHJhbnNhY3Rpb24gdG8gZG8gc28sIGFuZCBiZWNhdXNlIG9mIHRoYXQgdGhlcmUgbWlnaHQgYmUKICAvLyAgICAgICBvdGhlciBgcmVhZHdyaXRlYCB0cmFuc2FjdGlvbnMgdGhhdCBnZXQgcnVuIGR1cmluZyB0aGUKICAvLyAgICAgICAidXBncmFkZSIgd2hpY2ggaW52YWxpZGF0ZXMgdGhlIHdob2xlIGxvY2tpbmcgcHJvY2VzcyBhbmQKICAvLyAgICAgICBhbmQgY29ycnVwdHMgZGF0YS4KICAvLwogIC8vICogSWRlYWxseSwgd2UgY291bGQgdGVsbCBzcWxpdGUgdG8gc2tpcCBTSEFSRUQgbG9ja3MgZW50aXJlbHkuIFdlCiAgLy8gICBkb24ndCBuZWVkIHRoZW0gc2luY2Ugd2UgY2FuIHJlbHkgb24gSW5kZXhlZERCJ3Mgc2VtYW50aWNzLgogIC8vICAgVGhlbiB3aGVuIGl0IHdhbnRzIHRvIHN0YXJ0IHdyaXRpbmcsIHdlIGdldCBhIFJFU0VSVkVEIGxvY2sKICAvLyAgIHdpdGhvdXQgaGF2aW5nIHRvIHVwZ3JhZGUgZnJvbSBTSEFSRUQuIFRoaXMgd291bGQgc2F2ZSB1cwogIC8vICAgdGhlIGNvc3Qgb2YgYSBgcmVhZG9ubHlgIHRyYW5zYWN0aW9uIHdoZW4gd3JpdGluZzsgcmlnaHQgbm93CiAgLy8gICBpdCBtdXN0IG9wZW4gYSBgcmVhZG9ubHlgIHRyYW5zYWN0aW9uIGFuZCB0aGVuIGltbWVkaWF0ZWx5IG9wZW4KICAvLyAgIGEgYHJlYWR3cml0ZWAgdG8gdXBncmFkZSBpdC4gSSB0aG91Z2h0IG9mIGRlZmVycmluZyBvcGVuaW5nIHRoZQogIC8vICAgYHJlYWRvbmx5YCB0cmFuc2FjdGlvbiB1bnRpbCBzb21ldGhpbmcgaXMgYWN0dWFsbHkgcmVhZCwgYnV0CiAgLy8gICB1bmZvcnR1bmF0ZWx5IHNxbGl0ZSBvcGVucyBpdCwgcmVhZHMgdGhlIGZpcnN0IGJsb2NrLCBhbmQgdGhlbgogIC8vICAgdXBncmFkZXMgaXQuIFNvIHRoZXJlJ3Mgbm8gd2F5IGFyb3VuZCBpdC4gKFdlIGNhbid0IGFzc3VtZSBpdCdzCiAgLy8gICBhIGByZWFkd3JpdGVgIHRyYW5zYWN0aW9uIGF0IHRoYXQgcG9pbnQgc2luY2UgdGhhdCB3b3VsZCBhc3N1bWUKICAvLyAgIGFsbCBTSEFSRUQgbG9ja3MgYXJlIGByZWFkd3JpdGVgLCByZW1vdmluZyB0aGUgcG9zc2liaWxpdHkgb2YKICAvLyAgIGNvbmN1cnJlbnQgcmVhZHMpLgogIC8vCiAgLy8gKiBVcGdyYWRpbmcgdG8gYW4gRVhDTFVTSVZFIGxvY2sgaXMgYSBub29wLCBzaW5jZSB3ZSB0cmVhdCBSRVNFUlZFRAogIC8vICAgbG9ja3MgYXMgRVhDTFVTSVZFLgogIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZUxvY2sod3JpdGVyLCBuYW1lLCBsb2NrVHlwZSkgewogICAgLy8gY29uc29sZS5sb2coJ2xvY2tpbmcnLCBuYW1lLCBsb2NrVHlwZSwgcGVyZm9ybWFuY2Uubm93KCkpOwoKICAgIGxldCB0cmFucyA9IHRyYW5zYWN0aW9ucy5nZXQobmFtZSk7CiAgICBpZiAodHJhbnMpIHsKICAgICAgaWYgKGxvY2tUeXBlID4gdHJhbnMubG9ja1R5cGUpIHsKICAgICAgICAvLyBVcGdyYWRlIFNIQVJFRCB0byBFWENMVVNJVkUKICAgICAgICBhc3NlcnQoCiAgICAgICAgICB0cmFucy5sb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5TSEFSRUQsCiAgICAgICAgICBgVXByYWRpbmcgbG9jayB0eXBlIGZyb20gJHt0cmFucy5sb2NrVHlwZX0gaXMgaW52YWxpZGAKICAgICAgICApOwogICAgICAgIGFzc2VydCgKICAgICAgICAgIGxvY2tUeXBlID09PSBMT0NLX1RZUEVTLlJFU0VSVkVEIHx8IGxvY2tUeXBlID09PSBMT0NLX1RZUEVTLkVYQ0xVU0lWRSwKICAgICAgICAgIGBVcGdyYWRpbmcgbG9jayB0eXBlIHRvICR7bG9ja1R5cGV9IGlzIGludmFsaWRgCiAgICAgICAgKTsKCiAgICAgICAgbGV0IHN1Y2Nlc3MgPSBhd2FpdCB0cmFucy51cGdyYWRlRXhjbHVzaXZlKCk7CiAgICAgICAgd3JpdGVyLmludDMyKHN1Y2Nlc3MgPyAwIDogLTEpOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICB9IGVsc2UgewogICAgICAgIC8vIElmIG5vdCB1cGdyYWRpbmcgYW5kIHdlIGFscmVhZHkgaGF2ZSBhIGxvY2ssIG1ha2Ugc3VyZSB0aGlzCiAgICAgICAgLy8gaXNuJ3QgYSBkb3duZ3JhZGUKICAgICAgICBhc3NlcnQoCiAgICAgICAgICB0cmFucy5sb2NrVHlwZSA9PT0gbG9ja1R5cGUsCiAgICAgICAgICBgRG93bmdyYWRpbmcgbG9jayB0byAke2xvY2tUeXBlfSBpcyBpbnZhbGlkYAogICAgICAgICk7CgogICAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgICAgfQogICAgfSBlbHNlIHsKICAgICAgYXNzZXJ0KAogICAgICAgIGxvY2tUeXBlID09PSBMT0NLX1RZUEVTLlNIQVJFRCwKICAgICAgICBgTmV3IGxvY2tzIG11c3Qgc3RhcnQgYXMgU0hBUkVEIGluc3RlYWQgb2YgJHtsb2NrVHlwZX1gCiAgICAgICk7CgogICAgICBsZXQgdHJhbnMgPSBuZXcgVHJhbnNhY3Rpb24oYXdhaXQgbG9hZERiKG5hbWUpKTsKICAgICAgaWYgKChhd2FpdCB0cmFucy5wcmVmZXRjaEZpcnN0QmxvY2soNTAwKSkgPT0gbnVsbCkgOwoKICAgICAgdHJhbnNhY3Rpb25zLnNldChuYW1lLCB0cmFucyk7CgogICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlVW5sb2NrKHdyaXRlciwgbmFtZSwgbG9ja1R5cGUpIHsKICAgIC8vIGNvbnNvbGUubG9nKCd1bmxvY2tpbmcnLCBuYW1lLCBsb2NrVHlwZSwgcGVyZm9ybWFuY2Uubm93KCkpOwoKICAgIGxldCB0cmFucyA9IGdldFRyYW5zYWN0aW9uKG5hbWUpOwoKICAgIGlmIChsb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5TSEFSRUQpIHsKICAgICAgaWYgKHRyYW5zID09IG51bGwpIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VubG9jayBlcnJvciAoU0hBUkVEKTogbm8gdHJhbnNhY3Rpb24gcnVubmluZycpOwogICAgICB9CgogICAgICBpZiAodHJhbnMubG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuRVhDTFVTSVZFKSB7CiAgICAgICAgdHJhbnMuZG93bmdyYWRlU2hhcmVkKCk7CiAgICAgIH0KICAgIH0gZWxzZSBpZiAobG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuTk9ORSkgewogICAgICAvLyBJIHRob3VnaHQgd2UgY291bGQgYXNzdW1lIGEgbG9jayBpcyBhbHdheXMgb3BlbiB3aGVuIGB1bmxvY2tgCiAgICAgIC8vIGlzIGNhbGxlZCwgYnV0IGl0IGFsc28gY2FsbHMgYHVubG9ja2Agd2hlbiBjbG9zaW5nIHRoZSBmaWxlIG5vCiAgICAgIC8vIG1hdHRlciB3aGF0LiBEbyBub3RoaW5nIGlmIHRoZXJlJ3Mgbm8gbG9jayBjdXJyZW50bHkKICAgICAgaWYgKHRyYW5zKSB7CiAgICAgICAgLy8gVE9ETzogdGhpcyBpcyB3aGVyZSBhbiBlcnJvciBjb3VsZCBidWJibGUgdXAuIEhhbmRsZSBpdAogICAgICAgIGF3YWl0IHRyYW5zLndhaXRDb21wbGV0ZSgpOwogICAgICAgIHRyYW5zYWN0aW9ucy5kZWxldGUobmFtZSk7CiAgICAgIH0KICAgIH0KCiAgICB3cml0ZXIuaW50MzIoMCk7CiAgICB3cml0ZXIuZmluYWxpemUoKTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZVJlYWQod3JpdGVyLCBuYW1lLCBwb3NpdGlvbikgewogICAgcmV0dXJuIHdpdGhUcmFuc2FjdGlvbihuYW1lLCAncmVhZG9ubHknLCBhc3luYyB0cmFucyA9PiB7CiAgICAgIGxldCBkYXRhID0gYXdhaXQgdHJhbnMucmVhZChwb3NpdGlvbik7CgogICAgICBpZiAoZGF0YSA9PSBudWxsKSB7CiAgICAgICAgd3JpdGVyLmJ5dGVzKG5ldyBBcnJheUJ1ZmZlcigwKSk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgd3JpdGVyLmJ5dGVzKGRhdGEpOwogICAgICB9CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVXcml0ZXMod3JpdGVyLCBuYW1lLCB3cml0ZXMpIHsKICAgIHJldHVybiB3aXRoVHJhbnNhY3Rpb24obmFtZSwgJ3JlYWR3cml0ZScsIGFzeW5jIHRyYW5zID0+IHsKICAgICAgYXdhaXQgdHJhbnMuYnVsa1NldCh3cml0ZXMubWFwKHcgPT4gKHsga2V5OiB3LnBvcywgdmFsdWU6IHcuZGF0YSB9KSkpOwoKICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgIH0pOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlUmVhZE1ldGEod3JpdGVyLCBuYW1lKSB7CiAgICByZXR1cm4gd2l0aFRyYW5zYWN0aW9uKG5hbWUsICdyZWFkb25seScsIGFzeW5jIHRyYW5zID0+IHsKICAgICAgdHJ5IHsKICAgICAgICBjb25zb2xlLmxvZygnUmVhZGluZyBtZXRhJyk7CiAgICAgICAgbGV0IHJlcyA9IGF3YWl0IHRyYW5zLmdldCgtMSk7CiAgICAgICAgY29uc29sZS5sb2coJ1JlYWRpbmcgbWV0YSAoZG9uZSknLCByZXMpOwoKICAgICAgICBsZXQgbWV0YSA9IHJlczsKICAgICAgICB3cml0ZXIuaW50MzIobWV0YSA/IG1ldGEuc2l6ZSA6IC0xKTsKICAgICAgICB3cml0ZXIuaW50MzIobWV0YSA/IG1ldGEuYmxvY2tTaXplIDogLTEpOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICBjb25zb2xlLmxvZyhlcnIpOwogICAgICAgIHdyaXRlci5pbnQzMigtMSk7CiAgICAgICAgd3JpdGVyLmludDMyKC0xKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgICAgfQogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVXcml0ZU1ldGEod3JpdGVyLCBuYW1lLCBtZXRhKSB7CiAgICByZXR1cm4gd2l0aFRyYW5zYWN0aW9uKG5hbWUsICdyZWFkd3JpdGUnLCBhc3luYyB0cmFucyA9PiB7CiAgICAgIHRyeSB7CiAgICAgICAgYXdhaXQgdHJhbnMuc2V0KHsga2V5OiAtMSwgdmFsdWU6IG1ldGEgfSk7CgogICAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgY29uc29sZS5sb2coZXJyKTsKICAgICAgICB3cml0ZXIuaW50MzIoLTEpOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICB9CiAgICB9KTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZURlbGV0ZUZpbGUod3JpdGVyLCBuYW1lKSB7CiAgICB0cnkgewogICAgICBjbG9zZURiKG5hbWUpOwoKICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICAgIGxldCByZXEgPSBnbG9iYWxUaGlzLmluZGV4ZWREQi5kZWxldGVEYXRhYmFzZShuYW1lKTsKICAgICAgICByZXEub25zdWNjZXNzID0gcmVzb2x2ZTsKICAgICAgICByZXEub25lcnJvciA9IHJlamVjdDsKICAgICAgfSk7CgogICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIHdyaXRlci5pbnQzMigtMSk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ2xvc2VGaWxlKHdyaXRlciwgbmFtZSkgewogICAgY2xvc2VEYihuYW1lKTsKCiAgICB3cml0ZXIuaW50MzIoMCk7CiAgICB3cml0ZXIuZmluYWxpemUoKTsKICB9CgogIC8vIGBsaXN0ZW5gIGNvbnRpbnVhbGx5IGxpc3RlbnMgZm9yIHJlcXVlc3RzIHZpYSB0aGUgc2hhcmVkIGJ1ZmZlci4KICAvLyBSaWdodCBub3cgaXQncyBpbXBsZW1lbnRlZCBpbiBhIHRhaWwtY2FsbCBzdHlsZSAoYGxpc3RlbmAgaXMKICAvLyByZWN1cnNpdmVseSBjYWxsZWQpIGJlY2F1c2UgSSB0aG91Z2h0IHRoYXQgd2FzIG5lY2Vzc2FyeSBmb3IKICAvLyB2YXJpb3VzIHJlYXNvbnMuIFdlIGNhbiBjb252ZXJ0IHRoaXMgdG8gYSBgd2hpbGUoMSlgIGxvb3Agd2l0aAogIC8vIGFuZCB1c2UgYGF3YWl0YCB0aG91Z2gKICBhc3luYyBmdW5jdGlvbiBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpIHsKICAgIGxldCBtZXRob2QgPSByZWFkZXIuc3RyaW5nKCk7CgogICAgc3dpdGNoIChtZXRob2QpIHsKICAgICAgY2FzZSAnc3RhdHMtc3RhcnQnOiB7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ3N0YXRzJzogewogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGVuZCgpOwoKICAgICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAnd3JpdGVCbG9ja3MnOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgbGV0IHdyaXRlcyA9IFtdOwogICAgICAgIHdoaWxlICghcmVhZGVyLmRvbmUoKSkgewogICAgICAgICAgbGV0IHBvcyA9IHJlYWRlci5pbnQzMigpOwogICAgICAgICAgbGV0IGRhdGEgPSByZWFkZXIuYnl0ZXMoKTsKICAgICAgICAgIHdyaXRlcy5wdXNoKHsgcG9zLCBkYXRhIH0pOwogICAgICAgIH0KCiAgICAgICAgYXdhaXQgaGFuZGxlV3JpdGVzKHdyaXRlciwgbmFtZSwgd3JpdGVzKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICdyZWFkQmxvY2snOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgbGV0IHBvcyA9IHJlYWRlci5pbnQzMigpOwogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGhhbmRsZVJlYWQod3JpdGVyLCBuYW1lLCBwb3MpOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ3JlYWRNZXRhJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIHJlYWRlci5kb25lKCk7CiAgICAgICAgYXdhaXQgaGFuZGxlUmVhZE1ldGEod3JpdGVyLCBuYW1lKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICd3cml0ZU1ldGEnOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgbGV0IHNpemUgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICBsZXQgYmxvY2tTaXplID0gcmVhZGVyLmludDMyKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKICAgICAgICBhd2FpdCBoYW5kbGVXcml0ZU1ldGEod3JpdGVyLCBuYW1lLCB7IHNpemUsIGJsb2NrU2l6ZSB9KTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICdkZWxldGVGaWxlJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGhhbmRsZURlbGV0ZUZpbGUod3JpdGVyLCBuYW1lKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICdjbG9zZUZpbGUnOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgYXdhaXQgaGFuZGxlQ2xvc2VGaWxlKHdyaXRlciwgbmFtZSk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAnbG9ja0ZpbGUnOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgbGV0IGxvY2tUeXBlID0gcmVhZGVyLmludDMyKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgYXdhaXQgaGFuZGxlTG9jayh3cml0ZXIsIG5hbWUsIGxvY2tUeXBlKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICd1bmxvY2tGaWxlJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIGxldCBsb2NrVHlwZSA9IHJlYWRlci5pbnQzMigpOwogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGhhbmRsZVVubG9jayh3cml0ZXIsIG5hbWUsIGxvY2tUeXBlKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBkZWZhdWx0OgogICAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBtZXRob2Q6ICcgKyBtZXRob2QpOwogICAgfQogIH0KCiAgc2VsZi5vbm1lc3NhZ2UgPSBtc2cgPT4gewogICAgc3dpdGNoIChtc2cuZGF0YS50eXBlKSB7CiAgICAgIGNhc2UgJ2luaXQnOiB7CiAgICAgICAgcG9zdE1lc3NhZ2UoeyB0eXBlOiAnd29ya2VyLXJlYWR5JyB9KTsKICAgICAgICBsZXQgW2FyZ0J1ZmZlciwgcmVzdWx0QnVmZmVyXSA9IG1zZy5kYXRhLmJ1ZmZlcnM7CiAgICAgICAgbGV0IHJlYWRlciA9IG5ldyBSZWFkZXIoYXJnQnVmZmVyLCB7IG5hbWU6ICdhcmdzJywgZGVidWc6IGZhbHNlIH0pOwogICAgICAgIGxldCB3cml0ZXIgPSBuZXcgV3JpdGVyKHJlc3VsdEJ1ZmZlciwgeyBuYW1lOiAncmVzdWx0cycsIGRlYnVnOiBmYWxzZSB9KTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CiAgICB9CiAgfTsKCn0oKSk7Cgo=', null, false);
/* eslint-enable */

let workerReady = null;

function isWorker() {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    self instanceof WorkerGlobalScope
  );
}

function startWorker(argBuffer, resultBuffer) {
  if (workerReady) {
    return workerReady;
  }

  let onReady;
  workerReady = new Promise(resolve => (onReady = resolve));

  if (typeof Worker === 'undefined') {
    // No `Worker` available - this context does not support nested
    // workers sadly. We need to proxy creating a worker to the main
    // thread.
    if (!isWorker()) {
      // We're on the main thread? Weird: it doesn't have workers
      throw new Error(
        'Web workers not available, even from the main thread. sqlite3 requires web workers to work.'
      );
    }

    self.postMessage({
      type: 'spawn-idb-worker',
      argBuffer,
      resultBuffer
    });

    self.addEventListener('message', e => {
      if (e.data.type === 'worker-ready') {
        onReady();
      }
    });
  } else {
    let worker = new WorkerFactory();

    // This is another way to load the worker. It won't be inlined
    // into the script, which might be better for debugging, but makes
    // it more difficult to distribute.
    // let worker = new Worker(new URL('./indexeddb.worker.js', import.meta.url));

    worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

    worker.onmessage = msg => {
      if (msg.data.type === 'worker-ready') {
        onReady();
      }
    };

    return workerReady;
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

class IndexedDBBackend {
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

export default IndexedDBBackend;
