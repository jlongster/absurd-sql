let FINALIZED = 0xdeadbeef;

export class Reader {
  constructor(
    view,
    { initialOffset = 4, useAtomics = true, stream = true } = {}
  ) {
    this.view = view;
    this.atomicView = new Int32Array(view.buffer);
    this.offset = initialOffset;
    this.useAtomics = useAtomics;
    this.stream = stream;
  }

  wait() {
    if (this.useAtomics) {
      // Switch to writable
      Atomics.store(this.atomicView, 0, 1);

      // Wait on readable
      Atomics.wait(this.atomicView, 0, 0);
    }
  }

  notify() {
    if (this.stream) {
      if (this.useAtomics) {
        // Switch to writable
        Atomics.store(this.atomicView, 0, 1);
        Atomics.notify(this.atomicView, 0);
      } else {
        this.atomicView[0] = 1;
      }
      this.offset = 4;
    }
  }

  done() {
    this.wait();
    let dataView = new DataView(this.view.buffer, this.offset);
    return dataView.getUint32(0) === FINALIZED;
  }

  string() {
    let view = this.view;
    let byteLength = this._int32();
    let length = byteLength / 2;
    this.wait();

    // let view16 = new Uint16Array(view.buffer, 4, length);
    // let str = String.fromCharCode.apply(null, view16);

    let view16 = new DataView(view.buffer, this.offset, byteLength);
    let chars = [];
    for (let i = 0; i < length; i++) {
      chars.push(view16.getUint16(i * 2));
    }
    let str = String.fromCharCode.apply(null, chars);

    this.offset += byteLength;
    this.notify();
    return str;
  }

  _int32() {
    let view = this.view;
    let byteLength = 4;

    let dataView = new DataView(view.buffer, this.offset);
    let num = dataView.getInt32();

    this.offset += byteLength;
    return num;
  }

  int32() {
    this.wait();
    let num = this._int32();
    this.notify();
    return num;
  }

  bytes() {
    this.wait();

    let view = this.view;
    let byteLength = this._int32();

    let bytes = new ArrayBuffer(byteLength);
    new Uint8Array(bytes).set(
      new Uint8Array(view.buffer, this.offset, byteLength)
    );

    this.offset += byteLength;
    this.notify();
    return bytes;
  }
}

export class Writer {
  constructor(
    view,
    { initialOffset = 4, useAtomics = true, stream = true } = {}
  ) {
    // Assert view is Int32Array

    this.view = view;
    this.atomicView = new Int32Array(view.buffer);
    this.offset = initialOffset;
    this.useAtomics = useAtomics;
    this.stream = stream;

    if (this.useAtomics) {
      // The buffer starts out as writeable
      Atomics.store(this.atomicView, 0, 1);
    } else {
      this.atomicView[0] = 1;
    }
  }

  wait() {
    if (this.useAtomics) {
      // Wait to be writable again
      if (Atomics.wait(this.atomicView, 1, 1, 100) === 'timed-out') {
        throw new Error('Writer cannot write: timed out');
      }
    }
  }

  notify() {
    if (this.stream) {
      if (this.useAtomics) {
        // Flush it out. Switch to readable
        Atomics.store(this.atomicView, 0, 0);
        Atomics.notify(this.atomicView, 0);
      } else {
        this.atomicView[0] = 0;
      }
      this.offset = 4;
    }
  }

  finalize() {
    this.wait();
    let dataView = new DataView(this.view.buffer, this.offset);
    dataView.setUint32(0, FINALIZED);
    this.notify();
  }

  string(str) {
    let view = this.view;
    let byteLength = str.length * 2;
    this.wait();

    this._int32(byteLength);

    // Offset of 4 for int32 length ^
    let view16 = new DataView(view.buffer, this.offset, byteLength);
    for (let i = 0; i < str.length; i++) {
      view16.setUint16(i * 2, str.charCodeAt(i));
    }

    this.offset += byteLength;
    this.notify();
  }

  _int32(num) {
    let view = this.view;
    let byteLength = 4;

    let view32 = new DataView(view.buffer, this.offset);
    view32.setInt32(0, num);

    this.offset += byteLength;
  }

  int32(num) {
    this.wait();
    this._int32(num);
    this.notify();
  }

  bytes(buffer) {
    let view = this.view;
    let byteLength = buffer.byteLength;
    this.wait();

    this._int32(byteLength);
    view.set(new Uint8Array(buffer), this.offset);

    this.offset += byteLength;
    this.notify();
  }
}

function serializeReads() {}

function deserializeReads() {}

export function serializeWrites(name, writes, sab) {
  let writer = new Writer(new Uint8Array(sab), 1);

  writer.string(name);
  for (let write of writes) {
    writer.int32(write.pos);
    writer.bytes(write.data);
  }
  writer.finalize();
}

function deserializeWrites(sab) {
  let reader = new Reader(new Uint8Array(sab), 1);

  let name = reader.string(name);
  let writes = [];
  while (!reader.done()) {
    writes.push({
      pos: reader.int32(),
      data: reader.data()
    });
  }
  return { name, writes };
}

function serializeWriteMeta() {}

function deserializeWriteMeta() {}

function serializeName() {}
function deserializeName() {}
