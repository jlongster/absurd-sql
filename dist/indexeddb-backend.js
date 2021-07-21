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

var WorkerFactory = createBase64WorkerFactory('Lyogcm9sbHVwLXBsdWdpbi13ZWItd29ya2VyLWxvYWRlciAqLwooZnVuY3Rpb24gKCkgewogICd1c2Ugc3RyaWN0JzsKCiAgbGV0IEZJTkFMSVpFRCA9IDB4ZGVhZGJlZWY7CgogIGxldCBXUklURUFCTEUgPSAwOwogIGxldCBSRUFEQUJMRSA9IDE7CgogIGNsYXNzIFJlYWRlciB7CiAgICBjb25zdHJ1Y3RvcigKICAgICAgYnVmZmVyLAogICAgICB7IGluaXRpYWxPZmZzZXQgPSA0LCB1c2VBdG9taWNzID0gdHJ1ZSwgc3RyZWFtID0gdHJ1ZSwgZGVidWcsIG5hbWUgfSA9IHt9CiAgICApIHsKICAgICAgdGhpcy5idWZmZXIgPSBidWZmZXI7CiAgICAgIHRoaXMuYXRvbWljVmlldyA9IG5ldyBJbnQzMkFycmF5KGJ1ZmZlcik7CiAgICAgIHRoaXMub2Zmc2V0ID0gaW5pdGlhbE9mZnNldDsKICAgICAgdGhpcy51c2VBdG9taWNzID0gdXNlQXRvbWljczsKICAgICAgdGhpcy5zdHJlYW0gPSBzdHJlYW07CiAgICAgIHRoaXMuZGVidWcgPSBkZWJ1ZzsKICAgICAgdGhpcy5uYW1lID0gbmFtZTsKICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbcmVhZGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0V3JpdGUobmFtZSkgewogICAgICBpZiAodGhpcy51c2VBdG9taWNzKSB7CiAgICAgICAgdGhpcy5sb2coYHdhaXRpbmcgZm9yICR7bmFtZX1gKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBXUklURUFCTEUpIHsKICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCd3YWl0aW5nIGZvciB3cml0ZS4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFLCA1MDApOwogICAgICAgIH0KCiAgICAgICAgdGhpcy5sb2coYHJlc3VtZWQgZm9yICR7bmFtZX1gKTsKICAgICAgfSBlbHNlIHsKICAgICAgICBpZiAodGhpcy5hdG9taWNWaWV3WzBdICE9PSBSRUFEQUJMRSkgewogICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdgd2FpdFdyaXRlYCBleHBlY3RlZCBhcnJheSB0byBiZSByZWFkYWJsZScpOwogICAgICAgIH0KICAgICAgfQogICAgfQoKICAgIGZsaXAoKSB7CiAgICAgIHRoaXMubG9nKCdmbGlwJyk7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICBsZXQgcHJldiA9IEF0b21pY3MuY29tcGFyZUV4Y2hhbmdlKAogICAgICAgICAgdGhpcy5hdG9taWNWaWV3LAogICAgICAgICAgMCwKICAgICAgICAgIFJFQURBQkxFLAogICAgICAgICAgV1JJVEVBQkxFCiAgICAgICAgKTsKCiAgICAgICAgaWYgKHByZXYgIT09IFJFQURBQkxFKSB7CiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlYWQgZGF0YSBvdXQgb2Ygc3luYyEgVGhpcyBpcyBkaXNhc3Ryb3VzJyk7CiAgICAgICAgfQoKICAgICAgICBBdG9taWNzLm5vdGlmeSh0aGlzLmF0b21pY1ZpZXcsIDApOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IFdSSVRFQUJMRTsKICAgICAgfQoKICAgICAgdGhpcy5vZmZzZXQgPSA0OwogICAgfQoKICAgIGRvbmUoKSB7CiAgICAgIHRoaXMud2FpdFdyaXRlKCdkb25lJyk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgbGV0IGRvbmUgPSBkYXRhVmlldy5nZXRVaW50MzIoMCkgPT09IEZJTkFMSVpFRDsKCiAgICAgIGlmIChkb25lKSB7CiAgICAgICAgdGhpcy5sb2coJ2RvbmUnKTsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQoKICAgICAgcmV0dXJuIGRvbmU7CiAgICB9CgogICAgcGVlayhmbikgewogICAgICB0aGlzLnBlZWtPZmZzZXQgPSB0aGlzLm9mZnNldDsKICAgICAgbGV0IHJlcyA9IGZuKCk7CiAgICAgIHRoaXMub2Zmc2V0ID0gdGhpcy5wZWVrT2Zmc2V0OwogICAgICB0aGlzLnBlZWtPZmZzZXQgPSBudWxsOwogICAgICByZXR1cm4gcmVzOwogICAgfQoKICAgIHN0cmluZygpIHsKICAgICAgdGhpcy53YWl0V3JpdGUoJ3N0cmluZycpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSB0aGlzLl9pbnQzMigpOwogICAgICBsZXQgbGVuZ3RoID0gYnl0ZUxlbmd0aCAvIDI7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0LCBieXRlTGVuZ3RoKTsKICAgICAgbGV0IGNoYXJzID0gW107CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHsKICAgICAgICBjaGFycy5wdXNoKGRhdGFWaWV3LmdldFVpbnQxNihpICogMikpOwogICAgICB9CiAgICAgIGxldCBzdHIgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIGNoYXJzKTsKICAgICAgdGhpcy5sb2coJ3N0cmluZycsIHN0cik7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwoKICAgICAgaWYgKHRoaXMucGVla09mZnNldCA9PSBudWxsKSB7CiAgICAgICAgdGhpcy5mbGlwKCk7CiAgICAgIH0KICAgICAgcmV0dXJuIHN0cjsKICAgIH0KCiAgICBfaW50MzIoKSB7CiAgICAgIGxldCBieXRlTGVuZ3RoID0gNDsKCiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBsZXQgbnVtID0gZGF0YVZpZXcuZ2V0SW50MzIoKTsKICAgICAgdGhpcy5sb2coJ19pbnQzMicsIG51bSk7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGludDMyKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgnaW50MzInKTsKICAgICAgbGV0IG51bSA9IHRoaXMuX2ludDMyKCk7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CgogICAgICBpZiAodGhpcy5wZWVrT2Zmc2V0ID09IG51bGwpIHsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGJ5dGVzKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgnYnl0ZXMnKTsKCiAgICAgIGxldCBieXRlTGVuZ3RoID0gdGhpcy5faW50MzIoKTsKCiAgICAgIGxldCBieXRlcyA9IG5ldyBBcnJheUJ1ZmZlcihieXRlTGVuZ3RoKTsKICAgICAgbmV3IFVpbnQ4QXJyYXkoYnl0ZXMpLnNldCgKICAgICAgICBuZXcgVWludDhBcnJheSh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQsIGJ5dGVMZW5ndGgpCiAgICAgICk7CiAgICAgIHRoaXMubG9nKCdieXRlcycsIGJ5dGVzKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CgogICAgICBpZiAodGhpcy5wZWVrT2Zmc2V0ID09IG51bGwpIHsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQogICAgICByZXR1cm4gYnl0ZXM7CiAgICB9CiAgfQoKICBjbGFzcyBXcml0ZXIgewogICAgY29uc3RydWN0b3IoCiAgICAgIGJ1ZmZlciwKICAgICAgeyBpbml0aWFsT2Zmc2V0ID0gNCwgdXNlQXRvbWljcyA9IHRydWUsIHN0cmVhbSA9IHRydWUsIGRlYnVnLCBuYW1lIH0gPSB7fQogICAgKSB7CiAgICAgIHRoaXMuYnVmZmVyID0gYnVmZmVyOwogICAgICB0aGlzLmF0b21pY1ZpZXcgPSBuZXcgSW50MzJBcnJheShidWZmZXIpOwogICAgICB0aGlzLm9mZnNldCA9IGluaXRpYWxPZmZzZXQ7CiAgICAgIHRoaXMudXNlQXRvbWljcyA9IHVzZUF0b21pY3M7CiAgICAgIHRoaXMuc3RyZWFtID0gc3RyZWFtOwoKICAgICAgdGhpcy5kZWJ1ZyA9IGRlYnVnOwogICAgICB0aGlzLm5hbWUgPSBuYW1lOwoKICAgICAgaWYgKHRoaXMudXNlQXRvbWljcykgewogICAgICAgIC8vIFRoZSBidWZmZXIgc3RhcnRzIG91dCBhcyB3cml0ZWFibGUKICAgICAgICBBdG9taWNzLnN0b3JlKHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFKTsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aGlzLmF0b21pY1ZpZXdbMF0gPSBXUklURUFCTEU7CiAgICAgIH0KICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbd3JpdGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0UmVhZChuYW1lKSB7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICB0aGlzLmxvZyhgd2FpdGluZyBmb3IgJHtuYW1lfWApOwogICAgICAgIC8vIFN3aXRjaCB0byB3cml0YWJsZQogICAgICAgIC8vIEF0b21pY3Muc3RvcmUodGhpcy5hdG9taWNWaWV3LCAwLCAxKTsKCiAgICAgICAgbGV0IHByZXYgPSBBdG9taWNzLmNvbXBhcmVFeGNoYW5nZSgKICAgICAgICAgIHRoaXMuYXRvbWljVmlldywKICAgICAgICAgIDAsCiAgICAgICAgICBXUklURUFCTEUsCiAgICAgICAgICBSRUFEQUJMRQogICAgICAgICk7CgogICAgICAgIGlmIChwcmV2ICE9PSBXUklURUFCTEUpIHsKICAgICAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAgICAgJ1dyb3RlIHNvbWV0aGluZyBpbnRvIHVud3JpdGFibGUgYnVmZmVyISBUaGlzIGlzIGRpc2FzdHJvdXMnCiAgICAgICAgICApOwogICAgICAgIH0KCiAgICAgICAgQXRvbWljcy5ub3RpZnkodGhpcy5hdG9taWNWaWV3LCAwKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBSRUFEQUJMRSkgewogICAgICAgICAgLy8gY29uc29sZS5sb2coJ3dhaXRpbmcgdG8gYmUgcmVhZC4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgUkVBREFCTEUsIDUwMCk7CiAgICAgICAgfQoKICAgICAgICB0aGlzLmxvZyhgcmVzdW1lZCBmb3IgJHtuYW1lfWApOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IFJFQURBQkxFOwogICAgICB9CgogICAgICB0aGlzLm9mZnNldCA9IDQ7CiAgICB9CgogICAgZmluYWxpemUoKSB7CiAgICAgIHRoaXMubG9nKCdmaW5hbGl6aW5nJyk7CiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBkYXRhVmlldy5zZXRVaW50MzIoMCwgRklOQUxJWkVEKTsKICAgICAgdGhpcy53YWl0UmVhZCgnZmluYWxpemUnKTsKICAgIH0KCiAgICBzdHJpbmcoc3RyKSB7CiAgICAgIHRoaXMubG9nKCdzdHJpbmcnLCBzdHIpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSBzdHIubGVuZ3RoICogMjsKICAgICAgdGhpcy5faW50MzIoYnl0ZUxlbmd0aCk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0LCBieXRlTGVuZ3RoKTsKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHsKICAgICAgICBkYXRhVmlldy5zZXRVaW50MTYoaSAqIDIsIHN0ci5jaGFyQ29kZUF0KGkpKTsKICAgICAgfQoKICAgICAgdGhpcy5vZmZzZXQgKz0gYnl0ZUxlbmd0aDsKICAgICAgdGhpcy53YWl0UmVhZCgnc3RyaW5nJyk7CiAgICB9CgogICAgX2ludDMyKG51bSkgewogICAgICBsZXQgYnl0ZUxlbmd0aCA9IDQ7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgZGF0YVZpZXcuc2V0SW50MzIoMCwgbnVtKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CiAgICB9CgogICAgaW50MzIobnVtKSB7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CiAgICAgIHRoaXMuX2ludDMyKG51bSk7CiAgICAgIHRoaXMud2FpdFJlYWQoJ2ludDMyJyk7CiAgICB9CgogICAgYnl0ZXMoYnVmZmVyKSB7CiAgICAgIHRoaXMubG9nKCdieXRlcycsIGJ1ZmZlcik7CgogICAgICBsZXQgYnl0ZUxlbmd0aCA9IGJ1ZmZlci5ieXRlTGVuZ3RoOwogICAgICB0aGlzLl9pbnQzMihieXRlTGVuZ3RoKTsKICAgICAgbmV3IFVpbnQ4QXJyYXkodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KS5zZXQobmV3IFVpbnQ4QXJyYXkoYnVmZmVyKSk7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICB0aGlzLndhaXRSZWFkKCdieXRlcycpOwogICAgfQogIH0KCiAgLy8gTm9vcHMgaW4gcHJvZAogIGFzeW5jIGZ1bmN0aW9uIGVuZCgpIHt9CgogIGxldCBpc1Byb2JhYmx5U2FmYXJpID0gL14oKD8hY2hyb21lfGFuZHJvaWQpLikqc2FmYXJpL2kudGVzdCgKICAgIG5hdmlnYXRvci51c2VyQWdlbnQKICApOwoKICBsZXQgb3BlbkRicyA9IG5ldyBNYXAoKTsKICBsZXQgdHJhbnNhY3Rpb25zID0gbmV3IE1hcCgpOwoKICBmdW5jdGlvbiBhc3NlcnQoY29uZCwgbXNnKSB7CiAgICBpZiAoIWNvbmQpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7CiAgICB9CiAgfQoKICBsZXQgTE9DS19UWVBFUyA9IHsKICAgIE5PTkU6IDAsCiAgICBTSEFSRUQ6IDEsCiAgICBSRVNFUlZFRDogMiwKICAgIFBFTkRJTkc6IDMsCiAgICBFWENMVVNJVkU6IDQKICB9OwoKICAvLyBXZSB1c2UgbG9uZy1saXZlZCB0cmFuc2FjdGlvbnMsIGFuZCBgVHJhbnNhY3Rpb25gIGtlZXBzIHRoZQogIC8vIHRyYW5zYWN0aW9uIHN0YXRlLiBJdCBpbXBsZW1lbnRzIGFuIG9wdGltYWwgd2F5IHRvIHBlcmZvcm0KICAvLyByZWFkL3dyaXRlcyB3aXRoIGtub3dsZWRnZSBvZiBob3cgc3FsaXRlIGFza3MgZm9yIHRoZW0sIGFuZCBhbHNvCiAgLy8gaW1wbGVtZW50cyBhIGxvY2tpbmcgbWVjaGFuaXNtIHRoYXQgbWFwcyB0byBob3cgc3FsaXRlIGxvY2tzIHdvcmsuCiAgY2xhc3MgVHJhbnNhY3Rpb24gewogICAgY29uc3RydWN0b3IoZGIsIGluaXRpYWxNb2RlID0gJ3JlYWRvbmx5JykgewogICAgICB0aGlzLmRiID0gZGI7CiAgICAgIHRoaXMudHJhbnMgPSB0aGlzLmRiLnRyYW5zYWN0aW9uKFsnZGF0YSddLCBpbml0aWFsTW9kZSk7CiAgICAgIHRoaXMuc3RvcmUgPSB0aGlzLnRyYW5zLm9iamVjdFN0b3JlKCdkYXRhJyk7CiAgICAgIHRoaXMubG9ja1R5cGUgPQogICAgICAgIGluaXRpYWxNb2RlID09PSAncmVhZG9ubHknID8gTE9DS19UWVBFUy5TSEFSRUQgOiBMT0NLX1RZUEVTLkVYQ0xVU0lWRTsKCiAgICAgIC8vIFRoZXJlIGlzIG5vIG5lZWQgZm9yIHVzIHRvIGNhY2hlIGJsb2Nrcy4gVXNlIHNxbGl0ZSdzCiAgICAgIC8vIGBjYWNoZV9zaXplYCBmb3IgdGhhdCBhbmQgaXQgd2lsbCBhdXRvbWF0aWNhbGx5IGRvIGl0LiBIb3dldmVyLAogICAgICAvLyB3ZSBkbyBzdGlsbCBrZWVwIGEgY2FjaGUgb2YgdGhlIGZpcnN0IGJsb2NrIGZvciB0aGUgZHVyYXRpb24gb2YKICAgICAgLy8gdGhpcyB0cmFuc2FjdGlvbiBiZWNhdXNlIG9mIGhvdyBsb2NraW5nIHdvcmtzOyB0aGlzIGF2b2lkcyBhCiAgICAgIC8vIGZldyBleHRyYSByZWFkcyBhbmQgYWxsb3dzIHVzIHRvIGRldGVjdCBjaGFuZ2VzIGR1cmluZwogICAgICAvLyB1cGdyYWRpbmcgKHNlZSBgdXBncmFkZUV4Y2x1c2l2ZWApCiAgICAgIHRoaXMuY2FjaGVkRmlyc3RCbG9jayA9IG51bGw7CgogICAgICB0aGlzLmN1cnNvciA9IG51bGw7CiAgICAgIHRoaXMucHJldlJlYWRzID0gbnVsbDsKICAgIH0KCiAgICBhc3luYyBwcmVmZXRjaEZpcnN0QmxvY2sodGltZW91dCkgewogICAgICAvLyBUT0RPOiBpbXBsZW1lbnQgdGltZW91dAoKICAgICAgLy8gR2V0IHRoZSBmaXJzdCBibG9jayBhbmQgY2FjaGUgaXQKICAgICAgbGV0IGJsb2NrID0gYXdhaXQgdGhpcy5nZXQoMCk7CiAgICAgIHRoaXMuY2FjaGVkRmlyc3RCbG9jayA9IGJsb2NrOwogICAgICByZXR1cm4gYmxvY2s7CiAgICB9CgogICAgYXN5bmMgd2FpdENvbXBsZXRlKCkgewogICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICAgIC8vIEVhZ2VybHkgY29tbWl0IGl0IGZvciBiZXR0ZXIgcGVyZi4gTm90ZSB0aGF0ICoqdGhpcyBhc3N1bWVzCiAgICAgICAgLy8gdGhlIHRyYW5zYWN0aW9uIGlzIG9wZW4qKiBhcyBgY29tbWl0YCB3aWxsIHRocm93IGFuIGVycm9yIGlmCiAgICAgICAgLy8gaXQncyBhbHJlYWR5IGNsb3NlZCAod2hpY2ggc2hvdWxkIG5ldmVyIGJlIHRoZSBjYXNlIGZvciB1cykKICAgICAgICB0aGlzLmNvbW1pdCgpOwoKICAgICAgICBpZiAodGhpcy5sb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5FWENMVVNJVkUpIHsKICAgICAgICAgIC8vIFdhaXQgdW50aWwgYWxsIHdyaXRlcyBhcmUgY29tbWl0dGVkCiAgICAgICAgICB0aGlzLnRyYW5zLm9uY29tcGxldGUgPSBlID0+IHJlc29sdmUoKTsKCiAgICAgICAgICAvLyBUT0RPOiBJcyBpdCBPSyB0byBhZGQgdGhpcyBsYXRlciwgYWZ0ZXIgYW4gZXJyb3IgbWlnaHQgaGF2ZQogICAgICAgICAgLy8gaGFwcGVuZWQ/IFdpbGwgaXQgaG9sZCB0aGUgZXJyb3IgYW5kIGZpcmUgdGhpcyB3aGVuIHdlCiAgICAgICAgICAvLyBhdHRhY2hlZCBpdD8gV2UgbWlnaHQgd2FudCB0byBlYWdlcmx5IGNyZWF0ZSB0aGUgcHJvbWlzZQogICAgICAgICAgLy8gd2hlbiBjcmVhdGluZyB0aGUgdHJhbnNhY3Rpb24gYW5kIHJldHVybiBpdCBoZXJlCiAgICAgICAgICB0aGlzLnRyYW5zLm9uZXJyb3IgPSBlID0+IHJlamVjdChlKTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgaWYgKGlzUHJvYmFibHlTYWZhcmkpIHsKICAgICAgICAgICAgLy8gU2FmYXJpIGhhcyBhIGJ1ZyB3aGVyZSBzb21ldGltZXMgdGhlIElEQiBnZXRzIGJsb2NrZWQKICAgICAgICAgICAgLy8gcGVybWFuZW50bHkgaWYgeW91IHJlZnJlc2ggdGhlIHBhZ2Ugd2l0aCBhbiBvcGVuCiAgICAgICAgICAgIC8vIHRyYW5zYWN0aW9uLiBZb3UgaGF2ZSB0byByZXN0YXJ0IHRoZSBicm93c2VyIHRvIGZpeCBpdC4KICAgICAgICAgICAgLy8gV2Ugd2FpdCBmb3IgcmVhZG9ubHkgdHJhbnNhY3Rpb25zIHRvIGZpbmlzaCB0b28sIGJ1dCB0aGlzCiAgICAgICAgICAgIC8vIGlzIGEgcGVyZiBoaXQKICAgICAgICAgICAgdGhpcy50cmFucy5vbmNvbXBsZXRlID0gZSA9PiByZXNvbHZlKCk7CiAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICAvLyBObyBuZWVkIHRvIHdhaXQgb24gYW55dGhpbmcgaW4gYSByZWFkLW9ubHkgdHJhbnNhY3Rpb24uCiAgICAgICAgICAgIC8vIE5vdGUgdGhhdCBlcnJvcnMgZHVyaW5nIHJlYWRzIGFyZWEgYWx3YXlzIGhhbmRsZWQgYnkgdGhlCiAgICAgICAgICAgIC8vIHJlYWQgcmVxdWVzdC4KICAgICAgICAgICAgcmVzb2x2ZSgpOwogICAgICAgICAgfQogICAgICAgIH0KICAgICAgfSk7CiAgICB9CgogICAgY29tbWl0KCkgewogICAgICAvLyBTYWZhcmkgZG9lc24ndCBzdXBwb3J0IHRoaXMgbWV0aG9kIHlldCAodGhpcyBpcyBqdXN0IGFuCiAgICAgIC8vIG9wdGltaXphdGlvbikKICAgICAgaWYgKHRoaXMudHJhbnMuY29tbWl0KSB7CiAgICAgICAgdGhpcy50cmFucy5jb21taXQoKTsKICAgICAgfQogICAgfQoKICAgIGFzeW5jIHVwZ3JhZGVFeGNsdXNpdmUoKSB7CiAgICAgIHRoaXMuY29tbWl0KCk7CgogICAgICAvLyBjb25zb2xlLmxvZygndXBkYXRpbmcgdHJhbnNhY3Rpb24gcmVhZHdyaXRlJyk7CiAgICAgIHRoaXMudHJhbnMgPSB0aGlzLmRiLnRyYW5zYWN0aW9uKFsnZGF0YSddLCAncmVhZHdyaXRlJyk7CiAgICAgIHRoaXMuc3RvcmUgPSB0aGlzLnRyYW5zLm9iamVjdFN0b3JlKCdkYXRhJyk7CiAgICAgIHRoaXMubG9ja1R5cGUgPSBMT0NLX1RZUEVTLkVYQ0xVU0lWRTsKCiAgICAgIGxldCBjYWNoZWQwID0gdGhpcy5jYWNoZWRGaXJzdEJsb2NrOwoKICAgICAgLy8gRG8gYSByZWFkCiAgICAgIGxldCBibG9jayA9IGF3YWl0IHRoaXMucHJlZmV0Y2hGaXJzdEJsb2NrKDUwMCk7CiAgICAgIC8vIFRPRE86IHdoZW4gdGltZW91dHMgYXJlIGltcGxlbWVudGVkLCBkZXRlY3QgdGltZW91dCBhbmQgcmV0dXJuIEJVU1kKCiAgICAgIGlmIChjYWNoZWQwID09IG51bGwgJiYgYmxvY2sgPT0gbnVsbCkgewogICAgICAgIHJldHVybiB0cnVlOwogICAgICB9IGVsc2UgewogICAgICAgIGZvciAobGV0IGkgPSAyNDsgaSA8IDQwOyBpKyspIHsKICAgICAgICAgIGlmIChibG9ja1tpXSAhPT0gY2FjaGVkMFtpXSkgewogICAgICAgICAgICByZXR1cm4gZmFsc2U7CiAgICAgICAgICB9CiAgICAgICAgfQogICAgICB9CgogICAgICByZXR1cm4gdHJ1ZTsKICAgIH0KCiAgICBkb3duZ3JhZGVTaGFyZWQoKSB7CiAgICAgIHRoaXMuY29tbWl0KCk7CgogICAgICAvLyBjb25zb2xlLmxvZygnZG93bmdyYWRpbmcgdHJhbnNhY3Rpb24gcmVhZG9ubHknKTsKICAgICAgdGhpcy50cmFucyA9IHRoaXMuZGIudHJhbnNhY3Rpb24oWydkYXRhJ10sICdyZWFkb25seScpOwogICAgICB0aGlzLnN0b3JlID0gdGhpcy50cmFucy5vYmplY3RTdG9yZSgnZGF0YScpOwogICAgICB0aGlzLmxvY2tUeXBlID0gTE9DS19UWVBFUy5TSEFSRUQ7CiAgICB9CgogICAgYXN5bmMgZ2V0KGtleSkgewogICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICAgIGxldCByZXEgPSB0aGlzLnN0b3JlLmdldChrZXkpOwogICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBlID0+IHsKICAgICAgICAgIHJlc29sdmUocmVxLnJlc3VsdCk7CiAgICAgICAgfTsKICAgICAgICByZXEub25lcnJvciA9IGUgPT4gcmVqZWN0KGUpOwogICAgICB9KTsKICAgIH0KCiAgICBnZXRSZWFkRGlyZWN0aW9uKCkgewogICAgICAvLyBUaGVyZSBhcmUgYSB0d28gd2F5cyB3ZSBjYW4gcmVhZCBkYXRhOiBhIGRpcmVjdCBgZ2V0YCByZXF1ZXN0CiAgICAgIC8vIG9yIG9wZW5pbmcgYSBjdXJzb3IgYW5kIGl0ZXJhdGluZyB0aHJvdWdoIGRhdGEuIFdlIGRvbid0IGtub3cKICAgICAgLy8gd2hhdCBmdXR1cmUgcmVhZHMgbG9vayBsaWtlLCBzbyB3ZSBkb24ndCBrbm93IHRoZSBiZXN0IHN0cmF0ZWd5CiAgICAgIC8vIHRvIHBpY2suIEFsd2F5cyBjaG9vc2luZyBvbmUgc3RyYXRlZ3kgZm9yZ29lcyBhIGxvdCBvZgogICAgICAvLyBvcHRpbWl6YXRpb24sIGJlY2F1c2UgaXRlcmF0aW5nIHdpdGggYSBjdXJzb3IgaXMgYSBsb3QgZmFzdGVyCiAgICAgIC8vIHRoYW4gbWFueSBgZ2V0YCBjYWxscy4gT24gdGhlIG90aGVyIGhhbmQsIG9wZW5pbmcgYSBjdXJzb3IgaXMKICAgICAgLy8gc2xvdywgYW5kIHNvIGlzIGNhbGxpbmcgYGFkdmFuY2VgIHRvIG1vdmUgYSBjdXJzb3Igb3ZlciBhIGh1Z2UKICAgICAgLy8gcmFuZ2UgKGxpa2UgbW92aW5nIGl0IDEwMDAgaXRlbXMgbGF0ZXIpLCBzbyBtYW55IGBnZXRgIGNhbGxzIHdvdWxkCiAgICAgIC8vIGJlIGZhc3Rlci4gSW4gZ2VuZXJhbDoKICAgICAgLy8KICAgICAgLy8gKiBNYW55IGBnZXRgIGNhbGxzIGFyZSBmYXN0ZXIgd2hlbiBkb2luZyByYW5kb20gYWNjZXNzZXMKICAgICAgLy8gKiBJdGVyYXRpbmcgd2l0aCBhIGN1cnNvciBpcyBmYXN0ZXIgaWYgZG9pbmcgbW9zdGx5IHNlcXVlbnRpYWwKICAgICAgLy8gICBhY2Nlc3NlcwogICAgICAvLwogICAgICAvLyBXZSBpbXBsZW1lbnQgYSBoZXVyaXN0aWMgYW5kIGtlZXBzIHRyYWNrIG9mIHRoZSBsYXN0IDMgcmVhZHMKICAgICAgLy8gYW5kIGRldGVjdHMgd2hlbiB0aGV5IGFyZSBtb3N0bHkgc2VxdWVudGlhbC4gSWYgdGhleSBhcmUsIHdlCiAgICAgIC8vIG9wZW4gYSBjdXJzb3IgYW5kIHN0YXJ0IHJlYWRpbmcgYnkgaXRlcmF0aW5nIGl0LiBJZiBub3QsIHdlIGRvCiAgICAgIC8vIGRpcmVjdCBgZ2V0YCBjYWxscy4KICAgICAgLy8KICAgICAgLy8gT24gdG9wIG9mIGFsbCBvZiB0aGlzLCBlYWNoIGJyb3dzZXIgaGFzIGRpZmZlcmVudCBwZXJmCiAgICAgIC8vIGNoYXJhY3RlcmlzdGljcy4gV2Ugd2lsbCBwcm9iYWJseSB3YW50IHRvIG1ha2UgdGhlc2UgdGhyZXNob2xkcwogICAgICAvLyBjb25maWd1cmFibGUgc28gdGhlIHVzZXIgY2FuIGNoYW5nZSB0aGVtIHBlci1icm93c2VyIGlmIG5lZWRlZCwKICAgICAgLy8gYXMgd2VsbCBhcyBmaW5lLXR1bmluZyB0aGVtIGZvciB0aGVpciB1c2FnZSBvZiBzcWxpdGUuCgogICAgICBsZXQgcHJldlJlYWRzID0gdGhpcy5wcmV2UmVhZHM7CiAgICAgIGlmIChwcmV2UmVhZHMpIHsKICAgICAgICAvLyBIYXMgdGhlcmUgYmVlbiAzIGZvcndhcmQgc2VxdWVudGlhbCByZWFkcyB3aXRoaW4gMTAgYmxvY2tzPwogICAgICAgIGlmICgKICAgICAgICAgIHByZXZSZWFkc1swXSA8IHByZXZSZWFkc1sxXSAmJgogICAgICAgICAgcHJldlJlYWRzWzFdIDwgcHJldlJlYWRzWzJdICYmCiAgICAgICAgICBwcmV2UmVhZHNbMl0gLSBwcmV2UmVhZHNbMF0gPCAxMAogICAgICAgICkgewogICAgICAgICAgcmV0dXJuICduZXh0JzsKICAgICAgICB9CgogICAgICAgIC8vIEhhcyB0aGVyZSBiZWVuIDMgYmFja3dhcmRzIHNlcXVlbnRpYWwgcmVhZHMgd2l0aGluIDEwIGJsb2Nrcz8KICAgICAgICBpZiAoCiAgICAgICAgICBwcmV2UmVhZHNbMF0gPiBwcmV2UmVhZHNbMV0gJiYKICAgICAgICAgIHByZXZSZWFkc1sxXSA+IHByZXZSZWFkc1syXSAmJgogICAgICAgICAgcHJldlJlYWRzWzBdIC0gcHJldlJlYWRzWzJdIDwgMTAKICAgICAgICApIHsKICAgICAgICAgIHJldHVybiAncHJldic7CiAgICAgICAgfQogICAgICB9CgogICAgICByZXR1cm4gbnVsbDsKICAgIH0KCiAgICByZWFkKHBvc2l0aW9uKSB7CiAgICAgIGxldCB3YWl0Q3Vyc29yID0gKCkgPT4gewogICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgICAgICBpZiAodGhpcy5jdXJzb3JQcm9taXNlICE9IG51bGwpIHsKICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICAgICAgICd3YWl0Q3Vyc29yKCkgY2FsbGVkIGJ1dCBzb21ldGhpbmcgZWxzZSBpcyBhbHJlYWR5IHdhaXRpbmcnCiAgICAgICAgICAgICk7CiAgICAgICAgICB9CiAgICAgICAgICB0aGlzLmN1cnNvclByb21pc2UgPSB7IHJlc29sdmUsIHJlamVjdCB9OwogICAgICAgIH0pOwogICAgICB9OwoKICAgICAgaWYgKHRoaXMuY3Vyc29yKSB7CiAgICAgICAgbGV0IGN1cnNvciA9IHRoaXMuY3Vyc29yOwoKICAgICAgICBpZiAoCiAgICAgICAgICBjdXJzb3IuZGlyZWN0aW9uID09PSAnbmV4dCcgJiYKICAgICAgICAgIHBvc2l0aW9uID4gY3Vyc29yLmtleSAmJgogICAgICAgICAgcG9zaXRpb24gPCBjdXJzb3Iua2V5ICsgMTAwCiAgICAgICAgKSB7CgogICAgICAgICAgY3Vyc29yLmFkdmFuY2UocG9zaXRpb24gLSBjdXJzb3Iua2V5KTsKICAgICAgICAgIHJldHVybiB3YWl0Q3Vyc29yKCk7CiAgICAgICAgfSBlbHNlIGlmICgKICAgICAgICAgIGN1cnNvci5kaXJlY3Rpb24gPT09ICdwcmV2JyAmJgogICAgICAgICAgcG9zaXRpb24gPCBjdXJzb3Iua2V5ICYmCiAgICAgICAgICBwb3NpdGlvbiA+IGN1cnNvci5rZXkgLSAxMDAKICAgICAgICApIHsKCiAgICAgICAgICBjdXJzb3IuYWR2YW5jZShjdXJzb3Iua2V5IC0gcG9zaXRpb24pOwogICAgICAgICAgcmV0dXJuIHdhaXRDdXJzb3IoKTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgLy8gRGl0Y2ggdGhlIGN1cnNvcgogICAgICAgICAgdGhpcy5jdXJzb3IgPSBudWxsOwogICAgICAgICAgcmV0dXJuIHRoaXMucmVhZChwb3NpdGlvbik7CiAgICAgICAgfQogICAgICB9IGVsc2UgewogICAgICAgIC8vIFdlIGRvbid0IGFscmVhZHkgaGF2ZSBhIGN1cnNvci4gV2UgbmVlZCB0byBhIGZyZXNoIHJlYWQ7CiAgICAgICAgLy8gc2hvdWxkIHdlIG9wZW4gYSBjdXJzb3Igb3IgY2FsbCBgZ2V0YD8KCiAgICAgICAgbGV0IGRpciA9IHRoaXMuZ2V0UmVhZERpcmVjdGlvbigpOwogICAgICAgIGlmIChkaXIpIHsKICAgICAgICAgIC8vIE9wZW4gYSBjdXJzb3IKICAgICAgICAgIHRoaXMucHJldlJlYWRzID0gbnVsbDsKCiAgICAgICAgICBsZXQga2V5UmFuZ2U7CiAgICAgICAgICBpZiAoZGlyID09PSAncHJldicpIHsKICAgICAgICAgICAga2V5UmFuZ2UgPSBJREJLZXlSYW5nZS51cHBlckJvdW5kKHBvc2l0aW9uKTsKICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgIGtleVJhbmdlID0gSURCS2V5UmFuZ2UubG93ZXJCb3VuZChwb3NpdGlvbik7CiAgICAgICAgICB9CgogICAgICAgICAgbGV0IHJlcSA9IHRoaXMuc3RvcmUub3BlbkN1cnNvcihrZXlSYW5nZSwgZGlyKTsKCiAgICAgICAgICByZXEub25zdWNjZXNzID0gZSA9PiB7CgogICAgICAgICAgICBsZXQgY3Vyc29yID0gZS50YXJnZXQucmVzdWx0OwogICAgICAgICAgICB0aGlzLmN1cnNvciA9IGN1cnNvcjsKCiAgICAgICAgICAgIGlmICh0aGlzLmN1cnNvclByb21pc2UgPT0gbnVsbCkgewogICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignR290IGRhdGEgZnJvbSBjdXJzb3IgYnV0IG5vdGhpbmcgaXMgd2FpdGluZyBpdCcpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIHRoaXMuY3Vyc29yUHJvbWlzZS5yZXNvbHZlKGN1cnNvciA/IGN1cnNvci52YWx1ZSA6IG51bGwpOwogICAgICAgICAgICB0aGlzLmN1cnNvclByb21pc2UgPSBudWxsOwogICAgICAgICAgfTsKICAgICAgICAgIHJlcS5vbmVycm9yID0gZSA9PiB7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdDdXJzb3IgZmFpbHVyZTonLCBlKTsKCiAgICAgICAgICAgIGlmICh0aGlzLmN1cnNvclByb21pc2UgPT0gbnVsbCkgewogICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignR290IGRhdGEgZnJvbSBjdXJzb3IgYnV0IG5vdGhpbmcgaXMgd2FpdGluZyBpdCcpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIHRoaXMuY3Vyc29yUHJvbWlzZS5yZWplY3QoZSk7CiAgICAgICAgICAgIHRoaXMuY3Vyc29yUHJvbWlzZSA9IG51bGw7CiAgICAgICAgICB9OwoKICAgICAgICAgIHJldHVybiB3YWl0Q3Vyc29yKCk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIGlmICh0aGlzLnByZXZSZWFkcyA9PSBudWxsKSB7CiAgICAgICAgICAgIHRoaXMucHJldlJlYWRzID0gWzAsIDAsIDBdOwogICAgICAgICAgfQogICAgICAgICAgdGhpcy5wcmV2UmVhZHMucHVzaChwb3NpdGlvbik7CiAgICAgICAgICB0aGlzLnByZXZSZWFkcy5zaGlmdCgpOwoKICAgICAgICAgIHJldHVybiB0aGlzLmdldChwb3NpdGlvbik7CiAgICAgICAgfQogICAgICB9CiAgICB9CgogICAgYXN5bmMgc2V0KGl0ZW0pIHsKICAgICAgdGhpcy5wcmV2UmVhZHMgPSBudWxsOwoKICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgICBsZXQgcmVxID0gdGhpcy5zdG9yZS5wdXQoaXRlbS52YWx1ZSwgaXRlbS5rZXkpOwogICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBlID0+IHJlc29sdmUocmVxLnJlc3VsdCk7CiAgICAgICAgcmVxLm9uZXJyb3IgPSBlID0+IHJlamVjdChlKTsKICAgICAgfSk7CiAgICB9CgogICAgYXN5bmMgYnVsa1NldChpdGVtcykgewogICAgICB0aGlzLnByZXZSZWFkcyA9IG51bGw7CgogICAgICBmb3IgKGxldCBpdGVtIG9mIGl0ZW1zKSB7CiAgICAgICAgdGhpcy5zdG9yZS5wdXQoaXRlbS52YWx1ZSwgaXRlbS5rZXkpOwogICAgICB9CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBsb2FkRGIobmFtZSkgewogICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgaWYgKG9wZW5EYnMuZ2V0KG5hbWUpKSB7CiAgICAgICAgcmVzb2x2ZShvcGVuRGJzLmdldChuYW1lKSk7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBsZXQgcmVxID0gZ2xvYmFsVGhpcy5pbmRleGVkREIub3BlbihuYW1lLCAxKTsKICAgICAgcmVxLm9uc3VjY2VzcyA9IGV2ZW50ID0+IHsKICAgICAgICBjb25zb2xlLmxvZygnZGIgaXMgb3BlbiEnLCBuYW1lKTsKICAgICAgICBsZXQgZGIgPSBldmVudC50YXJnZXQucmVzdWx0OwoKICAgICAgICBkYi5vbnZlcnNpb25jaGFuZ2UgPSAoKSA9PiB7CiAgICAgICAgICAvLyBUT0RPOiBOb3RpZnkgdGhlIHVzZXIgc29tZWhvdwogICAgICAgICAgY29uc29sZS5sb2coJ2Nsb3NpbmcgYmVjYXVzZSB2ZXJzaW9uIGNoYW5nZWQnKTsKICAgICAgICAgIGRiLmNsb3NlKCk7CiAgICAgICAgfTsKCiAgICAgICAgZGIub25jbG9zZSA9ICgpID0+IHsKICAgICAgICAgIG9wZW5EYnMuZGVsZXRlKG5hbWUpOwogICAgICAgIH07CgogICAgICAgIG9wZW5EYnMuc2V0KG5hbWUsIGRiKTsKICAgICAgICByZXNvbHZlKGRiKTsKICAgICAgfTsKICAgICAgcmVxLm9udXBncmFkZW5lZWRlZCA9IGV2ZW50ID0+IHsKICAgICAgICBsZXQgZGIgPSBldmVudC50YXJnZXQucmVzdWx0OwogICAgICAgIGlmICghZGIub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygnZGF0YScpKSB7CiAgICAgICAgICBkYi5jcmVhdGVPYmplY3RTdG9yZSgnZGF0YScpOwogICAgICAgIH0KICAgICAgfTsKICAgICAgcmVxLm9uYmxvY2tlZCA9IGUgPT4gY29uc29sZS5sb2coJ2Jsb2NrZWQnLCBlKTsKICAgICAgcmVxLm9uZXJyb3IgPSByZXEub25hYm9ydCA9IGUgPT4gcmVqZWN0KGUudGFyZ2V0LmVycm9yKTsKICAgIH0pOwogIH0KCiAgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb24obmFtZSkgewogICAgcmV0dXJuIHRyYW5zYWN0aW9ucy5nZXQobmFtZSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiB3aXRoVHJhbnNhY3Rpb24obmFtZSwgbW9kZSwgZnVuYykgewogICAgbGV0IHRyYW5zID0gdHJhbnNhY3Rpb25zLmdldChuYW1lKTsKICAgIGlmICh0cmFucykgewogICAgICAvLyBJZiBhIHRyYW5zYWN0aW9uIGFscmVhZHkgZXhpc3RzLCB0aGF0IG1lYW5zIHRoZSBmaWxlIGhhcyBiZWVuCiAgICAgIC8vIGxvY2tlZC4gV2UgZG9uJ3QgZnVsbHkgc3VwcG9ydCBhcmJpdHJhcnkgbmVzdGVkIHRyYW5zYWN0aW9ucywKICAgICAgLy8gYXMgc2VlbiBiZWxvdyAod2Ugd29uJ3QgdXBncmFkZSBhIGByZWFkb25seWAgdG8gYHJlYWR3cml0ZWAKICAgICAgLy8gYXV0b21hdGljYWxseSkgYW5kIHRoaXMgaXMgbWFpbmx5IGZvciB0aGUgdXNlIGNhc2Ugd2hlcmUgc3FsaXRlCiAgICAgIC8vIGxvY2tzIHRoZSBkYiBhbmQgY3JlYXRlcyBhIHRyYW5zYWN0aW9uIGZvciB0aGUgZHVyYWN0aW9uIG9mIHRoZQogICAgICAvLyBsb2NrLiBXZSBkb24ndCBhY3R1YWxseSB3cml0ZSBjb2RlIGluIGEgd2F5IHRoYXQgYXNzdW1lcyBuZXN0ZWQKICAgICAgLy8gdHJhbnNhY3Rpb25zLCBzbyBqdXN0IGVycm9yIGhlcmUKICAgICAgaWYgKG1vZGUgPT09ICdyZWFkd3JpdGUnICYmIHRyYW5zLmxvY2tUeXBlID09PSBMT0NLX1RZUEVTLlNIQVJFRCkgewogICAgICAgIHRocm93IG5ldyBFcnJvcignQXR0ZW1wdGVkIHdyaXRlIGJ1dCBvbmx5IGhhcyBTSEFSRUQgbG9jaycpOwogICAgICB9CiAgICAgIHJldHVybiBmdW5jKHRyYW5zKTsKICAgIH0KCiAgICAvLyBPdXRzaWRlIHRoZSBzY29wZSBvZiBhIGxvY2ssIGNyZWF0ZSBhIHRlbXBvcmFyeSB0cmFuc2FjdGlvbgogICAgdHJhbnMgPSBuZXcgVHJhbnNhY3Rpb24oYXdhaXQgbG9hZERiKG5hbWUpLCBtb2RlKTsKICAgIGF3YWl0IGZ1bmModHJhbnMpOwogICAgYXdhaXQgdHJhbnMud2FpdENvbXBsZXRlKCk7CiAgfQoKICAvLyBMb2NraW5nIHN0cmF0ZWd5OgogIC8vCiAgLy8gKiBXZSBtYXAgc3FsaXRlJ3MgbG9ja3Mgb250byBJbmRleGVkREIncyB0cmFuc2FjdGlvbiBzZW1hbnRpY3MuCiAgLy8gICBSZWFkIHRyYW5zYWN0aW9ucyBtYXkgZXhlY3V0ZSBpbiBwYXJhbGxlbC4gUmVhZC93cml0ZQogIC8vICAgdHJhbnNhY3Rpb25zIGFyZSBxdWV1ZWQgdXAgYW5kIHdhaXQgdW50aWwgYWxsIHByZWNlZGluZwogIC8vICAgcmVhZCB0cmFuc2FjdGlvbnMgZmluaXNoIGV4ZWN1dGluZy4gUmVhZCB0cmFuc2FjdGlvbnMgc3RhcnRlZAogIC8vICAgYWZ0ZXIgYSByZWFkL3dyaXRlIHRyYW5zYWN0aW9uIHdhaXQgdW50aWwgaXQgaXMgZmluaXNoZWQuCiAgLy8KICAvLyAqIElEQiB0cmFuc2FjdGlvbnMgd2lsbCB3YWl0IGZvcmV2ZXIgdW50aWwgdGhleSBjYW4gZXhlY3V0ZSAoZm9yCiAgLy8gICBleGFtcGxlLCB0aGV5IG1heSBiZSBibG9ja2VkIG9uIGEgcmVhZC93cml0ZSB0cmFuc2FjdGlvbikuIFdlCiAgLy8gICBkb24ndCB3YW50IHRvIGFsbG93IHNxbGl0ZSB0cmFuc2FjdGlvbnMgdG8gd2FpdCBmb3JldmVyLCBzbwogIC8vICAgd2UgbWFudWFsbHkgdGltZW91dCBpZiBhIHRyYW5zYWN0aW9uIHRha2VzIHRvbyBsb25nIHRvCiAgLy8gICBzdGFydCBleGVjdXRpbmcuIFRoaXMgc2ltdWxhdGVzIHRoZSBiZWhhdmlvciBvZiBhIHNxbGl0ZQogIC8vICAgYmFpbGluZyBpZiBpdCBjYW4ndCByZXF1aXJlIGEgbG9jay4KICAvLwogIC8vICogQSBTSEFSRUQgbG9jayB3YW50cyB0byByZWFkIGZyb20gdGhlIGRiLiBXZSBzdGFydCBhIHJlYWQKICAvLyAgIHRyYW5zYWN0aW9uIGFuZCByZWFkIHRoZSBmaXJzdCBibG9jaywgYW5kIGlmIHdlIHJlYWQgaXQgd2l0aGluCiAgLy8gICA1MDBtcyB3ZSBjb25zaWRlciB0aGUgbG9jayBzdWNjZXNzZnVsLiBPdGhlcndpc2UgdGhlIGxvY2sKICAvLyAgIGZhaWxlZCBhbmQgd2UgcmV0dXJuIFNRTElURV9CVVNZLiAoVGhlcmUncyBubyBwZXJmIGRvd25zaWRlCiAgLy8gICB0byByZWFkaW5nIHRoZSBmaXJzdCBibG9jayAtIGl0IGhhcyB0byBiZSByZWFkIGFueXdheSB0byBjaGVjawogIC8vICAgYnl0ZXMgMjQtMzkgZm9yIHRoZSBjaGFuZ2UgY291bnRlcikKICAvLwogIC8vICogQSBSRVNFUlZFRCBsb2NrIG1lYW5zIHRoZSBkYiB3YW50cyB0byBzdGFydCB3cml0aW5nICh0aGluayBvZgogIC8vICAgYEJFR0lOIFRSQU5TQUNUSU9OYCkuIE9ubHkgb25lIHByb2Nlc3MgY2FuIG9idGFpbiBhIFJFU0VSVkVECiAgLy8gICBsb2NrIGF0IGEgdGltZSwgYnV0IG5vcm1hbGx5IHNxbGl0ZSBzdGlsbCBsZWFkcyBuZXcgcmVhZCBsb2NrcwogIC8vICAgaGFwcGVuLiBJdCBpc24ndCB1bnRpbCBhbiBFWENMVVNJVkUgbG9jayBpcyBoZWxkIHRoYXQgcmVhZHMgYXJlCiAgLy8gICBibG9ja2VkLiBIb3dldmVyLCBzaW5jZSB3ZSBuZWVkIHRvIGd1YXJhbnRlZSBvbmx5IG9uZSBSRVNFUlZFRAogIC8vICAgbG9jayBhdCBvbmNlIChvdGhlcndpc2UgZGF0YSBjb3VsZCBjaGFuZ2UgZnJvbSBhbm90aGVyIHByb2Nlc3MKICAvLyAgIHdpdGhpbiBhIHRyYW5zYWN0aW9uLCBjYXVzaW5nIGZhdWx0eSBjYWNoZXMgZXRjKSB0aGUgc2ltcGxlc3QKICAvLyAgIHRoaW5nIHRvIGRvIGlzIGdvIGFoZWFkIGFuZCBncmFiIGEgcmVhZC93cml0ZSB0cmFuc2FjdGlvbiB0aGF0CiAgLy8gICByZXByZXNlbnRzIHRoZSBSRVNFUlZFRCBsb2NrLiBUaGlzIHdpbGwgYmxvY2sgYWxsIHJlYWRzIGZyb20KICAvLyAgIGhhcHBlbmluZywgYW5kIGlzIGVzc2VudGlhbGx5IHRoZSBzYW1lIGFzIGFuIEVYQ0xVU0lWRSBsb2NrLgogIC8vCiAgLy8gICAgICogVGhlIG1haW4gcHJvYmxlbSBoZXJlIGlzIHdlIGNhbid0ICJ1cGdyYWRlIiBhIGByZWFkb25seWAKICAvLyAgICAgICB0cmFuc2FjdGlvbiB0byBgcmVhZHdyaXRlYCwgYnV0IG5hdGl2ZSBzcWxpdGUgY2FuIHVwZ3JhZGUgYQogIC8vICAgICAgIGxvY2sgZnJvbSBTSEFSRUQgdG8gUkVTRVJWRUQuIFdlIG5lZWQgdG8gc3RhcnQgYSBuZXcKICAvLyAgICAgICB0cmFuc2FjdGlvbiB0byBkbyBzbywgYW5kIGJlY2F1c2Ugb2YgdGhhdCB0aGVyZSBtaWdodCBiZQogIC8vICAgICAgIG90aGVyIGByZWFkd3JpdGVgIHRyYW5zYWN0aW9ucyB0aGF0IGdldCBydW4gZHVyaW5nIHRoZQogIC8vICAgICAgICJ1cGdyYWRlIiB3aGljaCBpbnZhbGlkYXRlcyB0aGUgd2hvbGUgbG9ja2luZyBwcm9jZXNzIGFuZAogIC8vICAgICAgIGFuZCBjb3JydXB0cyBkYXRhLgogIC8vCiAgLy8gKiBJZGVhbGx5LCB3ZSBjb3VsZCB0ZWxsIHNxbGl0ZSB0byBza2lwIFNIQVJFRCBsb2NrcyBlbnRpcmVseS4gV2UKICAvLyAgIGRvbid0IG5lZWQgdGhlbSBzaW5jZSB3ZSBjYW4gcmVseSBvbiBJbmRleGVkREIncyBzZW1hbnRpY3MuCiAgLy8gICBUaGVuIHdoZW4gaXQgd2FudHMgdG8gc3RhcnQgd3JpdGluZywgd2UgZ2V0IGEgUkVTRVJWRUQgbG9jawogIC8vICAgd2l0aG91dCBoYXZpbmcgdG8gdXBncmFkZSBmcm9tIFNIQVJFRC4gVGhpcyB3b3VsZCBzYXZlIHVzCiAgLy8gICB0aGUgY29zdCBvZiBhIGByZWFkb25seWAgdHJhbnNhY3Rpb24gd2hlbiB3cml0aW5nOyByaWdodCBub3cKICAvLyAgIGl0IG11c3Qgb3BlbiBhIGByZWFkb25seWAgdHJhbnNhY3Rpb24gYW5kIHRoZW4gaW1tZWRpYXRlbHkgb3BlbgogIC8vICAgYSBgcmVhZHdyaXRlYCB0byB1cGdyYWRlIGl0LiBJIHRob3VnaHQgb2YgZGVmZXJyaW5nIG9wZW5pbmcgdGhlCiAgLy8gICBgcmVhZG9ubHlgIHRyYW5zYWN0aW9uIHVudGlsIHNvbWV0aGluZyBpcyBhY3R1YWxseSByZWFkLCBidXQKICAvLyAgIHVuZm9ydHVuYXRlbHkgc3FsaXRlIG9wZW5zIGl0LCByZWFkcyB0aGUgZmlyc3QgYmxvY2ssIGFuZCB0aGVuCiAgLy8gICB1cGdyYWRlcyBpdC4gU28gdGhlcmUncyBubyB3YXkgYXJvdW5kIGl0LiAoV2UgY2FuJ3QgYXNzdW1lIGl0J3MKICAvLyAgIGEgYHJlYWR3cml0ZWAgdHJhbnNhY3Rpb24gYXQgdGhhdCBwb2ludCBzaW5jZSB0aGF0IHdvdWxkIGFzc3VtZQogIC8vICAgYWxsIFNIQVJFRCBsb2NrcyBhcmUgYHJlYWR3cml0ZWAsIHJlbW92aW5nIHRoZSBwb3NzaWJpbGl0eSBvZgogIC8vICAgY29uY3VycmVudCByZWFkcykuCiAgLy8KICAvLyAqIFVwZ3JhZGluZyB0byBhbiBFWENMVVNJVkUgbG9jayBpcyBhIG5vb3AsIHNpbmNlIHdlIHRyZWF0IFJFU0VSVkVECiAgLy8gICBsb2NrcyBhcyBFWENMVVNJVkUuCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlTG9jayh3cml0ZXIsIG5hbWUsIGxvY2tUeXBlKSB7CiAgICAvLyBjb25zb2xlLmxvZygnbG9ja2luZycsIG5hbWUsIGxvY2tUeXBlLCBwZXJmb3JtYW5jZS5ub3coKSk7CgogICAgbGV0IHRyYW5zID0gdHJhbnNhY3Rpb25zLmdldChuYW1lKTsKICAgIGlmICh0cmFucykgewogICAgICBpZiAobG9ja1R5cGUgPiB0cmFucy5sb2NrVHlwZSkgewogICAgICAgIC8vIFVwZ3JhZGUgU0hBUkVEIHRvIEVYQ0xVU0lWRQogICAgICAgIGFzc2VydCgKICAgICAgICAgIHRyYW5zLmxvY2tUeXBlID09PSBMT0NLX1RZUEVTLlNIQVJFRCwKICAgICAgICAgIGBVcHJhZGluZyBsb2NrIHR5cGUgZnJvbSAke3RyYW5zLmxvY2tUeXBlfSBpcyBpbnZhbGlkYAogICAgICAgICk7CiAgICAgICAgYXNzZXJ0KAogICAgICAgICAgbG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuUkVTRVJWRUQgfHwgbG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuRVhDTFVTSVZFLAogICAgICAgICAgYFVwZ3JhZGluZyBsb2NrIHR5cGUgdG8gJHtsb2NrVHlwZX0gaXMgaW52YWxpZGAKICAgICAgICApOwoKICAgICAgICBsZXQgc3VjY2VzcyA9IGF3YWl0IHRyYW5zLnVwZ3JhZGVFeGNsdXNpdmUoKTsKICAgICAgICB3cml0ZXIuaW50MzIoc3VjY2VzcyA/IDAgOiAtMSk7CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgLy8gSWYgbm90IHVwZ3JhZGluZyBhbmQgd2UgYWxyZWFkeSBoYXZlIGEgbG9jaywgbWFrZSBzdXJlIHRoaXMKICAgICAgICAvLyBpc24ndCBhIGRvd25ncmFkZQogICAgICAgIGFzc2VydCgKICAgICAgICAgIHRyYW5zLmxvY2tUeXBlID09PSBsb2NrVHlwZSwKICAgICAgICAgIGBEb3duZ3JhZGluZyBsb2NrIHRvICR7bG9ja1R5cGV9IGlzIGludmFsaWRgCiAgICAgICAgKTsKCiAgICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICB9CiAgICB9IGVsc2UgewogICAgICBhc3NlcnQoCiAgICAgICAgbG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuU0hBUkVELAogICAgICAgIGBOZXcgbG9ja3MgbXVzdCBzdGFydCBhcyBTSEFSRUQgaW5zdGVhZCBvZiAke2xvY2tUeXBlfWAKICAgICAgKTsKCiAgICAgIGxldCB0cmFucyA9IG5ldyBUcmFuc2FjdGlvbihhd2FpdCBsb2FkRGIobmFtZSkpOwogICAgICBpZiAoKGF3YWl0IHRyYW5zLnByZWZldGNoRmlyc3RCbG9jayg1MDApKSA9PSBudWxsKSA7CgogICAgICB0cmFuc2FjdGlvbnMuc2V0KG5hbWUsIHRyYW5zKTsKCiAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVVbmxvY2sod3JpdGVyLCBuYW1lLCBsb2NrVHlwZSkgewogICAgLy8gY29uc29sZS5sb2coJ3VubG9ja2luZycsIG5hbWUsIGxvY2tUeXBlLCBwZXJmb3JtYW5jZS5ub3coKSk7CgogICAgbGV0IHRyYW5zID0gZ2V0VHJhbnNhY3Rpb24obmFtZSk7CgogICAgaWYgKGxvY2tUeXBlID09PSBMT0NLX1RZUEVTLlNIQVJFRCkgewogICAgICBpZiAodHJhbnMgPT0gbnVsbCkgewogICAgICAgIHRocm93IG5ldyBFcnJvcignVW5sb2NrIGVycm9yIChTSEFSRUQpOiBubyB0cmFuc2FjdGlvbiBydW5uaW5nJyk7CiAgICAgIH0KCiAgICAgIGlmICh0cmFucy5sb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5FWENMVVNJVkUpIHsKICAgICAgICB0cmFucy5kb3duZ3JhZGVTaGFyZWQoKTsKICAgICAgfQogICAgfSBlbHNlIGlmIChsb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5OT05FKSB7CiAgICAgIC8vIEkgdGhvdWdodCB3ZSBjb3VsZCBhc3N1bWUgYSBsb2NrIGlzIGFsd2F5cyBvcGVuIHdoZW4gYHVubG9ja2AKICAgICAgLy8gaXMgY2FsbGVkLCBidXQgaXQgYWxzbyBjYWxscyBgdW5sb2NrYCB3aGVuIGNsb3NpbmcgdGhlIGZpbGUgbm8KICAgICAgLy8gbWF0dGVyIHdoYXQuIERvIG5vdGhpbmcgaWYgdGhlcmUncyBubyBsb2NrIGN1cnJlbnRseQogICAgICBpZiAodHJhbnMpIHsKICAgICAgICAvLyBUT0RPOiB0aGlzIGlzIHdoZXJlIGFuIGVycm9yIGNvdWxkIGJ1YmJsZSB1cC4gSGFuZGxlIGl0CiAgICAgICAgYXdhaXQgdHJhbnMud2FpdENvbXBsZXRlKCk7CiAgICAgICAgdHJhbnNhY3Rpb25zLmRlbGV0ZShuYW1lKTsKICAgICAgfQogICAgfQoKICAgIHdyaXRlci5pbnQzMigwKTsKICAgIHdyaXRlci5maW5hbGl6ZSgpOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlUmVhZCh3cml0ZXIsIG5hbWUsIHBvc2l0aW9uKSB7CiAgICByZXR1cm4gd2l0aFRyYW5zYWN0aW9uKG5hbWUsICdyZWFkb25seScsIGFzeW5jIHRyYW5zID0+IHsKICAgICAgbGV0IGRhdGEgPSBhd2FpdCB0cmFucy5yZWFkKHBvc2l0aW9uKTsKCiAgICAgIGlmIChkYXRhID09IG51bGwpIHsKICAgICAgICB3cml0ZXIuYnl0ZXMobmV3IEFycmF5QnVmZmVyKDApKTsKICAgICAgfSBlbHNlIHsKICAgICAgICB3cml0ZXIuYnl0ZXMoZGF0YSk7CiAgICAgIH0KICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9KTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZVdyaXRlcyh3cml0ZXIsIG5hbWUsIHdyaXRlcykgewogICAgcmV0dXJuIHdpdGhUcmFuc2FjdGlvbihuYW1lLCAncmVhZHdyaXRlJywgYXN5bmMgdHJhbnMgPT4gewogICAgICBhd2FpdCB0cmFucy5idWxrU2V0KHdyaXRlcy5tYXAodyA9PiAoeyBrZXk6IHcucG9zLCB2YWx1ZTogdy5kYXRhIH0pKSk7CgogICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVSZWFkTWV0YSh3cml0ZXIsIG5hbWUpIHsKICAgIHJldHVybiB3aXRoVHJhbnNhY3Rpb24obmFtZSwgJ3JlYWRvbmx5JywgYXN5bmMgdHJhbnMgPT4gewogICAgICB0cnkgewogICAgICAgIGNvbnNvbGUubG9nKCdSZWFkaW5nIG1ldGEnKTsKICAgICAgICBsZXQgcmVzID0gYXdhaXQgdHJhbnMuZ2V0KC0xKTsKICAgICAgICBjb25zb2xlLmxvZygnUmVhZGluZyBtZXRhIChkb25lKScsIHJlcyk7CgogICAgICAgIGxldCBtZXRhID0gcmVzOwogICAgICAgIHdyaXRlci5pbnQzMihtZXRhID8gbWV0YS5zaXplIDogLTEpOwogICAgICAgIHdyaXRlci5pbnQzMihtZXRhID8gbWV0YS5ibG9ja1NpemUgOiAtMSk7CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgIGNvbnNvbGUubG9nKGVycik7CiAgICAgICAgd3JpdGVyLmludDMyKC0xKTsKICAgICAgICB3cml0ZXIuaW50MzIoLTEpOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICB9CiAgICB9KTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZVdyaXRlTWV0YSh3cml0ZXIsIG5hbWUsIG1ldGEpIHsKICAgIHJldHVybiB3aXRoVHJhbnNhY3Rpb24obmFtZSwgJ3JlYWR3cml0ZScsIGFzeW5jIHRyYW5zID0+IHsKICAgICAgdHJ5IHsKICAgICAgICBhd2FpdCB0cmFucy5zZXQoeyBrZXk6IC0xLCB2YWx1ZTogbWV0YSB9KTsKCiAgICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICBjb25zb2xlLmxvZyhlcnIpOwogICAgICAgIHdyaXRlci5pbnQzMigtMSk7CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgIH0KICAgIH0pOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlRGVsZXRlRmlsZSh3cml0ZXIsIG5hbWUpIHsKICAgIC8vIFRPRE86IEhhbmRsZSB0aGlzCiAgICB3cml0ZXIuaW50MzIoMCk7CiAgICB3cml0ZXIuZmluYWxpemUoKTsKICB9CgogIC8vIGBsaXN0ZW5gIGNvbnRpbnVhbGx5IGxpc3RlbnMgZm9yIHJlcXVlc3RzIHZpYSB0aGUgc2hhcmVkIGJ1ZmZlci4KICAvLyBSaWdodCBub3cgaXQncyBpbXBsZW1lbnRlZCBpbiBhIHRhaWwtY2FsbCBzdHlsZSAoYGxpc3RlbmAgaXMKICAvLyByZWN1cnNpdmVseSBjYWxsZWQpIGJlY2F1c2UgSSB0aG91Z2h0IHRoYXQgd2FzIG5lY2Vzc2FyeSBmb3IKICAvLyB2YXJpb3VzIHJlYXNvbnMuIFdlIGNhbiBjb252ZXJ0IHRoaXMgdG8gYSBgd2hpbGUoMSlgIGxvb3Agd2l0aAogIC8vIGFuZCB1c2UgYGF3YWl0YCB0aG91Z2gKICBhc3luYyBmdW5jdGlvbiBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpIHsKICAgIGxldCBtZXRob2QgPSByZWFkZXIuc3RyaW5nKCk7CgogICAgc3dpdGNoIChtZXRob2QpIHsKICAgICAgY2FzZSAnc3RhdHMtc3RhcnQnOiB7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ3N0YXRzJzogewogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGVuZCgpOwoKICAgICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAnd3JpdGVCbG9ja3MnOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgbGV0IHdyaXRlcyA9IFtdOwogICAgICAgIHdoaWxlICghcmVhZGVyLmRvbmUoKSkgewogICAgICAgICAgbGV0IHBvcyA9IHJlYWRlci5pbnQzMigpOwogICAgICAgICAgbGV0IGRhdGEgPSByZWFkZXIuYnl0ZXMoKTsKICAgICAgICAgIHdyaXRlcy5wdXNoKHsgcG9zLCBkYXRhIH0pOwogICAgICAgIH0KCiAgICAgICAgYXdhaXQgaGFuZGxlV3JpdGVzKHdyaXRlciwgbmFtZSwgd3JpdGVzKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICdyZWFkQmxvY2snOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgbGV0IHBvcyA9IHJlYWRlci5pbnQzMigpOwogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGhhbmRsZVJlYWQod3JpdGVyLCBuYW1lLCBwb3MpOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ3JlYWRNZXRhJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIHJlYWRlci5kb25lKCk7CiAgICAgICAgYXdhaXQgaGFuZGxlUmVhZE1ldGEod3JpdGVyLCBuYW1lKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICd3cml0ZU1ldGEnOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgbGV0IHNpemUgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICBsZXQgYmxvY2tTaXplID0gcmVhZGVyLmludDMyKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKICAgICAgICBhd2FpdCBoYW5kbGVXcml0ZU1ldGEod3JpdGVyLCBuYW1lLCB7IHNpemUsIGJsb2NrU2l6ZSB9KTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICdkZWxldGVGaWxlJzogewogICAgICAgIHJlYWRlci5zdHJpbmcoKTsKICAgICAgICByZWFkZXIuZG9uZSgpOwoKICAgICAgICBhd2FpdCBoYW5kbGVEZWxldGVGaWxlKHdyaXRlcik7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAnbG9ja0ZpbGUnOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgbGV0IGxvY2tUeXBlID0gcmVhZGVyLmludDMyKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgYXdhaXQgaGFuZGxlTG9jayh3cml0ZXIsIG5hbWUsIGxvY2tUeXBlKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICd1bmxvY2tGaWxlJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIGxldCBsb2NrVHlwZSA9IHJlYWRlci5pbnQzMigpOwogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGhhbmRsZVVubG9jayh3cml0ZXIsIG5hbWUsIGxvY2tUeXBlKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBkZWZhdWx0OgogICAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBtZXRob2Q6ICcgKyBtZXRob2QpOwogICAgfQogIH0KCiAgc2VsZi5vbm1lc3NhZ2UgPSBtc2cgPT4gewogICAgc3dpdGNoIChtc2cuZGF0YS50eXBlKSB7CiAgICAgIGNhc2UgJ2luaXQnOiB7CiAgICAgICAgcG9zdE1lc3NhZ2UoeyB0eXBlOiAnd29ya2VyLXJlYWR5JyB9KTsKICAgICAgICBsZXQgW2FyZ0J1ZmZlciwgcmVzdWx0QnVmZmVyXSA9IG1zZy5kYXRhLmJ1ZmZlcnM7CiAgICAgICAgbGV0IHJlYWRlciA9IG5ldyBSZWFkZXIoYXJnQnVmZmVyLCB7IG5hbWU6ICdhcmdzJywgZGVidWc6IGZhbHNlIH0pOwogICAgICAgIGxldCB3cml0ZXIgPSBuZXcgV3JpdGVyKHJlc3VsdEJ1ZmZlciwgeyBuYW1lOiAncmVzdWx0cycsIGRlYnVnOiBmYWxzZSB9KTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CiAgICB9CiAgfTsKCn0oKSk7Cgo=', null, false);
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
