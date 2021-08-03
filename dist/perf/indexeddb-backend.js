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

let token = '';
let sheetId = '1p1isUZkWe8oc12LL0kqaT3UFT_MR8vEoEieEruHW-xE';

let buffer = 40000;
let baseTime;
let timings = {};

let range$1 = 'A3';

const descriptions = {
  get: 'Calls to `store.get`',
  'stream-next': 'Advancing a cursor',
  stream: 'Opening a cursor',
  read: 'Full process for reading a block'
};

function last(arr) {
  return arr.length === 0 ? null : arr[arr.length - 1];
}

function percentile(data, p) {
  let sorted = [...data];
  sorted.sort((n1, n2) => n1[1] - n2[1]);
  return sorted.slice(0, Math.ceil(sorted.length * p) | 0);
}

let showWarning = true;

async function writeData(sheetName, data) {
  let arr = percentile(data, 0.95);

  if (arr.length > buffer) {
    arr = arr.slice(-buffer);
  } else {
    while (arr.length < buffer) {
      arr.push(['', '']);
    }
  }

  let res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!${range$1}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ values: arr })
    }
  );
  if (res.status == 200) {
    console.log(`Logged timings to spreadsheet (${sheetName}))`);
  } else {
    if (showWarning) {
      showWarning = false;
      console.warn(
        'Unable to log perf data to spreadsheet. Is the OAuth token expired?'
      );
    }

    console.log(`--- ${sheetName} (${descriptions[sheetName]}) ---`);
    console.log(`Count: ${data.length}`);
    console.log(`p50: ${last(percentile(data, 0.5))[1]}`);
    console.log(`p95: ${last(percentile(data, 0.95))[1]}`);
  }
}

async function end() {
  await Promise.all(
    Object.keys(timings).map(name => {
      let timing = timings[name];
      return writeData(name, timing.data.map(x => [x.start + x.took, x.took]));
    })
  );
}

function start() {
  timings = {};
  baseTime = performance.now();
}

function record(name) {
  if (timings[name] == null) {
    timings[name] = { start: null, data: [] };
  }
  let timer = timings[name];

  if (timer.start != null) {
    throw new Error(`timer already started ${name}`);
  }
  timer.start = performance.now();
}

function endRecording(name) {
  let now = performance.now();
  let timer = timings[name];

  if (timer && timer.start != null) {
    let took = now - timer.start;
    let start = timer.start - baseTime;
    timer.start = null;

    if (timer.data.length < buffer) {
      timer.data.push({ start, took });
    }
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

    record('read');

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

    endRecording('read');

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
    start();
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

var WorkerFactory = createBase64WorkerFactory('Lyogcm9sbHVwLXBsdWdpbi13ZWItd29ya2VyLWxvYWRlciAqLwooZnVuY3Rpb24gKCkgewogICd1c2Ugc3RyaWN0JzsKCiAgbGV0IEZJTkFMSVpFRCA9IDB4ZGVhZGJlZWY7CgogIGxldCBXUklURUFCTEUgPSAwOwogIGxldCBSRUFEQUJMRSA9IDE7CgogIGNsYXNzIFJlYWRlciB7CiAgICBjb25zdHJ1Y3RvcigKICAgICAgYnVmZmVyLAogICAgICB7IGluaXRpYWxPZmZzZXQgPSA0LCB1c2VBdG9taWNzID0gdHJ1ZSwgc3RyZWFtID0gdHJ1ZSwgZGVidWcsIG5hbWUgfSA9IHt9CiAgICApIHsKICAgICAgdGhpcy5idWZmZXIgPSBidWZmZXI7CiAgICAgIHRoaXMuYXRvbWljVmlldyA9IG5ldyBJbnQzMkFycmF5KGJ1ZmZlcik7CiAgICAgIHRoaXMub2Zmc2V0ID0gaW5pdGlhbE9mZnNldDsKICAgICAgdGhpcy51c2VBdG9taWNzID0gdXNlQXRvbWljczsKICAgICAgdGhpcy5zdHJlYW0gPSBzdHJlYW07CiAgICAgIHRoaXMuZGVidWcgPSBkZWJ1ZzsKICAgICAgdGhpcy5uYW1lID0gbmFtZTsKICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbcmVhZGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0V3JpdGUobmFtZSkgewogICAgICBpZiAodGhpcy51c2VBdG9taWNzKSB7CiAgICAgICAgdGhpcy5sb2coYHdhaXRpbmcgZm9yICR7bmFtZX1gKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBXUklURUFCTEUpIHsKICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCd3YWl0aW5nIGZvciB3cml0ZS4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFLCA1MDApOwogICAgICAgIH0KCiAgICAgICAgdGhpcy5sb2coYHJlc3VtZWQgZm9yICR7bmFtZX1gKTsKICAgICAgfSBlbHNlIHsKICAgICAgICBpZiAodGhpcy5hdG9taWNWaWV3WzBdICE9PSBSRUFEQUJMRSkgewogICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdgd2FpdFdyaXRlYCBleHBlY3RlZCBhcnJheSB0byBiZSByZWFkYWJsZScpOwogICAgICAgIH0KICAgICAgfQogICAgfQoKICAgIGZsaXAoKSB7CiAgICAgIHRoaXMubG9nKCdmbGlwJyk7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICBsZXQgcHJldiA9IEF0b21pY3MuY29tcGFyZUV4Y2hhbmdlKAogICAgICAgICAgdGhpcy5hdG9taWNWaWV3LAogICAgICAgICAgMCwKICAgICAgICAgIFJFQURBQkxFLAogICAgICAgICAgV1JJVEVBQkxFCiAgICAgICAgKTsKCiAgICAgICAgaWYgKHByZXYgIT09IFJFQURBQkxFKSB7CiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlYWQgZGF0YSBvdXQgb2Ygc3luYyEgVGhpcyBpcyBkaXNhc3Ryb3VzJyk7CiAgICAgICAgfQoKICAgICAgICBBdG9taWNzLm5vdGlmeSh0aGlzLmF0b21pY1ZpZXcsIDApOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IFdSSVRFQUJMRTsKICAgICAgfQoKICAgICAgdGhpcy5vZmZzZXQgPSA0OwogICAgfQoKICAgIGRvbmUoKSB7CiAgICAgIHRoaXMud2FpdFdyaXRlKCdkb25lJyk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgbGV0IGRvbmUgPSBkYXRhVmlldy5nZXRVaW50MzIoMCkgPT09IEZJTkFMSVpFRDsKCiAgICAgIGlmIChkb25lKSB7CiAgICAgICAgdGhpcy5sb2coJ2RvbmUnKTsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQoKICAgICAgcmV0dXJuIGRvbmU7CiAgICB9CgogICAgcGVlayhmbikgewogICAgICB0aGlzLnBlZWtPZmZzZXQgPSB0aGlzLm9mZnNldDsKICAgICAgbGV0IHJlcyA9IGZuKCk7CiAgICAgIHRoaXMub2Zmc2V0ID0gdGhpcy5wZWVrT2Zmc2V0OwogICAgICB0aGlzLnBlZWtPZmZzZXQgPSBudWxsOwogICAgICByZXR1cm4gcmVzOwogICAgfQoKICAgIHN0cmluZygpIHsKICAgICAgdGhpcy53YWl0V3JpdGUoJ3N0cmluZycpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSB0aGlzLl9pbnQzMigpOwogICAgICBsZXQgbGVuZ3RoID0gYnl0ZUxlbmd0aCAvIDI7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0LCBieXRlTGVuZ3RoKTsKICAgICAgbGV0IGNoYXJzID0gW107CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHsKICAgICAgICBjaGFycy5wdXNoKGRhdGFWaWV3LmdldFVpbnQxNihpICogMikpOwogICAgICB9CiAgICAgIGxldCBzdHIgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIGNoYXJzKTsKICAgICAgdGhpcy5sb2coJ3N0cmluZycsIHN0cik7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwoKICAgICAgaWYgKHRoaXMucGVla09mZnNldCA9PSBudWxsKSB7CiAgICAgICAgdGhpcy5mbGlwKCk7CiAgICAgIH0KICAgICAgcmV0dXJuIHN0cjsKICAgIH0KCiAgICBfaW50MzIoKSB7CiAgICAgIGxldCBieXRlTGVuZ3RoID0gNDsKCiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBsZXQgbnVtID0gZGF0YVZpZXcuZ2V0SW50MzIoKTsKICAgICAgdGhpcy5sb2coJ19pbnQzMicsIG51bSk7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGludDMyKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgnaW50MzInKTsKICAgICAgbGV0IG51bSA9IHRoaXMuX2ludDMyKCk7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CgogICAgICBpZiAodGhpcy5wZWVrT2Zmc2V0ID09IG51bGwpIHsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGJ5dGVzKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgnYnl0ZXMnKTsKCiAgICAgIGxldCBieXRlTGVuZ3RoID0gdGhpcy5faW50MzIoKTsKCiAgICAgIGxldCBieXRlcyA9IG5ldyBBcnJheUJ1ZmZlcihieXRlTGVuZ3RoKTsKICAgICAgbmV3IFVpbnQ4QXJyYXkoYnl0ZXMpLnNldCgKICAgICAgICBuZXcgVWludDhBcnJheSh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQsIGJ5dGVMZW5ndGgpCiAgICAgICk7CiAgICAgIHRoaXMubG9nKCdieXRlcycsIGJ5dGVzKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CgogICAgICBpZiAodGhpcy5wZWVrT2Zmc2V0ID09IG51bGwpIHsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQogICAgICByZXR1cm4gYnl0ZXM7CiAgICB9CiAgfQoKICBjbGFzcyBXcml0ZXIgewogICAgY29uc3RydWN0b3IoCiAgICAgIGJ1ZmZlciwKICAgICAgeyBpbml0aWFsT2Zmc2V0ID0gNCwgdXNlQXRvbWljcyA9IHRydWUsIHN0cmVhbSA9IHRydWUsIGRlYnVnLCBuYW1lIH0gPSB7fQogICAgKSB7CiAgICAgIHRoaXMuYnVmZmVyID0gYnVmZmVyOwogICAgICB0aGlzLmF0b21pY1ZpZXcgPSBuZXcgSW50MzJBcnJheShidWZmZXIpOwogICAgICB0aGlzLm9mZnNldCA9IGluaXRpYWxPZmZzZXQ7CiAgICAgIHRoaXMudXNlQXRvbWljcyA9IHVzZUF0b21pY3M7CiAgICAgIHRoaXMuc3RyZWFtID0gc3RyZWFtOwoKICAgICAgdGhpcy5kZWJ1ZyA9IGRlYnVnOwogICAgICB0aGlzLm5hbWUgPSBuYW1lOwoKICAgICAgaWYgKHRoaXMudXNlQXRvbWljcykgewogICAgICAgIC8vIFRoZSBidWZmZXIgc3RhcnRzIG91dCBhcyB3cml0ZWFibGUKICAgICAgICBBdG9taWNzLnN0b3JlKHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFKTsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aGlzLmF0b21pY1ZpZXdbMF0gPSBXUklURUFCTEU7CiAgICAgIH0KICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbd3JpdGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0UmVhZChuYW1lKSB7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICB0aGlzLmxvZyhgd2FpdGluZyBmb3IgJHtuYW1lfWApOwogICAgICAgIC8vIFN3aXRjaCB0byB3cml0YWJsZQogICAgICAgIC8vIEF0b21pY3Muc3RvcmUodGhpcy5hdG9taWNWaWV3LCAwLCAxKTsKCiAgICAgICAgbGV0IHByZXYgPSBBdG9taWNzLmNvbXBhcmVFeGNoYW5nZSgKICAgICAgICAgIHRoaXMuYXRvbWljVmlldywKICAgICAgICAgIDAsCiAgICAgICAgICBXUklURUFCTEUsCiAgICAgICAgICBSRUFEQUJMRQogICAgICAgICk7CgogICAgICAgIGlmIChwcmV2ICE9PSBXUklURUFCTEUpIHsKICAgICAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAgICAgJ1dyb3RlIHNvbWV0aGluZyBpbnRvIHVud3JpdGFibGUgYnVmZmVyISBUaGlzIGlzIGRpc2FzdHJvdXMnCiAgICAgICAgICApOwogICAgICAgIH0KCiAgICAgICAgQXRvbWljcy5ub3RpZnkodGhpcy5hdG9taWNWaWV3LCAwKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBSRUFEQUJMRSkgewogICAgICAgICAgLy8gY29uc29sZS5sb2coJ3dhaXRpbmcgdG8gYmUgcmVhZC4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgUkVBREFCTEUsIDUwMCk7CiAgICAgICAgfQoKICAgICAgICB0aGlzLmxvZyhgcmVzdW1lZCBmb3IgJHtuYW1lfWApOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IFJFQURBQkxFOwogICAgICB9CgogICAgICB0aGlzLm9mZnNldCA9IDQ7CiAgICB9CgogICAgZmluYWxpemUoKSB7CiAgICAgIHRoaXMubG9nKCdmaW5hbGl6aW5nJyk7CiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBkYXRhVmlldy5zZXRVaW50MzIoMCwgRklOQUxJWkVEKTsKICAgICAgdGhpcy53YWl0UmVhZCgnZmluYWxpemUnKTsKICAgIH0KCiAgICBzdHJpbmcoc3RyKSB7CiAgICAgIHRoaXMubG9nKCdzdHJpbmcnLCBzdHIpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSBzdHIubGVuZ3RoICogMjsKICAgICAgdGhpcy5faW50MzIoYnl0ZUxlbmd0aCk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0LCBieXRlTGVuZ3RoKTsKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHsKICAgICAgICBkYXRhVmlldy5zZXRVaW50MTYoaSAqIDIsIHN0ci5jaGFyQ29kZUF0KGkpKTsKICAgICAgfQoKICAgICAgdGhpcy5vZmZzZXQgKz0gYnl0ZUxlbmd0aDsKICAgICAgdGhpcy53YWl0UmVhZCgnc3RyaW5nJyk7CiAgICB9CgogICAgX2ludDMyKG51bSkgewogICAgICBsZXQgYnl0ZUxlbmd0aCA9IDQ7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgZGF0YVZpZXcuc2V0SW50MzIoMCwgbnVtKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CiAgICB9CgogICAgaW50MzIobnVtKSB7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CiAgICAgIHRoaXMuX2ludDMyKG51bSk7CiAgICAgIHRoaXMud2FpdFJlYWQoJ2ludDMyJyk7CiAgICB9CgogICAgYnl0ZXMoYnVmZmVyKSB7CiAgICAgIHRoaXMubG9nKCdieXRlcycsIGJ1ZmZlcik7CgogICAgICBsZXQgYnl0ZUxlbmd0aCA9IGJ1ZmZlci5ieXRlTGVuZ3RoOwogICAgICB0aGlzLl9pbnQzMihieXRlTGVuZ3RoKTsKICAgICAgbmV3IFVpbnQ4QXJyYXkodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KS5zZXQobmV3IFVpbnQ4QXJyYXkoYnVmZmVyKSk7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICB0aGlzLndhaXRSZWFkKCdieXRlcycpOwogICAgfQogIH0KCiAgbGV0IHRva2VuID0gJyc7CiAgbGV0IHNoZWV0SWQgPSAnMXAxaXNVWmtXZThvYzEyTEwwa3FhVDNVRlRfTVI4dkVvRWllRXJ1SFcteEUnOwoKICBsZXQgYnVmZmVyID0gNDAwMDA7CiAgbGV0IGJhc2VUaW1lOwogIGxldCB0aW1pbmdzID0ge307CgogIGxldCByYW5nZSA9ICdBMyc7CgogIGNvbnN0IGRlc2NyaXB0aW9ucyA9IHsKICAgIGdldDogJ0NhbGxzIHRvIGBzdG9yZS5nZXRgJywKICAgICdzdHJlYW0tbmV4dCc6ICdBZHZhbmNpbmcgYSBjdXJzb3InLAogICAgc3RyZWFtOiAnT3BlbmluZyBhIGN1cnNvcicsCiAgICByZWFkOiAnRnVsbCBwcm9jZXNzIGZvciByZWFkaW5nIGEgYmxvY2snCiAgfTsKCiAgZnVuY3Rpb24gbGFzdChhcnIpIHsKICAgIHJldHVybiBhcnIubGVuZ3RoID09PSAwID8gbnVsbCA6IGFyclthcnIubGVuZ3RoIC0gMV07CiAgfQoKICBmdW5jdGlvbiBwZXJjZW50aWxlKGRhdGEsIHApIHsKICAgIGxldCBzb3J0ZWQgPSBbLi4uZGF0YV07CiAgICBzb3J0ZWQuc29ydCgobjEsIG4yKSA9PiBuMVsxXSAtIG4yWzFdKTsKICAgIHJldHVybiBzb3J0ZWQuc2xpY2UoMCwgTWF0aC5jZWlsKHNvcnRlZC5sZW5ndGggKiBwKSB8IDApOwogIH0KCiAgbGV0IHNob3dXYXJuaW5nID0gdHJ1ZTsKCiAgYXN5bmMgZnVuY3Rpb24gd3JpdGVEYXRhKHNoZWV0TmFtZSwgZGF0YSkgewogICAgbGV0IGFyciA9IHBlcmNlbnRpbGUoZGF0YSwgMC45NSk7CgogICAgaWYgKGFyci5sZW5ndGggPiBidWZmZXIpIHsKICAgICAgYXJyID0gYXJyLnNsaWNlKC1idWZmZXIpOwogICAgfSBlbHNlIHsKICAgICAgd2hpbGUgKGFyci5sZW5ndGggPCBidWZmZXIpIHsKICAgICAgICBhcnIucHVzaChbJycsICcnXSk7CiAgICAgIH0KICAgIH0KCiAgICBsZXQgcmVzID0gYXdhaXQgZmV0Y2goCiAgICAgIGBodHRwczovL3NoZWV0cy5nb29nbGVhcGlzLmNvbS92NC9zcHJlYWRzaGVldHMvJHtzaGVldElkfS92YWx1ZXMvJHtzaGVldE5hbWV9ISR7cmFuZ2V9P3ZhbHVlSW5wdXRPcHRpb249VVNFUl9FTlRFUkVEYCwKICAgICAgewogICAgICAgIG1ldGhvZDogJ1BVVCcsCiAgICAgICAgaGVhZGVyczogewogICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJywKICAgICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0b2tlbn1gCiAgICAgICAgfSwKICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHZhbHVlczogYXJyIH0pCiAgICAgIH0KICAgICk7CiAgICBpZiAocmVzLnN0YXR1cyA9PSAyMDApIHsKICAgICAgY29uc29sZS5sb2coYExvZ2dlZCB0aW1pbmdzIHRvIHNwcmVhZHNoZWV0ICgke3NoZWV0TmFtZX0pKWApOwogICAgfSBlbHNlIHsKICAgICAgaWYgKHNob3dXYXJuaW5nKSB7CiAgICAgICAgc2hvd1dhcm5pbmcgPSBmYWxzZTsKICAgICAgICBjb25zb2xlLndhcm4oCiAgICAgICAgICAnVW5hYmxlIHRvIGxvZyBwZXJmIGRhdGEgdG8gc3ByZWFkc2hlZXQuIElzIHRoZSBPQXV0aCB0b2tlbiBleHBpcmVkPycKICAgICAgICApOwogICAgICB9CgogICAgICBjb25zb2xlLmxvZyhgLS0tICR7c2hlZXROYW1lfSAoJHtkZXNjcmlwdGlvbnNbc2hlZXROYW1lXX0pIC0tLWApOwogICAgICBjb25zb2xlLmxvZyhgQ291bnQ6ICR7ZGF0YS5sZW5ndGh9YCk7CiAgICAgIGNvbnNvbGUubG9nKGBwNTA6ICR7bGFzdChwZXJjZW50aWxlKGRhdGEsIDAuNSkpWzFdfWApOwogICAgICBjb25zb2xlLmxvZyhgcDk1OiAke2xhc3QocGVyY2VudGlsZShkYXRhLCAwLjk1KSlbMV19YCk7CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBlbmQoKSB7CiAgICBhd2FpdCBQcm9taXNlLmFsbCgKICAgICAgT2JqZWN0LmtleXModGltaW5ncykubWFwKG5hbWUgPT4gewogICAgICAgIGxldCB0aW1pbmcgPSB0aW1pbmdzW25hbWVdOwogICAgICAgIHJldHVybiB3cml0ZURhdGEobmFtZSwgdGltaW5nLmRhdGEubWFwKHggPT4gW3guc3RhcnQgKyB4LnRvb2ssIHgudG9va10pKTsKICAgICAgfSkKICAgICk7CiAgfQoKICBmdW5jdGlvbiBzdGFydCgpIHsKICAgIHRpbWluZ3MgPSB7fTsKICAgIGJhc2VUaW1lID0gcGVyZm9ybWFuY2Uubm93KCk7CiAgfQoKICBmdW5jdGlvbiByZWNvcmQobmFtZSkgewogICAgaWYgKHRpbWluZ3NbbmFtZV0gPT0gbnVsbCkgewogICAgICB0aW1pbmdzW25hbWVdID0geyBzdGFydDogbnVsbCwgZGF0YTogW10gfTsKICAgIH0KICAgIGxldCB0aW1lciA9IHRpbWluZ3NbbmFtZV07CgogICAgaWYgKHRpbWVyLnN0YXJ0ICE9IG51bGwpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKGB0aW1lciBhbHJlYWR5IHN0YXJ0ZWQgJHtuYW1lfWApOwogICAgfQogICAgdGltZXIuc3RhcnQgPSBwZXJmb3JtYW5jZS5ub3coKTsKICB9CgogIGZ1bmN0aW9uIGVuZFJlY29yZGluZyhuYW1lKSB7CiAgICBsZXQgbm93ID0gcGVyZm9ybWFuY2Uubm93KCk7CiAgICBsZXQgdGltZXIgPSB0aW1pbmdzW25hbWVdOwoKICAgIGlmICh0aW1lciAmJiB0aW1lci5zdGFydCAhPSBudWxsKSB7CiAgICAgIGxldCB0b29rID0gbm93IC0gdGltZXIuc3RhcnQ7CiAgICAgIGxldCBzdGFydCA9IHRpbWVyLnN0YXJ0IC0gYmFzZVRpbWU7CiAgICAgIHRpbWVyLnN0YXJ0ID0gbnVsbDsKCiAgICAgIGlmICh0aW1lci5kYXRhLmxlbmd0aCA8IGJ1ZmZlcikgewogICAgICAgIHRpbWVyLmRhdGEucHVzaCh7IHN0YXJ0LCB0b29rIH0pOwogICAgICB9CiAgICB9CiAgfQoKICBsZXQgaXNQcm9iYWJseVNhZmFyaSA9IC9eKCg/IWNocm9tZXxhbmRyb2lkKS4pKnNhZmFyaS9pLnRlc3QoCiAgICBuYXZpZ2F0b3IudXNlckFnZW50CiAgKTsKCiAgbGV0IG9wZW5EYnMgPSBuZXcgTWFwKCk7CiAgbGV0IHRyYW5zYWN0aW9ucyA9IG5ldyBNYXAoKTsKCiAgZnVuY3Rpb24gYXNzZXJ0KGNvbmQsIG1zZykgewogICAgaWYgKCFjb25kKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpOwogICAgfQogIH0KCiAgbGV0IExPQ0tfVFlQRVMgPSB7CiAgICBOT05FOiAwLAogICAgU0hBUkVEOiAxLAogICAgUkVTRVJWRUQ6IDIsCiAgICBQRU5ESU5HOiAzLAogICAgRVhDTFVTSVZFOiA0CiAgfTsKCiAgLy8gV2UgdXNlIGxvbmctbGl2ZWQgdHJhbnNhY3Rpb25zLCBhbmQgYFRyYW5zYWN0aW9uYCBrZWVwcyB0aGUKICAvLyB0cmFuc2FjdGlvbiBzdGF0ZS4gSXQgaW1wbGVtZW50cyBhbiBvcHRpbWFsIHdheSB0byBwZXJmb3JtCiAgLy8gcmVhZC93cml0ZXMgd2l0aCBrbm93bGVkZ2Ugb2YgaG93IHNxbGl0ZSBhc2tzIGZvciB0aGVtLCBhbmQgYWxzbwogIC8vIGltcGxlbWVudHMgYSBsb2NraW5nIG1lY2hhbmlzbSB0aGF0IG1hcHMgdG8gaG93IHNxbGl0ZSBsb2NrcyB3b3JrLgogIGNsYXNzIFRyYW5zYWN0aW9uIHsKICAgIGNvbnN0cnVjdG9yKGRiLCBpbml0aWFsTW9kZSA9ICdyZWFkb25seScpIHsKICAgICAgdGhpcy5kYiA9IGRiOwogICAgICB0aGlzLnRyYW5zID0gdGhpcy5kYi50cmFuc2FjdGlvbihbJ2RhdGEnXSwgaW5pdGlhbE1vZGUpOwogICAgICB0aGlzLnN0b3JlID0gdGhpcy50cmFucy5vYmplY3RTdG9yZSgnZGF0YScpOwogICAgICB0aGlzLmxvY2tUeXBlID0KICAgICAgICBpbml0aWFsTW9kZSA9PT0gJ3JlYWRvbmx5JyA/IExPQ0tfVFlQRVMuU0hBUkVEIDogTE9DS19UWVBFUy5FWENMVVNJVkU7CgogICAgICAvLyBUaGVyZSBpcyBubyBuZWVkIGZvciB1cyB0byBjYWNoZSBibG9ja3MuIFVzZSBzcWxpdGUncwogICAgICAvLyBgY2FjaGVfc2l6ZWAgZm9yIHRoYXQgYW5kIGl0IHdpbGwgYXV0b21hdGljYWxseSBkbyBpdC4gSG93ZXZlciwKICAgICAgLy8gd2UgZG8gc3RpbGwga2VlcCBhIGNhY2hlIG9mIHRoZSBmaXJzdCBibG9jayBmb3IgdGhlIGR1cmF0aW9uIG9mCiAgICAgIC8vIHRoaXMgdHJhbnNhY3Rpb24gYmVjYXVzZSBvZiBob3cgbG9ja2luZyB3b3JrczsgdGhpcyBhdm9pZHMgYQogICAgICAvLyBmZXcgZXh0cmEgcmVhZHMgYW5kIGFsbG93cyB1cyB0byBkZXRlY3QgY2hhbmdlcyBkdXJpbmcKICAgICAgLy8gdXBncmFkaW5nIChzZWUgYHVwZ3JhZGVFeGNsdXNpdmVgKQogICAgICB0aGlzLmNhY2hlZEZpcnN0QmxvY2sgPSBudWxsOwoKICAgICAgdGhpcy5jdXJzb3IgPSBudWxsOwogICAgICB0aGlzLnByZXZSZWFkcyA9IG51bGw7CiAgICB9CgogICAgYXN5bmMgcHJlZmV0Y2hGaXJzdEJsb2NrKHRpbWVvdXQpIHsKICAgICAgLy8gVE9ETzogaW1wbGVtZW50IHRpbWVvdXQKCiAgICAgIC8vIEdldCB0aGUgZmlyc3QgYmxvY2sgYW5kIGNhY2hlIGl0CiAgICAgIGxldCBibG9jayA9IGF3YWl0IHRoaXMuZ2V0KDApOwogICAgICB0aGlzLmNhY2hlZEZpcnN0QmxvY2sgPSBibG9jazsKICAgICAgcmV0dXJuIGJsb2NrOwogICAgfQoKICAgIGFzeW5jIHdhaXRDb21wbGV0ZSgpIHsKICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgICAvLyBFYWdlcmx5IGNvbW1pdCBpdCBmb3IgYmV0dGVyIHBlcmYuIE5vdGUgdGhhdCAqKnRoaXMgYXNzdW1lcwogICAgICAgIC8vIHRoZSB0cmFuc2FjdGlvbiBpcyBvcGVuKiogYXMgYGNvbW1pdGAgd2lsbCB0aHJvdyBhbiBlcnJvciBpZgogICAgICAgIC8vIGl0J3MgYWxyZWFkeSBjbG9zZWQgKHdoaWNoIHNob3VsZCBuZXZlciBiZSB0aGUgY2FzZSBmb3IgdXMpCiAgICAgICAgdGhpcy5jb21taXQoKTsKCiAgICAgICAgaWYgKHRoaXMubG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuRVhDTFVTSVZFKSB7CiAgICAgICAgICAvLyBXYWl0IHVudGlsIGFsbCB3cml0ZXMgYXJlIGNvbW1pdHRlZAogICAgICAgICAgdGhpcy50cmFucy5vbmNvbXBsZXRlID0gZSA9PiByZXNvbHZlKCk7CgogICAgICAgICAgLy8gVE9ETzogSXMgaXQgT0sgdG8gYWRkIHRoaXMgbGF0ZXIsIGFmdGVyIGFuIGVycm9yIG1pZ2h0IGhhdmUKICAgICAgICAgIC8vIGhhcHBlbmVkPyBXaWxsIGl0IGhvbGQgdGhlIGVycm9yIGFuZCBmaXJlIHRoaXMgd2hlbiB3ZQogICAgICAgICAgLy8gYXR0YWNoZWQgaXQ/IFdlIG1pZ2h0IHdhbnQgdG8gZWFnZXJseSBjcmVhdGUgdGhlIHByb21pc2UKICAgICAgICAgIC8vIHdoZW4gY3JlYXRpbmcgdGhlIHRyYW5zYWN0aW9uIGFuZCByZXR1cm4gaXQgaGVyZQogICAgICAgICAgdGhpcy50cmFucy5vbmVycm9yID0gZSA9PiByZWplY3QoZSk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIGlmIChpc1Byb2JhYmx5U2FmYXJpKSB7CiAgICAgICAgICAgIC8vIFNhZmFyaSBoYXMgYSBidWcgd2hlcmUgc29tZXRpbWVzIHRoZSBJREIgZ2V0cyBibG9ja2VkCiAgICAgICAgICAgIC8vIHBlcm1hbmVudGx5IGlmIHlvdSByZWZyZXNoIHRoZSBwYWdlIHdpdGggYW4gb3BlbgogICAgICAgICAgICAvLyB0cmFuc2FjdGlvbi4gWW91IGhhdmUgdG8gcmVzdGFydCB0aGUgYnJvd3NlciB0byBmaXggaXQuCiAgICAgICAgICAgIC8vIFdlIHdhaXQgZm9yIHJlYWRvbmx5IHRyYW5zYWN0aW9ucyB0byBmaW5pc2ggdG9vLCBidXQgdGhpcwogICAgICAgICAgICAvLyBpcyBhIHBlcmYgaGl0CiAgICAgICAgICAgIHRoaXMudHJhbnMub25jb21wbGV0ZSA9IGUgPT4gcmVzb2x2ZSgpOwogICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgLy8gTm8gbmVlZCB0byB3YWl0IG9uIGFueXRoaW5nIGluIGEgcmVhZC1vbmx5IHRyYW5zYWN0aW9uLgogICAgICAgICAgICAvLyBOb3RlIHRoYXQgZXJyb3JzIGR1cmluZyByZWFkcyBhcmVhIGFsd2F5cyBoYW5kbGVkIGJ5IHRoZQogICAgICAgICAgICAvLyByZWFkIHJlcXVlc3QuCiAgICAgICAgICAgIHJlc29sdmUoKTsKICAgICAgICAgIH0KICAgICAgICB9CiAgICAgIH0pOwogICAgfQoKICAgIGNvbW1pdCgpIHsKICAgICAgLy8gU2FmYXJpIGRvZXNuJ3Qgc3VwcG9ydCB0aGlzIG1ldGhvZCB5ZXQgKHRoaXMgaXMganVzdCBhbgogICAgICAvLyBvcHRpbWl6YXRpb24pCiAgICAgIGlmICh0aGlzLnRyYW5zLmNvbW1pdCkgewogICAgICAgIHRoaXMudHJhbnMuY29tbWl0KCk7CiAgICAgIH0KICAgIH0KCiAgICBhc3luYyB1cGdyYWRlRXhjbHVzaXZlKCkgewogICAgICB0aGlzLmNvbW1pdCgpOwoKICAgICAgLy8gY29uc29sZS5sb2coJ3VwZGF0aW5nIHRyYW5zYWN0aW9uIHJlYWR3cml0ZScpOwogICAgICB0aGlzLnRyYW5zID0gdGhpcy5kYi50cmFuc2FjdGlvbihbJ2RhdGEnXSwgJ3JlYWR3cml0ZScpOwogICAgICB0aGlzLnN0b3JlID0gdGhpcy50cmFucy5vYmplY3RTdG9yZSgnZGF0YScpOwogICAgICB0aGlzLmxvY2tUeXBlID0gTE9DS19UWVBFUy5FWENMVVNJVkU7CgogICAgICBsZXQgY2FjaGVkMCA9IHRoaXMuY2FjaGVkRmlyc3RCbG9jazsKCiAgICAgIC8vIERvIGEgcmVhZAogICAgICBsZXQgYmxvY2sgPSBhd2FpdCB0aGlzLnByZWZldGNoRmlyc3RCbG9jayg1MDApOwogICAgICAvLyBUT0RPOiB3aGVuIHRpbWVvdXRzIGFyZSBpbXBsZW1lbnRlZCwgZGV0ZWN0IHRpbWVvdXQgYW5kIHJldHVybiBCVVNZCgogICAgICBpZiAoY2FjaGVkMCA9PSBudWxsICYmIGJsb2NrID09IG51bGwpIHsKICAgICAgICByZXR1cm4gdHJ1ZTsKICAgICAgfSBlbHNlIHsKICAgICAgICBmb3IgKGxldCBpID0gMjQ7IGkgPCA0MDsgaSsrKSB7CiAgICAgICAgICBpZiAoYmxvY2tbaV0gIT09IGNhY2hlZDBbaV0pIHsKICAgICAgICAgICAgcmV0dXJuIGZhbHNlOwogICAgICAgICAgfQogICAgICAgIH0KICAgICAgfQoKICAgICAgcmV0dXJuIHRydWU7CiAgICB9CgogICAgZG93bmdyYWRlU2hhcmVkKCkgewogICAgICB0aGlzLmNvbW1pdCgpOwoKICAgICAgLy8gY29uc29sZS5sb2coJ2Rvd25ncmFkaW5nIHRyYW5zYWN0aW9uIHJlYWRvbmx5Jyk7CiAgICAgIHRoaXMudHJhbnMgPSB0aGlzLmRiLnRyYW5zYWN0aW9uKFsnZGF0YSddLCAncmVhZG9ubHknKTsKICAgICAgdGhpcy5zdG9yZSA9IHRoaXMudHJhbnMub2JqZWN0U3RvcmUoJ2RhdGEnKTsKICAgICAgdGhpcy5sb2NrVHlwZSA9IExPQ0tfVFlQRVMuU0hBUkVEOwogICAgfQoKICAgIGFzeW5jIGdldChrZXkpIHsKICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgICByZWNvcmQoJ2dldCcpOwogICAgICAgIGxldCByZXEgPSB0aGlzLnN0b3JlLmdldChrZXkpOwogICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBlID0+IHsKICAgICAgICAgIGVuZFJlY29yZGluZygnZ2V0Jyk7CiAgICAgICAgICByZXNvbHZlKHJlcS5yZXN1bHQpOwogICAgICAgIH07CiAgICAgICAgcmVxLm9uZXJyb3IgPSBlID0+IHJlamVjdChlKTsKICAgICAgfSk7CiAgICB9CgogICAgZ2V0UmVhZERpcmVjdGlvbigpIHsKICAgICAgLy8gVGhlcmUgYXJlIGEgdHdvIHdheXMgd2UgY2FuIHJlYWQgZGF0YTogYSBkaXJlY3QgYGdldGAgcmVxdWVzdAogICAgICAvLyBvciBvcGVuaW5nIGEgY3Vyc29yIGFuZCBpdGVyYXRpbmcgdGhyb3VnaCBkYXRhLiBXZSBkb24ndCBrbm93CiAgICAgIC8vIHdoYXQgZnV0dXJlIHJlYWRzIGxvb2sgbGlrZSwgc28gd2UgZG9uJ3Qga25vdyB0aGUgYmVzdCBzdHJhdGVneQogICAgICAvLyB0byBwaWNrLiBBbHdheXMgY2hvb3Npbmcgb25lIHN0cmF0ZWd5IGZvcmdvZXMgYSBsb3Qgb2YKICAgICAgLy8gb3B0aW1pemF0aW9uLCBiZWNhdXNlIGl0ZXJhdGluZyB3aXRoIGEgY3Vyc29yIGlzIGEgbG90IGZhc3RlcgogICAgICAvLyB0aGFuIG1hbnkgYGdldGAgY2FsbHMuIE9uIHRoZSBvdGhlciBoYW5kLCBvcGVuaW5nIGEgY3Vyc29yIGlzCiAgICAgIC8vIHNsb3csIGFuZCBzbyBpcyBjYWxsaW5nIGBhZHZhbmNlYCB0byBtb3ZlIGEgY3Vyc29yIG92ZXIgYSBodWdlCiAgICAgIC8vIHJhbmdlIChsaWtlIG1vdmluZyBpdCAxMDAwIGl0ZW1zIGxhdGVyKSwgc28gbWFueSBgZ2V0YCBjYWxscyB3b3VsZAogICAgICAvLyBiZSBmYXN0ZXIuIEluIGdlbmVyYWw6CiAgICAgIC8vCiAgICAgIC8vICogTWFueSBgZ2V0YCBjYWxscyBhcmUgZmFzdGVyIHdoZW4gZG9pbmcgcmFuZG9tIGFjY2Vzc2VzCiAgICAgIC8vICogSXRlcmF0aW5nIHdpdGggYSBjdXJzb3IgaXMgZmFzdGVyIGlmIGRvaW5nIG1vc3RseSBzZXF1ZW50aWFsCiAgICAgIC8vICAgYWNjZXNzZXMKICAgICAgLy8KICAgICAgLy8gV2UgaW1wbGVtZW50IGEgaGV1cmlzdGljIGFuZCBrZWVwcyB0cmFjayBvZiB0aGUgbGFzdCAzIHJlYWRzCiAgICAgIC8vIGFuZCBkZXRlY3RzIHdoZW4gdGhleSBhcmUgbW9zdGx5IHNlcXVlbnRpYWwuIElmIHRoZXkgYXJlLCB3ZQogICAgICAvLyBvcGVuIGEgY3Vyc29yIGFuZCBzdGFydCByZWFkaW5nIGJ5IGl0ZXJhdGluZyBpdC4gSWYgbm90LCB3ZSBkbwogICAgICAvLyBkaXJlY3QgYGdldGAgY2FsbHMuCiAgICAgIC8vCiAgICAgIC8vIE9uIHRvcCBvZiBhbGwgb2YgdGhpcywgZWFjaCBicm93c2VyIGhhcyBkaWZmZXJlbnQgcGVyZgogICAgICAvLyBjaGFyYWN0ZXJpc3RpY3MuIFdlIHdpbGwgcHJvYmFibHkgd2FudCB0byBtYWtlIHRoZXNlIHRocmVzaG9sZHMKICAgICAgLy8gY29uZmlndXJhYmxlIHNvIHRoZSB1c2VyIGNhbiBjaGFuZ2UgdGhlbSBwZXItYnJvd3NlciBpZiBuZWVkZWQsCiAgICAgIC8vIGFzIHdlbGwgYXMgZmluZS10dW5pbmcgdGhlbSBmb3IgdGhlaXIgdXNhZ2Ugb2Ygc3FsaXRlLgoKICAgICAgbGV0IHByZXZSZWFkcyA9IHRoaXMucHJldlJlYWRzOwogICAgICBpZiAocHJldlJlYWRzKSB7CiAgICAgICAgLy8gSGFzIHRoZXJlIGJlZW4gMyBmb3J3YXJkIHNlcXVlbnRpYWwgcmVhZHMgd2l0aGluIDEwIGJsb2Nrcz8KICAgICAgICBpZiAoCiAgICAgICAgICBwcmV2UmVhZHNbMF0gPCBwcmV2UmVhZHNbMV0gJiYKICAgICAgICAgIHByZXZSZWFkc1sxXSA8IHByZXZSZWFkc1syXSAmJgogICAgICAgICAgcHJldlJlYWRzWzJdIC0gcHJldlJlYWRzWzBdIDwgMTAKICAgICAgICApIHsKICAgICAgICAgIHJldHVybiAnbmV4dCc7CiAgICAgICAgfQoKICAgICAgICAvLyBIYXMgdGhlcmUgYmVlbiAzIGJhY2t3YXJkcyBzZXF1ZW50aWFsIHJlYWRzIHdpdGhpbiAxMCBibG9ja3M/CiAgICAgICAgaWYgKAogICAgICAgICAgcHJldlJlYWRzWzBdID4gcHJldlJlYWRzWzFdICYmCiAgICAgICAgICBwcmV2UmVhZHNbMV0gPiBwcmV2UmVhZHNbMl0gJiYKICAgICAgICAgIHByZXZSZWFkc1swXSAtIHByZXZSZWFkc1syXSA8IDEwCiAgICAgICAgKSB7CiAgICAgICAgICByZXR1cm4gJ3ByZXYnOwogICAgICAgIH0KICAgICAgfQoKICAgICAgcmV0dXJuIG51bGw7CiAgICB9CgogICAgcmVhZChwb3NpdGlvbikgewogICAgICBsZXQgd2FpdEN1cnNvciA9ICgpID0+IHsKICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICAgICAgaWYgKHRoaXMuY3Vyc29yUHJvbWlzZSAhPSBudWxsKSB7CiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAgICAgICAnd2FpdEN1cnNvcigpIGNhbGxlZCBidXQgc29tZXRoaW5nIGVsc2UgaXMgYWxyZWFkeSB3YWl0aW5nJwogICAgICAgICAgICApOwogICAgICAgICAgfQogICAgICAgICAgdGhpcy5jdXJzb3JQcm9taXNlID0geyByZXNvbHZlLCByZWplY3QgfTsKICAgICAgICB9KTsKICAgICAgfTsKCiAgICAgIGlmICh0aGlzLmN1cnNvcikgewogICAgICAgIGxldCBjdXJzb3IgPSB0aGlzLmN1cnNvcjsKCiAgICAgICAgaWYgKAogICAgICAgICAgY3Vyc29yLmRpcmVjdGlvbiA9PT0gJ25leHQnICYmCiAgICAgICAgICBwb3NpdGlvbiA+IGN1cnNvci5rZXkgJiYKICAgICAgICAgIHBvc2l0aW9uIDwgY3Vyc29yLmtleSArIDEwMAogICAgICAgICkgewogICAgICAgICAgcmVjb3JkKCdzdHJlYW0tbmV4dCcpOwoKICAgICAgICAgIGN1cnNvci5hZHZhbmNlKHBvc2l0aW9uIC0gY3Vyc29yLmtleSk7CiAgICAgICAgICByZXR1cm4gd2FpdEN1cnNvcigpOwogICAgICAgIH0gZWxzZSBpZiAoCiAgICAgICAgICBjdXJzb3IuZGlyZWN0aW9uID09PSAncHJldicgJiYKICAgICAgICAgIHBvc2l0aW9uIDwgY3Vyc29yLmtleSAmJgogICAgICAgICAgcG9zaXRpb24gPiBjdXJzb3Iua2V5IC0gMTAwCiAgICAgICAgKSB7CiAgICAgICAgICByZWNvcmQoJ3N0cmVhbS1uZXh0Jyk7CgogICAgICAgICAgY3Vyc29yLmFkdmFuY2UoY3Vyc29yLmtleSAtIHBvc2l0aW9uKTsKICAgICAgICAgIHJldHVybiB3YWl0Q3Vyc29yKCk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIC8vIERpdGNoIHRoZSBjdXJzb3IKICAgICAgICAgIHRoaXMuY3Vyc29yID0gbnVsbDsKICAgICAgICAgIHJldHVybiB0aGlzLnJlYWQocG9zaXRpb24pOwogICAgICAgIH0KICAgICAgfSBlbHNlIHsKICAgICAgICAvLyBXZSBkb24ndCBhbHJlYWR5IGhhdmUgYSBjdXJzb3IuIFdlIG5lZWQgdG8gYSBmcmVzaCByZWFkOwogICAgICAgIC8vIHNob3VsZCB3ZSBvcGVuIGEgY3Vyc29yIG9yIGNhbGwgYGdldGA/CgogICAgICAgIGxldCBkaXIgPSB0aGlzLmdldFJlYWREaXJlY3Rpb24oKTsKICAgICAgICBpZiAoZGlyKSB7CiAgICAgICAgICAvLyBPcGVuIGEgY3Vyc29yCiAgICAgICAgICB0aGlzLnByZXZSZWFkcyA9IG51bGw7CgogICAgICAgICAgbGV0IGtleVJhbmdlOwogICAgICAgICAgaWYgKGRpciA9PT0gJ3ByZXYnKSB7CiAgICAgICAgICAgIGtleVJhbmdlID0gSURCS2V5UmFuZ2UudXBwZXJCb3VuZChwb3NpdGlvbik7CiAgICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBrZXlSYW5nZSA9IElEQktleVJhbmdlLmxvd2VyQm91bmQocG9zaXRpb24pOwogICAgICAgICAgfQoKICAgICAgICAgIGxldCByZXEgPSB0aGlzLnN0b3JlLm9wZW5DdXJzb3Ioa2V5UmFuZ2UsIGRpcik7CiAgICAgICAgICByZWNvcmQoJ3N0cmVhbScpOwoKICAgICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBlID0+IHsKICAgICAgICAgICAgZW5kUmVjb3JkaW5nKCdzdHJlYW0nKTsKICAgICAgICAgICAgZW5kUmVjb3JkaW5nKCdzdHJlYW0tbmV4dCcpOwoKICAgICAgICAgICAgbGV0IGN1cnNvciA9IGUudGFyZ2V0LnJlc3VsdDsKICAgICAgICAgICAgdGhpcy5jdXJzb3IgPSBjdXJzb3I7CgogICAgICAgICAgICBpZiAodGhpcy5jdXJzb3JQcm9taXNlID09IG51bGwpIHsKICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0dvdCBkYXRhIGZyb20gY3Vyc29yIGJ1dCBub3RoaW5nIGlzIHdhaXRpbmcgaXQnKTsKICAgICAgICAgICAgfQogICAgICAgICAgICB0aGlzLmN1cnNvclByb21pc2UucmVzb2x2ZShjdXJzb3IgPyBjdXJzb3IudmFsdWUgOiBudWxsKTsKICAgICAgICAgICAgdGhpcy5jdXJzb3JQcm9taXNlID0gbnVsbDsKICAgICAgICAgIH07CiAgICAgICAgICByZXEub25lcnJvciA9IGUgPT4gewogICAgICAgICAgICBjb25zb2xlLmxvZygnQ3Vyc29yIGZhaWx1cmU6JywgZSk7CgogICAgICAgICAgICBpZiAodGhpcy5jdXJzb3JQcm9taXNlID09IG51bGwpIHsKICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0dvdCBkYXRhIGZyb20gY3Vyc29yIGJ1dCBub3RoaW5nIGlzIHdhaXRpbmcgaXQnKTsKICAgICAgICAgICAgfQogICAgICAgICAgICB0aGlzLmN1cnNvclByb21pc2UucmVqZWN0KGUpOwogICAgICAgICAgICB0aGlzLmN1cnNvclByb21pc2UgPSBudWxsOwogICAgICAgICAgfTsKCiAgICAgICAgICByZXR1cm4gd2FpdEN1cnNvcigpOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICBpZiAodGhpcy5wcmV2UmVhZHMgPT0gbnVsbCkgewogICAgICAgICAgICB0aGlzLnByZXZSZWFkcyA9IFswLCAwLCAwXTsKICAgICAgICAgIH0KICAgICAgICAgIHRoaXMucHJldlJlYWRzLnB1c2gocG9zaXRpb24pOwogICAgICAgICAgdGhpcy5wcmV2UmVhZHMuc2hpZnQoKTsKCiAgICAgICAgICByZXR1cm4gdGhpcy5nZXQocG9zaXRpb24pOwogICAgICAgIH0KICAgICAgfQogICAgfQoKICAgIGFzeW5jIHNldChpdGVtKSB7CiAgICAgIHRoaXMucHJldlJlYWRzID0gbnVsbDsKCiAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgICAgbGV0IHJlcSA9IHRoaXMuc3RvcmUucHV0KGl0ZW0udmFsdWUsIGl0ZW0ua2V5KTsKICAgICAgICByZXEub25zdWNjZXNzID0gZSA9PiByZXNvbHZlKHJlcS5yZXN1bHQpOwogICAgICAgIHJlcS5vbmVycm9yID0gZSA9PiByZWplY3QoZSk7CiAgICAgIH0pOwogICAgfQoKICAgIGFzeW5jIGJ1bGtTZXQoaXRlbXMpIHsKICAgICAgdGhpcy5wcmV2UmVhZHMgPSBudWxsOwoKICAgICAgZm9yIChsZXQgaXRlbSBvZiBpdGVtcykgewogICAgICAgIHRoaXMuc3RvcmUucHV0KGl0ZW0udmFsdWUsIGl0ZW0ua2V5KTsKICAgICAgfQogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gbG9hZERiKG5hbWUpIHsKICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgIGlmIChvcGVuRGJzLmdldChuYW1lKSkgewogICAgICAgIHJlc29sdmUob3BlbkRicy5nZXQobmFtZSkpOwogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgY29uc29sZS5sb2coJ29wZW5pbmcnLCBuYW1lKTsKCiAgICAgIGxldCByZXEgPSBnbG9iYWxUaGlzLmluZGV4ZWREQi5vcGVuKG5hbWUsIDEpOwogICAgICByZXEub25zdWNjZXNzID0gZXZlbnQgPT4gewogICAgICAgIGNvbnNvbGUubG9nKCdkYiBpcyBvcGVuIScsIG5hbWUpOwogICAgICAgIGxldCBkYiA9IGV2ZW50LnRhcmdldC5yZXN1bHQ7CgogICAgICAgIGRiLm9udmVyc2lvbmNoYW5nZSA9ICgpID0+IHsKICAgICAgICAgIC8vIFRPRE86IE5vdGlmeSB0aGUgdXNlciBzb21laG93CiAgICAgICAgICBjb25zb2xlLmxvZygnY2xvc2luZyBiZWNhdXNlIHZlcnNpb24gY2hhbmdlZCcpOwogICAgICAgICAgZGIuY2xvc2UoKTsKICAgICAgICAgIG9wZW5EYnMuZGVsZXRlKG5hbWUpOwogICAgICAgIH07CgogICAgICAgIGRiLm9uY2xvc2UgPSAoKSA9PiB7CiAgICAgICAgICBvcGVuRGJzLmRlbGV0ZShuYW1lKTsKICAgICAgICB9OwoKICAgICAgICBvcGVuRGJzLnNldChuYW1lLCBkYik7CiAgICAgICAgcmVzb2x2ZShkYik7CiAgICAgIH07CiAgICAgIHJlcS5vbnVwZ3JhZGVuZWVkZWQgPSBldmVudCA9PiB7CiAgICAgICAgbGV0IGRiID0gZXZlbnQudGFyZ2V0LnJlc3VsdDsKICAgICAgICBpZiAoIWRiLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoJ2RhdGEnKSkgewogICAgICAgICAgZGIuY3JlYXRlT2JqZWN0U3RvcmUoJ2RhdGEnKTsKICAgICAgICB9CiAgICAgIH07CiAgICAgIHJlcS5vbmJsb2NrZWQgPSBlID0+IGNvbnNvbGUubG9nKCdibG9ja2VkJywgZSk7CiAgICAgIHJlcS5vbmVycm9yID0gcmVxLm9uYWJvcnQgPSBlID0+IHJlamVjdChlLnRhcmdldC5lcnJvcik7CiAgICB9KTsKICB9CgogIGZ1bmN0aW9uIGNsb3NlRGIobmFtZSkgewogICAgbGV0IG9wZW5EYiA9IG9wZW5EYnMuZ2V0KG5hbWUpOwogICAgaWYgKG9wZW5EYikgewogICAgICBvcGVuRGIuY2xvc2UoKTsKICAgICAgb3BlbkRicy5kZWxldGUobmFtZSk7CiAgICB9CiAgfQoKICBmdW5jdGlvbiBnZXRUcmFuc2FjdGlvbihuYW1lKSB7CiAgICByZXR1cm4gdHJhbnNhY3Rpb25zLmdldChuYW1lKTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIHdpdGhUcmFuc2FjdGlvbihuYW1lLCBtb2RlLCBmdW5jKSB7CiAgICBsZXQgdHJhbnMgPSB0cmFuc2FjdGlvbnMuZ2V0KG5hbWUpOwogICAgaWYgKHRyYW5zKSB7CiAgICAgIC8vIElmIGEgdHJhbnNhY3Rpb24gYWxyZWFkeSBleGlzdHMsIHRoYXQgbWVhbnMgdGhlIGZpbGUgaGFzIGJlZW4KICAgICAgLy8gbG9ja2VkLiBXZSBkb24ndCBmdWxseSBzdXBwb3J0IGFyYml0cmFyeSBuZXN0ZWQgdHJhbnNhY3Rpb25zLAogICAgICAvLyBhcyBzZWVuIGJlbG93ICh3ZSB3b24ndCB1cGdyYWRlIGEgYHJlYWRvbmx5YCB0byBgcmVhZHdyaXRlYAogICAgICAvLyBhdXRvbWF0aWNhbGx5KSBhbmQgdGhpcyBpcyBtYWlubHkgZm9yIHRoZSB1c2UgY2FzZSB3aGVyZSBzcWxpdGUKICAgICAgLy8gbG9ja3MgdGhlIGRiIGFuZCBjcmVhdGVzIGEgdHJhbnNhY3Rpb24gZm9yIHRoZSBkdXJhY3Rpb24gb2YgdGhlCiAgICAgIC8vIGxvY2suIFdlIGRvbid0IGFjdHVhbGx5IHdyaXRlIGNvZGUgaW4gYSB3YXkgdGhhdCBhc3N1bWVzIG5lc3RlZAogICAgICAvLyB0cmFuc2FjdGlvbnMsIHNvIGp1c3QgZXJyb3IgaGVyZQogICAgICBpZiAobW9kZSA9PT0gJ3JlYWR3cml0ZScgJiYgdHJhbnMubG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuU0hBUkVEKSB7CiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBdHRlbXB0ZWQgd3JpdGUgYnV0IG9ubHkgaGFzIFNIQVJFRCBsb2NrJyk7CiAgICAgIH0KICAgICAgcmV0dXJuIGZ1bmModHJhbnMpOwogICAgfQoKICAgIC8vIE91dHNpZGUgdGhlIHNjb3BlIG9mIGEgbG9jaywgY3JlYXRlIGEgdGVtcG9yYXJ5IHRyYW5zYWN0aW9uCiAgICB0cmFucyA9IG5ldyBUcmFuc2FjdGlvbihhd2FpdCBsb2FkRGIobmFtZSksIG1vZGUpOwogICAgYXdhaXQgZnVuYyh0cmFucyk7CiAgICBhd2FpdCB0cmFucy53YWl0Q29tcGxldGUoKTsKICB9CgogIC8vIExvY2tpbmcgc3RyYXRlZ3k6CiAgLy8KICAvLyAqIFdlIG1hcCBzcWxpdGUncyBsb2NrcyBvbnRvIEluZGV4ZWREQidzIHRyYW5zYWN0aW9uIHNlbWFudGljcy4KICAvLyAgIFJlYWQgdHJhbnNhY3Rpb25zIG1heSBleGVjdXRlIGluIHBhcmFsbGVsLiBSZWFkL3dyaXRlCiAgLy8gICB0cmFuc2FjdGlvbnMgYXJlIHF1ZXVlZCB1cCBhbmQgd2FpdCB1bnRpbCBhbGwgcHJlY2VkaW5nCiAgLy8gICByZWFkIHRyYW5zYWN0aW9ucyBmaW5pc2ggZXhlY3V0aW5nLiBSZWFkIHRyYW5zYWN0aW9ucyBzdGFydGVkCiAgLy8gICBhZnRlciBhIHJlYWQvd3JpdGUgdHJhbnNhY3Rpb24gd2FpdCB1bnRpbCBpdCBpcyBmaW5pc2hlZC4KICAvLwogIC8vICogSURCIHRyYW5zYWN0aW9ucyB3aWxsIHdhaXQgZm9yZXZlciB1bnRpbCB0aGV5IGNhbiBleGVjdXRlIChmb3IKICAvLyAgIGV4YW1wbGUsIHRoZXkgbWF5IGJlIGJsb2NrZWQgb24gYSByZWFkL3dyaXRlIHRyYW5zYWN0aW9uKS4gV2UKICAvLyAgIGRvbid0IHdhbnQgdG8gYWxsb3cgc3FsaXRlIHRyYW5zYWN0aW9ucyB0byB3YWl0IGZvcmV2ZXIsIHNvCiAgLy8gICB3ZSBtYW51YWxseSB0aW1lb3V0IGlmIGEgdHJhbnNhY3Rpb24gdGFrZXMgdG9vIGxvbmcgdG8KICAvLyAgIHN0YXJ0IGV4ZWN1dGluZy4gVGhpcyBzaW11bGF0ZXMgdGhlIGJlaGF2aW9yIG9mIGEgc3FsaXRlCiAgLy8gICBiYWlsaW5nIGlmIGl0IGNhbid0IHJlcXVpcmUgYSBsb2NrLgogIC8vCiAgLy8gKiBBIFNIQVJFRCBsb2NrIHdhbnRzIHRvIHJlYWQgZnJvbSB0aGUgZGIuIFdlIHN0YXJ0IGEgcmVhZAogIC8vICAgdHJhbnNhY3Rpb24gYW5kIHJlYWQgdGhlIGZpcnN0IGJsb2NrLCBhbmQgaWYgd2UgcmVhZCBpdCB3aXRoaW4KICAvLyAgIDUwMG1zIHdlIGNvbnNpZGVyIHRoZSBsb2NrIHN1Y2Nlc3NmdWwuIE90aGVyd2lzZSB0aGUgbG9jawogIC8vICAgZmFpbGVkIGFuZCB3ZSByZXR1cm4gU1FMSVRFX0JVU1kuIChUaGVyZSdzIG5vIHBlcmYgZG93bnNpZGUKICAvLyAgIHRvIHJlYWRpbmcgdGhlIGZpcnN0IGJsb2NrIC0gaXQgaGFzIHRvIGJlIHJlYWQgYW55d2F5IHRvIGNoZWNrCiAgLy8gICBieXRlcyAyNC0zOSBmb3IgdGhlIGNoYW5nZSBjb3VudGVyKQogIC8vCiAgLy8gKiBBIFJFU0VSVkVEIGxvY2sgbWVhbnMgdGhlIGRiIHdhbnRzIHRvIHN0YXJ0IHdyaXRpbmcgKHRoaW5rIG9mCiAgLy8gICBgQkVHSU4gVFJBTlNBQ1RJT05gKS4gT25seSBvbmUgcHJvY2VzcyBjYW4gb2J0YWluIGEgUkVTRVJWRUQKICAvLyAgIGxvY2sgYXQgYSB0aW1lLCBidXQgbm9ybWFsbHkgc3FsaXRlIHN0aWxsIGxlYWRzIG5ldyByZWFkIGxvY2tzCiAgLy8gICBoYXBwZW4uIEl0IGlzbid0IHVudGlsIGFuIEVYQ0xVU0lWRSBsb2NrIGlzIGhlbGQgdGhhdCByZWFkcyBhcmUKICAvLyAgIGJsb2NrZWQuIEhvd2V2ZXIsIHNpbmNlIHdlIG5lZWQgdG8gZ3VhcmFudGVlIG9ubHkgb25lIFJFU0VSVkVECiAgLy8gICBsb2NrIGF0IG9uY2UgKG90aGVyd2lzZSBkYXRhIGNvdWxkIGNoYW5nZSBmcm9tIGFub3RoZXIgcHJvY2VzcwogIC8vICAgd2l0aGluIGEgdHJhbnNhY3Rpb24sIGNhdXNpbmcgZmF1bHR5IGNhY2hlcyBldGMpIHRoZSBzaW1wbGVzdAogIC8vICAgdGhpbmcgdG8gZG8gaXMgZ28gYWhlYWQgYW5kIGdyYWIgYSByZWFkL3dyaXRlIHRyYW5zYWN0aW9uIHRoYXQKICAvLyAgIHJlcHJlc2VudHMgdGhlIFJFU0VSVkVEIGxvY2suIFRoaXMgd2lsbCBibG9jayBhbGwgcmVhZHMgZnJvbQogIC8vICAgaGFwcGVuaW5nLCBhbmQgaXMgZXNzZW50aWFsbHkgdGhlIHNhbWUgYXMgYW4gRVhDTFVTSVZFIGxvY2suCiAgLy8KICAvLyAgICAgKiBUaGUgbWFpbiBwcm9ibGVtIGhlcmUgaXMgd2UgY2FuJ3QgInVwZ3JhZGUiIGEgYHJlYWRvbmx5YAogIC8vICAgICAgIHRyYW5zYWN0aW9uIHRvIGByZWFkd3JpdGVgLCBidXQgbmF0aXZlIHNxbGl0ZSBjYW4gdXBncmFkZSBhCiAgLy8gICAgICAgbG9jayBmcm9tIFNIQVJFRCB0byBSRVNFUlZFRC4gV2UgbmVlZCB0byBzdGFydCBhIG5ldwogIC8vICAgICAgIHRyYW5zYWN0aW9uIHRvIGRvIHNvLCBhbmQgYmVjYXVzZSBvZiB0aGF0IHRoZXJlIG1pZ2h0IGJlCiAgLy8gICAgICAgb3RoZXIgYHJlYWR3cml0ZWAgdHJhbnNhY3Rpb25zIHRoYXQgZ2V0IHJ1biBkdXJpbmcgdGhlCiAgLy8gICAgICAgInVwZ3JhZGUiIHdoaWNoIGludmFsaWRhdGVzIHRoZSB3aG9sZSBsb2NraW5nIHByb2Nlc3MgYW5kCiAgLy8gICAgICAgYW5kIGNvcnJ1cHRzIGRhdGEuCiAgLy8KICAvLyAqIElkZWFsbHksIHdlIGNvdWxkIHRlbGwgc3FsaXRlIHRvIHNraXAgU0hBUkVEIGxvY2tzIGVudGlyZWx5LiBXZQogIC8vICAgZG9uJ3QgbmVlZCB0aGVtIHNpbmNlIHdlIGNhbiByZWx5IG9uIEluZGV4ZWREQidzIHNlbWFudGljcy4KICAvLyAgIFRoZW4gd2hlbiBpdCB3YW50cyB0byBzdGFydCB3cml0aW5nLCB3ZSBnZXQgYSBSRVNFUlZFRCBsb2NrCiAgLy8gICB3aXRob3V0IGhhdmluZyB0byB1cGdyYWRlIGZyb20gU0hBUkVELiBUaGlzIHdvdWxkIHNhdmUgdXMKICAvLyAgIHRoZSBjb3N0IG9mIGEgYHJlYWRvbmx5YCB0cmFuc2FjdGlvbiB3aGVuIHdyaXRpbmc7IHJpZ2h0IG5vdwogIC8vICAgaXQgbXVzdCBvcGVuIGEgYHJlYWRvbmx5YCB0cmFuc2FjdGlvbiBhbmQgdGhlbiBpbW1lZGlhdGVseSBvcGVuCiAgLy8gICBhIGByZWFkd3JpdGVgIHRvIHVwZ3JhZGUgaXQuIEkgdGhvdWdodCBvZiBkZWZlcnJpbmcgb3BlbmluZyB0aGUKICAvLyAgIGByZWFkb25seWAgdHJhbnNhY3Rpb24gdW50aWwgc29tZXRoaW5nIGlzIGFjdHVhbGx5IHJlYWQsIGJ1dAogIC8vICAgdW5mb3J0dW5hdGVseSBzcWxpdGUgb3BlbnMgaXQsIHJlYWRzIHRoZSBmaXJzdCBibG9jaywgYW5kIHRoZW4KICAvLyAgIHVwZ3JhZGVzIGl0LiBTbyB0aGVyZSdzIG5vIHdheSBhcm91bmQgaXQuIChXZSBjYW4ndCBhc3N1bWUgaXQncwogIC8vICAgYSBgcmVhZHdyaXRlYCB0cmFuc2FjdGlvbiBhdCB0aGF0IHBvaW50IHNpbmNlIHRoYXQgd291bGQgYXNzdW1lCiAgLy8gICBhbGwgU0hBUkVEIGxvY2tzIGFyZSBgcmVhZHdyaXRlYCwgcmVtb3ZpbmcgdGhlIHBvc3NpYmlsaXR5IG9mCiAgLy8gICBjb25jdXJyZW50IHJlYWRzKS4KICAvLwogIC8vICogVXBncmFkaW5nIHRvIGFuIEVYQ0xVU0lWRSBsb2NrIGlzIGEgbm9vcCwgc2luY2Ugd2UgdHJlYXQgUkVTRVJWRUQKICAvLyAgIGxvY2tzIGFzIEVYQ0xVU0lWRS4KICBhc3luYyBmdW5jdGlvbiBoYW5kbGVMb2NrKHdyaXRlciwgbmFtZSwgbG9ja1R5cGUpIHsKICAgIC8vIGNvbnNvbGUubG9nKCdsb2NraW5nJywgbmFtZSwgbG9ja1R5cGUsIHBlcmZvcm1hbmNlLm5vdygpKTsKCiAgICBsZXQgdHJhbnMgPSB0cmFuc2FjdGlvbnMuZ2V0KG5hbWUpOwogICAgaWYgKHRyYW5zKSB7CiAgICAgIGlmIChsb2NrVHlwZSA+IHRyYW5zLmxvY2tUeXBlKSB7CiAgICAgICAgLy8gVXBncmFkZSBTSEFSRUQgdG8gRVhDTFVTSVZFCiAgICAgICAgYXNzZXJ0KAogICAgICAgICAgdHJhbnMubG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuU0hBUkVELAogICAgICAgICAgYFVwcmFkaW5nIGxvY2sgdHlwZSBmcm9tICR7dHJhbnMubG9ja1R5cGV9IGlzIGludmFsaWRgCiAgICAgICAgKTsKICAgICAgICBhc3NlcnQoCiAgICAgICAgICBsb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5SRVNFUlZFRCB8fCBsb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5FWENMVVNJVkUsCiAgICAgICAgICBgVXBncmFkaW5nIGxvY2sgdHlwZSB0byAke2xvY2tUeXBlfSBpcyBpbnZhbGlkYAogICAgICAgICk7CgogICAgICAgIGxldCBzdWNjZXNzID0gYXdhaXQgdHJhbnMudXBncmFkZUV4Y2x1c2l2ZSgpOwogICAgICAgIHdyaXRlci5pbnQzMihzdWNjZXNzID8gMCA6IC0xKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgICAgfSBlbHNlIHsKICAgICAgICAvLyBJZiBub3QgdXBncmFkaW5nIGFuZCB3ZSBhbHJlYWR5IGhhdmUgYSBsb2NrLCBtYWtlIHN1cmUgdGhpcwogICAgICAgIC8vIGlzbid0IGEgZG93bmdyYWRlCiAgICAgICAgYXNzZXJ0KAogICAgICAgICAgdHJhbnMubG9ja1R5cGUgPT09IGxvY2tUeXBlLAogICAgICAgICAgYERvd25ncmFkaW5nIGxvY2sgdG8gJHtsb2NrVHlwZX0gaXMgaW52YWxpZGAKICAgICAgICApOwoKICAgICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgIH0KICAgIH0gZWxzZSB7CiAgICAgIGFzc2VydCgKICAgICAgICBsb2NrVHlwZSA9PT0gTE9DS19UWVBFUy5TSEFSRUQsCiAgICAgICAgYE5ldyBsb2NrcyBtdXN0IHN0YXJ0IGFzIFNIQVJFRCBpbnN0ZWFkIG9mICR7bG9ja1R5cGV9YAogICAgICApOwoKICAgICAgbGV0IHRyYW5zID0gbmV3IFRyYW5zYWN0aW9uKGF3YWl0IGxvYWREYihuYW1lKSk7CiAgICAgIGlmICgoYXdhaXQgdHJhbnMucHJlZmV0Y2hGaXJzdEJsb2NrKDUwMCkpID09IG51bGwpIDsKCiAgICAgIHRyYW5zYWN0aW9ucy5zZXQobmFtZSwgdHJhbnMpOwoKICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgIH0KICB9CgogIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZVVubG9jayh3cml0ZXIsIG5hbWUsIGxvY2tUeXBlKSB7CiAgICAvLyBjb25zb2xlLmxvZygndW5sb2NraW5nJywgbmFtZSwgbG9ja1R5cGUsIHBlcmZvcm1hbmNlLm5vdygpKTsKCiAgICBsZXQgdHJhbnMgPSBnZXRUcmFuc2FjdGlvbihuYW1lKTsKCiAgICBpZiAobG9ja1R5cGUgPT09IExPQ0tfVFlQRVMuU0hBUkVEKSB7CiAgICAgIGlmICh0cmFucyA9PSBudWxsKSB7CiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmxvY2sgZXJyb3IgKFNIQVJFRCk6IG5vIHRyYW5zYWN0aW9uIHJ1bm5pbmcnKTsKICAgICAgfQoKICAgICAgaWYgKHRyYW5zLmxvY2tUeXBlID09PSBMT0NLX1RZUEVTLkVYQ0xVU0lWRSkgewogICAgICAgIHRyYW5zLmRvd25ncmFkZVNoYXJlZCgpOwogICAgICB9CiAgICB9IGVsc2UgaWYgKGxvY2tUeXBlID09PSBMT0NLX1RZUEVTLk5PTkUpIHsKICAgICAgLy8gSSB0aG91Z2h0IHdlIGNvdWxkIGFzc3VtZSBhIGxvY2sgaXMgYWx3YXlzIG9wZW4gd2hlbiBgdW5sb2NrYAogICAgICAvLyBpcyBjYWxsZWQsIGJ1dCBpdCBhbHNvIGNhbGxzIGB1bmxvY2tgIHdoZW4gY2xvc2luZyB0aGUgZmlsZSBubwogICAgICAvLyBtYXR0ZXIgd2hhdC4gRG8gbm90aGluZyBpZiB0aGVyZSdzIG5vIGxvY2sgY3VycmVudGx5CiAgICAgIGlmICh0cmFucykgewogICAgICAgIC8vIFRPRE86IHRoaXMgaXMgd2hlcmUgYW4gZXJyb3IgY291bGQgYnViYmxlIHVwLiBIYW5kbGUgaXQKICAgICAgICBhd2FpdCB0cmFucy53YWl0Q29tcGxldGUoKTsKICAgICAgICB0cmFuc2FjdGlvbnMuZGVsZXRlKG5hbWUpOwogICAgICB9CiAgICB9CgogICAgd3JpdGVyLmludDMyKDApOwogICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVSZWFkKHdyaXRlciwgbmFtZSwgcG9zaXRpb24pIHsKICAgIHJldHVybiB3aXRoVHJhbnNhY3Rpb24obmFtZSwgJ3JlYWRvbmx5JywgYXN5bmMgdHJhbnMgPT4gewogICAgICBsZXQgZGF0YSA9IGF3YWl0IHRyYW5zLnJlYWQocG9zaXRpb24pOwoKICAgICAgaWYgKGRhdGEgPT0gbnVsbCkgewogICAgICAgIHdyaXRlci5ieXRlcyhuZXcgQXJyYXlCdWZmZXIoMCkpOwogICAgICB9IGVsc2UgewogICAgICAgIHdyaXRlci5ieXRlcyhkYXRhKTsKICAgICAgfQogICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgIH0pOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlV3JpdGVzKHdyaXRlciwgbmFtZSwgd3JpdGVzKSB7CiAgICByZXR1cm4gd2l0aFRyYW5zYWN0aW9uKG5hbWUsICdyZWFkd3JpdGUnLCBhc3luYyB0cmFucyA9PiB7CiAgICAgIGF3YWl0IHRyYW5zLmJ1bGtTZXQod3JpdGVzLm1hcCh3ID0+ICh7IGtleTogdy5wb3MsIHZhbHVlOiB3LmRhdGEgfSkpKTsKCiAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9KTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZVJlYWRNZXRhKHdyaXRlciwgbmFtZSkgewogICAgcmV0dXJuIHdpdGhUcmFuc2FjdGlvbihuYW1lLCAncmVhZG9ubHknLCBhc3luYyB0cmFucyA9PiB7CiAgICAgIHRyeSB7CiAgICAgICAgY29uc29sZS5sb2coJ1JlYWRpbmcgbWV0YScpOwogICAgICAgIGxldCByZXMgPSBhd2FpdCB0cmFucy5nZXQoLTEpOwogICAgICAgIGNvbnNvbGUubG9nKCdSZWFkaW5nIG1ldGEgKGRvbmUpJywgcmVzKTsKCiAgICAgICAgbGV0IG1ldGEgPSByZXM7CiAgICAgICAgd3JpdGVyLmludDMyKG1ldGEgPyBtZXRhLnNpemUgOiAtMSk7CiAgICAgICAgd3JpdGVyLmludDMyKG1ldGEgPyBtZXRhLmJsb2NrU2l6ZSA6IC0xKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgY29uc29sZS5sb2coZXJyKTsKICAgICAgICB3cml0ZXIuaW50MzIoLTEpOwogICAgICAgIHdyaXRlci5pbnQzMigtMSk7CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgIH0KICAgIH0pOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlV3JpdGVNZXRhKHdyaXRlciwgbmFtZSwgbWV0YSkgewogICAgcmV0dXJuIHdpdGhUcmFuc2FjdGlvbihuYW1lLCAncmVhZHdyaXRlJywgYXN5bmMgdHJhbnMgPT4gewogICAgICB0cnkgewogICAgICAgIGF3YWl0IHRyYW5zLnNldCh7IGtleTogLTEsIHZhbHVlOiBtZXRhIH0pOwoKICAgICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgIGNvbnNvbGUubG9nKGVycik7CiAgICAgICAgd3JpdGVyLmludDMyKC0xKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgICAgfQogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVEZWxldGVGaWxlKHdyaXRlciwgbmFtZSkgewogICAgdHJ5IHsKICAgICAgY2xvc2VEYihuYW1lKTsKCiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgICBsZXQgcmVxID0gZ2xvYmFsVGhpcy5pbmRleGVkREIuZGVsZXRlRGF0YWJhc2UobmFtZSk7CiAgICAgICAgcmVxLm9uc3VjY2VzcyA9IHJlc29sdmU7CiAgICAgICAgcmVxLm9uZXJyb3IgPSByZWplY3Q7CiAgICAgIH0pOwoKICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICB3cml0ZXIuaW50MzIoLTEpOwogICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgIH0KICB9CgogIGFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNsb3NlRmlsZSh3cml0ZXIsIG5hbWUpIHsKICAgIGNsb3NlRGIobmFtZSk7CgogICAgd3JpdGVyLmludDMyKDApOwogICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgfQoKICAvLyBgbGlzdGVuYCBjb250aW51YWxseSBsaXN0ZW5zIGZvciByZXF1ZXN0cyB2aWEgdGhlIHNoYXJlZCBidWZmZXIuCiAgLy8gUmlnaHQgbm93IGl0J3MgaW1wbGVtZW50ZWQgaW4gYSB0YWlsLWNhbGwgc3R5bGUgKGBsaXN0ZW5gIGlzCiAgLy8gcmVjdXJzaXZlbHkgY2FsbGVkKSBiZWNhdXNlIEkgdGhvdWdodCB0aGF0IHdhcyBuZWNlc3NhcnkgZm9yCiAgLy8gdmFyaW91cyByZWFzb25zLiBXZSBjYW4gY29udmVydCB0aGlzIHRvIGEgYHdoaWxlKDEpYCBsb29wIHdpdGgKICAvLyBhbmQgdXNlIGBhd2FpdGAgdGhvdWdoCiAgYXN5bmMgZnVuY3Rpb24gbGlzdGVuKHJlYWRlciwgd3JpdGVyKSB7CiAgICBsZXQgbWV0aG9kID0gcmVhZGVyLnN0cmluZygpOwoKICAgIHN3aXRjaCAobWV0aG9kKSB7CiAgICAgIGNhc2UgJ3N0YXRzLXN0YXJ0JzogewogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIHN0YXJ0KCk7CgogICAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICdzdGF0cyc6IHsKICAgICAgICByZWFkZXIuZG9uZSgpOwoKICAgICAgICBhd2FpdCBlbmQoKTsKCiAgICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ3dyaXRlQmxvY2tzJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIGxldCB3cml0ZXMgPSBbXTsKICAgICAgICB3aGlsZSAoIXJlYWRlci5kb25lKCkpIHsKICAgICAgICAgIGxldCBwb3MgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICAgIGxldCBkYXRhID0gcmVhZGVyLmJ5dGVzKCk7CiAgICAgICAgICB3cml0ZXMucHVzaCh7IHBvcywgZGF0YSB9KTsKICAgICAgICB9CgogICAgICAgIGF3YWl0IGhhbmRsZVdyaXRlcyh3cml0ZXIsIG5hbWUsIHdyaXRlcyk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAncmVhZEJsb2NrJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIGxldCBwb3MgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICByZWFkZXIuZG9uZSgpOwoKICAgICAgICBhd2FpdCBoYW5kbGVSZWFkKHdyaXRlciwgbmFtZSwgcG9zKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICdyZWFkTWV0YSc6IHsKICAgICAgICBsZXQgbmFtZSA9IHJlYWRlci5zdHJpbmcoKTsKICAgICAgICByZWFkZXIuZG9uZSgpOwogICAgICAgIGF3YWl0IGhhbmRsZVJlYWRNZXRhKHdyaXRlciwgbmFtZSk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAnd3JpdGVNZXRhJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIGxldCBzaXplID0gcmVhZGVyLmludDMyKCk7CiAgICAgICAgbGV0IGJsb2NrU2l6ZSA9IHJlYWRlci5pbnQzMigpOwogICAgICAgIHJlYWRlci5kb25lKCk7CiAgICAgICAgYXdhaXQgaGFuZGxlV3JpdGVNZXRhKHdyaXRlciwgbmFtZSwgeyBzaXplLCBibG9ja1NpemUgfSk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAnZGVsZXRlRmlsZSc6IHsKICAgICAgICBsZXQgbmFtZSA9IHJlYWRlci5zdHJpbmcoKTsKICAgICAgICByZWFkZXIuZG9uZSgpOwoKICAgICAgICBhd2FpdCBoYW5kbGVEZWxldGVGaWxlKHdyaXRlciwgbmFtZSk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAnY2xvc2VGaWxlJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGhhbmRsZUNsb3NlRmlsZSh3cml0ZXIsIG5hbWUpOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ2xvY2tGaWxlJzogewogICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgIGxldCBsb2NrVHlwZSA9IHJlYWRlci5pbnQzMigpOwogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGhhbmRsZUxvY2sod3JpdGVyLCBuYW1lLCBsb2NrVHlwZSk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAndW5sb2NrRmlsZSc6IHsKICAgICAgICBsZXQgbmFtZSA9IHJlYWRlci5zdHJpbmcoKTsKICAgICAgICBsZXQgbG9ja1R5cGUgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICByZWFkZXIuZG9uZSgpOwoKICAgICAgICBhd2FpdCBoYW5kbGVVbmxvY2sod3JpdGVyLCBuYW1lLCBsb2NrVHlwZSk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgZGVmYXVsdDoKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Vua25vd24gbWV0aG9kOiAnICsgbWV0aG9kKTsKICAgIH0KICB9CgogIHNlbGYub25tZXNzYWdlID0gbXNnID0+IHsKICAgIHN3aXRjaCAobXNnLmRhdGEudHlwZSkgewogICAgICBjYXNlICdpbml0JzogewogICAgICAgIHBvc3RNZXNzYWdlKHsgdHlwZTogJ3dvcmtlci1yZWFkeScgfSk7CiAgICAgICAgbGV0IFthcmdCdWZmZXIsIHJlc3VsdEJ1ZmZlcl0gPSBtc2cuZGF0YS5idWZmZXJzOwogICAgICAgIGxldCByZWFkZXIgPSBuZXcgUmVhZGVyKGFyZ0J1ZmZlciwgeyBuYW1lOiAnYXJncycsIGRlYnVnOiBmYWxzZSB9KTsKICAgICAgICBsZXQgd3JpdGVyID0gbmV3IFdyaXRlcihyZXN1bHRCdWZmZXIsIHsgbmFtZTogJ3Jlc3VsdHMnLCBkZWJ1ZzogZmFsc2UgfSk7CiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQogICAgfQogIH07Cgp9KCkpOwoK', null, false);
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
