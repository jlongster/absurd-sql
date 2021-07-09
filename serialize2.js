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

    this.timings = [];
    this.stack = [];
  }

  log(...args) {
    if (this.debug) {
      console.log(`[reader: ${this.name}]`, ...args);
    }
  }

  wait(name, timeout) {
    if (this.useAtomics) {
      this.log(`waiting for ${name}`);
      // Switch to writable
      // Atomics.store(this.atomicView, 0, 1);

      // Wait on readable
      Atomics.wait(this.atomicView, 0, 1)
      //   throw new Error('fucker timed out');
      // }
      // this.timings.push({
      //   n: 'wake',
      //   t: performance.timeOrigin + performance.now()
      // });

      this.log(`resumed for ${name}`);

      this.stack.push(name);
    }
  }

  notify() {
    if (this.stream) {
      if (this.useAtomics) {
        // Switch to writable
        this.log('switching to writable');

        for (let i = 0; i < 1000; i++) {
          this.atomicView[i] = -1234;
        }

        if (this.atomicView[0] === 1) {
          throw new Error('NOOOOO');
        }

        // this.timings.push({
        //   n: 'notify',
        //   t: performance.timeOrigin + performance.now()
        // });
        Atomics.store(this.atomicView, 0, 1);
        Atomics.notify(this.atomicView, 0);

        this.wait();
      } else {
        this.atomicView[0] = 1;
      }
      this.offset = 4;
    }
  }

  done() {
    this.log('checking done');
    // this.wait('done');
    let dataView = new DataView(this.buffer, this.offset);
    let done = dataView.getUint32(0) === FINALIZED;

    if (done) {
      this.prevStack = this.stack;
      this.stack = [];
      this.notify();
    }

    return done;
  }

  string(timeout) {
    // this.wait('string', timeout);

    let byteLength = this._int32();

    if (byteLength === -1234) {
      throw new Error('WAT');
    }

    let length = byteLength / 2;

    // console.log('bl', byteLength, length)
    let str;
    try {
      let dataView = new DataView(this.buffer, this.offset, byteLength);
      let chars = [];
      for (let i = 0; i < length; i++) {
        chars.push(dataView.getUint16(i * 2));
      }
      str = String.fromCharCode.apply(null, chars);
      this.log('string', str);
    } catch (e) {
      console.log(this.name, byteLength, length, this.stack, this.prevStack);
      throw e;
    }

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
    // this.wait('int32');
    let num = this._int32();
    this.log('int32', num);
    this.notify();
    return num;
  }

  bytes() {
    // this.wait('bytes');

    let byteLength = this._int32();

    let bytes;
    try {
      bytes = new ArrayBuffer(byteLength);
      new Uint8Array(bytes).set(
        new Uint8Array(this.buffer, this.offset, byteLength)
      );
      this.log('bytes', bytes);
    } catch (e) {
      console.log(this.name, byteLength, this.stack, this.prevStack);
      throw e;
    }

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

    this.timings = [];

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
      if (Atomics.wait(this.atomicView, 0, 0, 1000) === 'timed-out') {
        throw new Error(
          `[writer: ${this.name}] Writer cannot write: timed out`
        );
      }
      // this.timings.push({
      //   n: 'wake',
      //   t: performance.timeOrigin + performance.now()
      // });
      this.log('resumed');
    }
  }

  notify() {
    if (this.stream) {
      if (this.useAtomics) {
        if (this.atomicView[0] === 0) {
          throw new Error('WWWAT');
        }

        // Flush it out. Switch to readable
        console.log('notify');
        // this.timings.push({
        //   n: 'notify',
        //   t: performance.timeOrigin + performance.now()
        // });
        Atomics.store(this.atomicView, 0, 0);
        Atomics.notify(this.atomicView, 0);
        this.log('switching to readable');

        this.wait();
      } else {
        this.atomicView[0] = 0;
      }
      this.offset = 4;
    }
  }

  finalize() {
    this.log('finalizing');
    // this.wait();
    let dataView = new DataView(this.buffer, this.offset);
    dataView.setUint32(0, FINALIZED);
    this.notify();
  }

  string(str) {
    // this.wait();
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
    // this.wait();
    this.log('int32', num);
    this._int32(num);
    this.notify();
  }

  bytes(buffer) {
    // this.wait();
    this.log('bytes', buffer);

    let byteLength = buffer.byteLength;
    this._int32(byteLength);
    new Uint8Array(this.buffer, this.offset).set(new Uint8Array(buffer));

    this.offset += byteLength;
    this.notify();
  }
}
