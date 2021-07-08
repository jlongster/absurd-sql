let FINALIZED = 0xdeadbeef;

export class Reader {
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

  wait(name) {
    if (this.useAtomics) {
      this.log(`waiting for ${name}`);
      // Switch to writable
      // Atomics.store(this.atomicView, 0, 1);

      // Wait on readable
      Atomics.wait(this.atomicView, 0, 1);
      this.log(`resumed for ${name}`);
    }
  }

  notify() {
    if (this.stream) {
      if (this.useAtomics) {
        // Switch to writable
        this.log('switching to writable');
        Atomics.store(this.atomicView, 0, 1);
        Atomics.notify(this.atomicView, 0);
      } else {
        this.atomicView[0] = 1;
      }
      this.offset = 4;
    }
  }

  done() {
    this.log('checking done');
    this.wait('done');
    let dataView = new DataView(this.buffer, this.offset);
    let done = dataView.getUint32(0) === FINALIZED;

    if (done) {
      this.notify();
    }

    return done;
  }

  string() {
    this.wait('string');

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
    this.notify();
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
    this.wait('int32');
    let num = this._int32();
    this.log('int32', num);
    this.notify();
    return num;
  }

  bytes() {
    this.wait('bytes');

    let byteLength = this._int32();

    let bytes = new ArrayBuffer(byteLength);
    new Uint8Array(bytes).set(
      new Uint8Array(this.buffer, this.offset, byteLength)
    );
    this.log('bytes', bytes);

    this.offset += byteLength;
    this.notify();
    return bytes;
  }
}

export class Writer {
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
      Atomics.store(this.atomicView, 0, 1);
    } else {
      this.atomicView[0] = 1;
    }
  }

  log(...args) {
    if (this.debug) {
      console.log(`[writer: ${this.name}]`, ...args);
    }
  }

  wait() {
    if (this.useAtomics) {
      // Wait to be writable again
      this.log('waiting');
      if (Atomics.wait(this.atomicView, 0, 0, 100) === 'timed-out') {
        throw new Error(
          `[writer: ${this.name}] Writer cannot write: timed out`
        );
      }
      this.log('resumed');
    }
  }

  notify() {
    if (this.stream) {
      if (this.useAtomics) {
        // Flush it out. Switch to readable
        Atomics.store(this.atomicView, 0, 0);
        Atomics.notify(this.atomicView, 0);
        this.log('switching to readable');
      } else {
        this.atomicView[0] = 0;
      }
      this.offset = 4;
    }
  }

  finalize() {
    this.log('finalizing');
    this.wait();
    let dataView = new DataView(this.buffer, this.offset);
    dataView.setUint32(0, FINALIZED);
    this.notify();
  }

  string(str) {
    this.wait();
    this.log('string', str);

    let byteLength = str.length * 2;
    this._int32(byteLength);

    let dataView = new DataView(this.buffer, this.offset, byteLength);
    for (let i = 0; i < str.length; i++) {
      dataView.setUint16(i * 2, str.charCodeAt(i));
    }

    this.offset += byteLength;
    this.notify();
  }

  _int32(num) {
    let byteLength = 4;

    let dataView = new DataView(this.buffer, this.offset);
    dataView.setInt32(0, num);

    this.offset += byteLength;
  }

  int32(num) {
    this.wait();
    this.log('int32', num);
    this._int32(num);
    this.notify();
  }

  bytes(buffer) {
    this.wait();
    this.log('bytes', buffer);

    let byteLength = buffer.byteLength;
    this._int32(byteLength);
    new Uint8Array(this.buffer, this.offset).set(new Uint8Array(buffer));

    this.offset += byteLength;
    this.notify();
  }
}
