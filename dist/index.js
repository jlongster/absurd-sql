const ERRNO_CODES = {
  EPERM: 63,
  ENOENT: 44,
  ESRCH: 71,
  EINTR: 27,
  EIO: 29,
  ENXIO: 60,
  E2BIG: 1,
  ENOEXEC: 45,
  EBADF: 8,
  ECHILD: 12,
  EAGAIN: 6,
  EWOULDBLOCK: 6,
  ENOMEM: 48,
  EACCES: 2,
  EFAULT: 21,
  ENOTBLK: 105,
  EBUSY: 10,
  EEXIST: 20,
  EXDEV: 75,
  ENODEV: 43,
  ENOTDIR: 54,
  EISDIR: 31,
  EINVAL: 28,
  ENFILE: 41,
  EMFILE: 33,
  ENOTTY: 59,
  ETXTBSY: 74,
  EFBIG: 22,
  ENOSPC: 51,
  ESPIPE: 70,
  EROFS: 69,
  EMLINK: 34,
  EPIPE: 64,
  EDOM: 18,
  ERANGE: 68,
  ENOMSG: 49,
  EIDRM: 24,
  ECHRNG: 106,
  EL2NSYNC: 156,
  EL3HLT: 107,
  EL3RST: 108,
  ELNRNG: 109,
  EUNATCH: 110,
  ENOCSI: 111,
  EL2HLT: 112,
  EDEADLK: 16,
  ENOLCK: 46,
  EBADE: 113,
  EBADR: 114,
  EXFULL: 115,
  ENOANO: 104,
  EBADRQC: 103,
  EBADSLT: 102,
  EDEADLOCK: 16,
  EBFONT: 101,
  ENOSTR: 100,
  ENODATA: 116,
  ETIME: 117,
  ENOSR: 118,
  ENONET: 119,
  ENOPKG: 120,
  EREMOTE: 121,
  ENOLINK: 47,
  EADV: 122,
  ESRMNT: 123,
  ECOMM: 124,
  EPROTO: 65,
  EMULTIHOP: 36,
  EDOTDOT: 125,
  EBADMSG: 9,
  ENOTUNIQ: 126,
  EBADFD: 127,
  EREMCHG: 128,
  ELIBACC: 129,
  ELIBBAD: 130,
  ELIBSCN: 131,
  ELIBMAX: 132,
  ELIBEXEC: 133,
  ENOSYS: 52,
  ENOTEMPTY: 55,
  ENAMETOOLONG: 37,
  ELOOP: 32,
  EOPNOTSUPP: 138,
  EPFNOSUPPORT: 139,
  ECONNRESET: 15,
  ENOBUFS: 42,
  EAFNOSUPPORT: 5,
  EPROTOTYPE: 67,
  ENOTSOCK: 57,
  ENOPROTOOPT: 50,
  ESHUTDOWN: 140,
  ECONNREFUSED: 14,
  EADDRINUSE: 3,
  ECONNABORTED: 13,
  ENETUNREACH: 40,
  ENETDOWN: 38,
  ETIMEDOUT: 73,
  EHOSTDOWN: 142,
  EHOSTUNREACH: 23,
  EINPROGRESS: 26,
  EALREADY: 7,
  EDESTADDRREQ: 17,
  EMSGSIZE: 35,
  EPROTONOSUPPORT: 66,
  ESOCKTNOSUPPORT: 137,
  EADDRNOTAVAIL: 4,
  ENETRESET: 39,
  EISCONN: 30,
  ENOTCONN: 53,
  ETOOMANYREFS: 141,
  EUSERS: 136,
  EDQUOT: 19,
  ESTALE: 72,
  ENOTSUP: 138,
  ENOMEDIUM: 148,
  EILSEQ: 25,
  EOVERFLOW: 61,
  ECANCELED: 11,
  ENOTRECOVERABLE: 56,
  EOWNERDEAD: 62,
  ESTRPIPE: 135
};

class BlockedFS {
  constructor(FS, backend) {
    this.FS = FS;
    this.backend = backend;

    this.node_ops = {
      getattr: node => {
        let fileattr = FS.isFile(node.mode) ? node.contents.getattr() : null;

        let attr = {};
        attr.dev = 1;
        attr.ino = node.id;
        attr.mode = fileattr ? fileattr.mode : node.mode;
        attr.nlink = 1;
        attr.uid = 0;
        attr.gid = 0;
        attr.rdev = node.rdev;
        attr.size = fileattr ? fileattr.size : FS.isDir(node.mode) ? 4096 : 0;
        attr.atime = new Date(0);
        attr.mtime = new Date(0);
        attr.ctime = new Date(0);
        attr.blksize = fileattr ? fileattr.blockSize : 4096;
        attr.blocks = Math.ceil(attr.size / attr.blksize);
        return attr;
      },
      setattr: (node, attr) => {
        if (FS.isFile(node)) {
          node.contents.setattr(attr);
        } else {
          if (attr.mode != null) {
            node.mode = attr.mode;
          }
          if (attr.size != null) {
            node.size = attr.size;
          }
        }
      },
      lookup: (parent, name) => {
        throw new this.FS.ErrnoError(ERRNO_CODES.ENOENT);
      },
      mknod: (parent, name, mode, dev) => {
        if (name.endsWith('.lock')) {
          let file = this.FS.lookupNode(parent, name.replace(/\.lock$/, ''));

          if (!file.contents.lock()) {
            // File exists (can't lock)
            throw new this.FS.ErrnoError(20);
          }
        }

        return this.createNode(parent, name, mode, dev);
      },
      rename: (old_node, new_dir, new_name) => {
        throw new Error('rename not implemented');
      },
      unlink: (parent, name) => {
        let node = this.FS.lookupNode(parent, name);
        node.contents.delete(name);
      },
      rmdir: (parent, name) => {
        if (name.endsWith('.lock')) {
          let file = this.FS.lookupNode(parent, name.replace(/\.lock$/, ''));
          file.contents.unlock();
        }
      },
      readdir: node => {
        // We could list all the available databases here if `node` is
        // the root directory. However Firefox does not implemented
        // such a methods. Other browsers do, but since it's not
        // supported on all browsers users will need to track it
        // separate anyway right now

        throw new Error('readdir not implemented');
      },
      symlink: (parent, newname, oldpath) => {
        throw new Error('symlink not implemented');
      },
      readlink: node => {
        throw new Error('symlink not implemented');
      }
    };

    this.stream_ops = {
      open: stream => {
        if (this.FS.isFile(stream.node.mode)) {
          stream.node.contents.open();
        }
      },

      close: stream => {
        if (this.FS.isFile(stream.node.mode)) {
          stream.node.contents.close();
        }
      },

      read: (stream, buffer, offset, length, position) => {
        // console.log('read', offset, length, position);
        return stream.node.contents.read(buffer, offset, length, position);
      },

      write: (stream, buffer, offset, length, position) => {
        // console.log('write', offset, length, position);
        return stream.node.contents.write(buffer, offset, length, position);
      },

      llseek: (stream, offset, whence) => {
        // Copied from MEMFS
        var position = offset;
        if (whence === 1) {
          position += stream.position;
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            position += stream.node.contents.getattr().size;
          }
        }
        if (position < 0) {
          throw new this.FS.ErrnoError(28);
        }
        return position;
      },
      allocate: (stream, offset, length) => {
        stream.node.contents.setattr({ size: offset + length });
      },
      mmap: (stream, address, length, position, prot, flags) => {
        throw new Error('mmap not implemented');
      },
      msync: (stream, buffer, offset, length, mmapFlags) => {
        throw new Error('msync not implemented');
      },
      fsync: (stream, buffer, offset, length, mmapFlags) => {
        stream.node.contents.fsync();
      }
    };
  }

  async init() {
    await this.backend.init();
  }

  mount() {
    return this.createNode(null, '/', 16384 /* dir */ | 511 /* 0777 */, 0);
  }

  // TODO: implement lookup for existing files (maybe)

  createNode(parent, name, mode, dev) {
    // Only files and directories supported
    if (!(this.FS.isDir(mode) || this.FS.isFile(mode))) {
      throw new this.FS.ErrnoError(ERRNO_CODES.EPERM);
    }

    var node = this.FS.createNode(parent, name, mode, dev);
    if (this.FS.isDir(node.mode)) {
      node.node_ops = {
        mknod: this.node_ops.mknod,
        lookup: this.node_ops.lookup,
        unlink: this.node_ops.unlink,
        setattr: this.node_ops.setattr,
        rmdir: this.node_ops.rmdir
      };
      node.stream_ops = {};
      node.contents = {};
    } else if (this.FS.isFile(node.mode)) {
      node.node_ops = this.node_ops;
      node.stream_ops = this.stream_ops;

      // Create file!
      node.contents = this.backend.createFile(name);
    }

    // add the new node to the parent
    if (parent) {
      parent.contents[name] = node;
      parent.timestamp = node.timestamp;
    }

    return node;
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
    // TODO: All these worker functions need to handle errors better
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

  lock() {
    return this.ops.lock();
  }

  unlock() {
    return this.ops.unlock();
  }

  fsync() {
    // TODO: both of these writes should happen in a transaction

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

  // repartition(blockSize) {
  //   // Load it all into memory
  //   let buffer = this.readAll();

  //   this.blockSize = blockSize;
  //   this.write(allData, 0, allData.byteLength, 0);
  //   this._metaDirty = true;

  //   this.fsync();
  // }
}

class FileOps$1 {
  constructor(filename, meta = null, data) {
    this.filename = filename;
    this.locked = false;
    this.meta = meta;
    this.data = data || new ArrayBuffer(0);
  }

  lock() {
    if (this.locked) {
      return false;
    }
    this.locked = true;
    return true;
  }

  unlock() {
    this.locked = false;
  }

  delete() {
    // in-memory noop
  }

  readMeta() {
    return this.meta;
  }

  writeMeta(meta) {
    if (this.meta == null) {
      this.meta = {};
    }
    this.meta.size = meta.size;
    this.meta.blockSize = meta.blockSize;
  }

  readBlocks(positions, blockSize) {
    // console.log('_reading', this.filename, positions);
    let data = this.data;

    return positions.map(pos => {
      let buffer = new ArrayBuffer(blockSize);

      if (pos < data.byteLength) {
        new Uint8Array(buffer).set(
          new Uint8Array(data, pos, Math.min(blockSize, data.byteLength - pos))
        );
      }

      return { pos, data: buffer };
    });
  }

  writeBlocks(writes, blockSize) {
    // console.log('_writing', this.filename, writes);
    let data = this.data;

    for (let write of writes) {
      let fullLength = write.pos + write.data.byteLength;

      if (fullLength > data.byteLength) {
        // Resize file
        let buffer = new ArrayBuffer(fullLength);
        new Uint8Array(buffer).set(new Uint8Array(data));
        this.data = data = buffer;
      }

      new Uint8Array(data).set(new Uint8Array(write.data), write.pos);
    }
  }
}

class MemoryBackend {
  constructor(defaultBlockSize, fileData) {
    this.fileData = Object.fromEntries(
      Object.entries(fileData).map(([name, data]) => {
        return [name, data];
      })
    );
    this.files = {};
    this.defaultBlockSize = defaultBlockSize;
  }

  async init() {}

  createFile(filename) {
    if (this.files[filename] == null) {
      let data = this.fileData[filename];

      this.files[filename] = new File(
        filename,
        this.defaultBlockSize,
        new FileOps$1(
          filename,
          data
            ? {
                size: data.byteLength,
                blockSize: this.defaultBlockSize
              }
            : null
        )
      );
    }
    return this.files[filename];
  }

  getFile(filename) {
    return this.files[filename];
  }
}

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

var WorkerFactory = createBase64WorkerFactory('Lyogcm9sbHVwLXBsdWdpbi13ZWItd29ya2VyLWxvYWRlciAqLwooZnVuY3Rpb24gKCkgewogICd1c2Ugc3RyaWN0JzsKCiAgbGV0IEZJTkFMSVpFRCA9IDB4ZGVhZGJlZWY7CgogIGxldCBXUklURUFCTEUgPSAwOwogIGxldCBSRUFEQUJMRSA9IDE7CgogIGNsYXNzIFJlYWRlciB7CiAgICBjb25zdHJ1Y3RvcigKICAgICAgYnVmZmVyLAogICAgICB7IGluaXRpYWxPZmZzZXQgPSA0LCB1c2VBdG9taWNzID0gdHJ1ZSwgc3RyZWFtID0gdHJ1ZSwgZGVidWcsIG5hbWUgfSA9IHt9CiAgICApIHsKICAgICAgdGhpcy5idWZmZXIgPSBidWZmZXI7CiAgICAgIHRoaXMuYXRvbWljVmlldyA9IG5ldyBJbnQzMkFycmF5KGJ1ZmZlcik7CiAgICAgIHRoaXMub2Zmc2V0ID0gaW5pdGlhbE9mZnNldDsKICAgICAgdGhpcy51c2VBdG9taWNzID0gdXNlQXRvbWljczsKICAgICAgdGhpcy5zdHJlYW0gPSBzdHJlYW07CiAgICAgIHRoaXMuZGVidWcgPSBkZWJ1ZzsKICAgICAgdGhpcy5uYW1lID0gbmFtZTsKICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbcmVhZGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0V3JpdGUobmFtZSkgewogICAgICBpZiAodGhpcy51c2VBdG9taWNzKSB7CiAgICAgICAgdGhpcy5sb2coYHdhaXRpbmcgZm9yICR7bmFtZX1gKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBXUklURUFCTEUpIHsKICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCd3YWl0aW5nIGZvciB3cml0ZS4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFLCA1MDApOwogICAgICAgIH0KCiAgICAgICAgdGhpcy5sb2coYHJlc3VtZWQgZm9yICR7bmFtZX1gKTsKICAgICAgfSBlbHNlIHsKICAgICAgICBpZiAodGhpcy5hdG9taWNWaWV3WzBdICE9PSBSRUFEQUJMRSkgewogICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdgd2FpdFdyaXRlYCBleHBlY3RlZCBhcnJheSB0byBiZSByZWFkYWJsZScpOwogICAgICAgIH0KICAgICAgfQogICAgfQoKICAgIGZsaXAoKSB7CiAgICAgIHRoaXMubG9nKCdmbGlwJyk7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICBsZXQgcHJldiA9IEF0b21pY3MuY29tcGFyZUV4Y2hhbmdlKAogICAgICAgICAgdGhpcy5hdG9taWNWaWV3LAogICAgICAgICAgMCwKICAgICAgICAgIFJFQURBQkxFLAogICAgICAgICAgV1JJVEVBQkxFCiAgICAgICAgKTsKCiAgICAgICAgaWYgKHByZXYgIT09IFJFQURBQkxFKSB7CiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlYWQgZGF0YSBvdXQgb2Ygc3luYyEgVGhpcyBpcyBkaXNhc3Ryb3VzJyk7CiAgICAgICAgfQoKICAgICAgICBBdG9taWNzLm5vdGlmeSh0aGlzLmF0b21pY1ZpZXcsIDApOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IFdSSVRFQUJMRTsKICAgICAgfQoKICAgICAgdGhpcy5vZmZzZXQgPSA0OwogICAgfQoKICAgIGRvbmUoKSB7CiAgICAgIHRoaXMud2FpdFdyaXRlKCdkb25lJyk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgbGV0IGRvbmUgPSBkYXRhVmlldy5nZXRVaW50MzIoMCkgPT09IEZJTkFMSVpFRDsKCiAgICAgIGlmIChkb25lKSB7CiAgICAgICAgdGhpcy5sb2coJ2RvbmUnKTsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQoKICAgICAgcmV0dXJuIGRvbmU7CiAgICB9CgogICAgcGVlayhmbikgewogICAgICB0aGlzLnBlZWtPZmZzZXQgPSB0aGlzLm9mZnNldDsKICAgICAgbGV0IHJlcyA9IGZuKCk7CiAgICAgIHRoaXMub2Zmc2V0ID0gdGhpcy5wZWVrT2Zmc2V0OwogICAgICB0aGlzLnBlZWtPZmZzZXQgPSBudWxsOwogICAgICByZXR1cm4gcmVzOwogICAgfQoKICAgIHN0cmluZygpIHsKICAgICAgdGhpcy53YWl0V3JpdGUoJ3N0cmluZycpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSB0aGlzLl9pbnQzMigpOwogICAgICBsZXQgbGVuZ3RoID0gYnl0ZUxlbmd0aCAvIDI7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0LCBieXRlTGVuZ3RoKTsKICAgICAgbGV0IGNoYXJzID0gW107CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHsKICAgICAgICBjaGFycy5wdXNoKGRhdGFWaWV3LmdldFVpbnQxNihpICogMikpOwogICAgICB9CiAgICAgIGxldCBzdHIgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIGNoYXJzKTsKICAgICAgdGhpcy5sb2coJ3N0cmluZycsIHN0cik7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwoKICAgICAgaWYgKHRoaXMucGVla09mZnNldCA9PSBudWxsKSB7CiAgICAgICAgdGhpcy5mbGlwKCk7CiAgICAgIH0KICAgICAgcmV0dXJuIHN0cjsKICAgIH0KCiAgICBfaW50MzIoKSB7CiAgICAgIGxldCBieXRlTGVuZ3RoID0gNDsKCiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBsZXQgbnVtID0gZGF0YVZpZXcuZ2V0SW50MzIoKTsKICAgICAgdGhpcy5sb2coJ19pbnQzMicsIG51bSk7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGludDMyKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgnaW50MzInKTsKICAgICAgbGV0IG51bSA9IHRoaXMuX2ludDMyKCk7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CgogICAgICBpZiAodGhpcy5wZWVrT2Zmc2V0ID09IG51bGwpIHsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGJ5dGVzKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgnYnl0ZXMnKTsKCiAgICAgIGxldCBieXRlTGVuZ3RoID0gdGhpcy5faW50MzIoKTsKCiAgICAgIGxldCBieXRlcyA9IG5ldyBBcnJheUJ1ZmZlcihieXRlTGVuZ3RoKTsKICAgICAgbmV3IFVpbnQ4QXJyYXkoYnl0ZXMpLnNldCgKICAgICAgICBuZXcgVWludDhBcnJheSh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQsIGJ5dGVMZW5ndGgpCiAgICAgICk7CiAgICAgIHRoaXMubG9nKCdieXRlcycsIGJ5dGVzKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CgogICAgICBpZiAodGhpcy5wZWVrT2Zmc2V0ID09IG51bGwpIHsKICAgICAgICB0aGlzLmZsaXAoKTsKICAgICAgfQogICAgICByZXR1cm4gYnl0ZXM7CiAgICB9CiAgfQoKICBjbGFzcyBXcml0ZXIgewogICAgY29uc3RydWN0b3IoCiAgICAgIGJ1ZmZlciwKICAgICAgeyBpbml0aWFsT2Zmc2V0ID0gNCwgdXNlQXRvbWljcyA9IHRydWUsIHN0cmVhbSA9IHRydWUsIGRlYnVnLCBuYW1lIH0gPSB7fQogICAgKSB7CiAgICAgIHRoaXMuYnVmZmVyID0gYnVmZmVyOwogICAgICB0aGlzLmF0b21pY1ZpZXcgPSBuZXcgSW50MzJBcnJheShidWZmZXIpOwogICAgICB0aGlzLm9mZnNldCA9IGluaXRpYWxPZmZzZXQ7CiAgICAgIHRoaXMudXNlQXRvbWljcyA9IHVzZUF0b21pY3M7CiAgICAgIHRoaXMuc3RyZWFtID0gc3RyZWFtOwoKICAgICAgdGhpcy5kZWJ1ZyA9IGRlYnVnOwogICAgICB0aGlzLm5hbWUgPSBuYW1lOwoKICAgICAgaWYgKHRoaXMudXNlQXRvbWljcykgewogICAgICAgIC8vIFRoZSBidWZmZXIgc3RhcnRzIG91dCBhcyB3cml0ZWFibGUKICAgICAgICBBdG9taWNzLnN0b3JlKHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFKTsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aGlzLmF0b21pY1ZpZXdbMF0gPSBXUklURUFCTEU7CiAgICAgIH0KICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbd3JpdGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0UmVhZChuYW1lKSB7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICB0aGlzLmxvZyhgd2FpdGluZyBmb3IgJHtuYW1lfWApOwogICAgICAgIC8vIFN3aXRjaCB0byB3cml0YWJsZQogICAgICAgIC8vIEF0b21pY3Muc3RvcmUodGhpcy5hdG9taWNWaWV3LCAwLCAxKTsKCiAgICAgICAgbGV0IHByZXYgPSBBdG9taWNzLmNvbXBhcmVFeGNoYW5nZSgKICAgICAgICAgIHRoaXMuYXRvbWljVmlldywKICAgICAgICAgIDAsCiAgICAgICAgICBXUklURUFCTEUsCiAgICAgICAgICBSRUFEQUJMRQogICAgICAgICk7CgogICAgICAgIGlmIChwcmV2ICE9PSBXUklURUFCTEUpIHsKICAgICAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAgICAgJ1dyb3RlIHNvbWV0aGluZyBpbnRvIHVud3JpdGFibGUgYnVmZmVyISBUaGlzIGlzIGRpc2FzdHJvdXMnCiAgICAgICAgICApOwogICAgICAgIH0KCiAgICAgICAgQXRvbWljcy5ub3RpZnkodGhpcy5hdG9taWNWaWV3LCAwKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBSRUFEQUJMRSkgewogICAgICAgICAgLy8gY29uc29sZS5sb2coJ3dhaXRpbmcgdG8gYmUgcmVhZC4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgUkVBREFCTEUsIDUwMCk7CiAgICAgICAgfQoKICAgICAgICB0aGlzLmxvZyhgcmVzdW1lZCBmb3IgJHtuYW1lfWApOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IFJFQURBQkxFOwogICAgICB9CgogICAgICB0aGlzLm9mZnNldCA9IDQ7CiAgICB9CgogICAgZmluYWxpemUoKSB7CiAgICAgIHRoaXMubG9nKCdmaW5hbGl6aW5nJyk7CiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBkYXRhVmlldy5zZXRVaW50MzIoMCwgRklOQUxJWkVEKTsKICAgICAgdGhpcy53YWl0UmVhZCgnZmluYWxpemUnKTsKICAgIH0KCiAgICBzdHJpbmcoc3RyKSB7CiAgICAgIHRoaXMubG9nKCdzdHJpbmcnLCBzdHIpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSBzdHIubGVuZ3RoICogMjsKICAgICAgdGhpcy5faW50MzIoYnl0ZUxlbmd0aCk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0LCBieXRlTGVuZ3RoKTsKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHsKICAgICAgICBkYXRhVmlldy5zZXRVaW50MTYoaSAqIDIsIHN0ci5jaGFyQ29kZUF0KGkpKTsKICAgICAgfQoKICAgICAgdGhpcy5vZmZzZXQgKz0gYnl0ZUxlbmd0aDsKICAgICAgdGhpcy53YWl0UmVhZCgnc3RyaW5nJyk7CiAgICB9CgogICAgX2ludDMyKG51bSkgewogICAgICBsZXQgYnl0ZUxlbmd0aCA9IDQ7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgZGF0YVZpZXcuc2V0SW50MzIoMCwgbnVtKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CiAgICB9CgogICAgaW50MzIobnVtKSB7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CiAgICAgIHRoaXMuX2ludDMyKG51bSk7CiAgICAgIHRoaXMud2FpdFJlYWQoJ2ludDMyJyk7CiAgICB9CgogICAgYnl0ZXMoYnVmZmVyKSB7CiAgICAgIHRoaXMubG9nKCdieXRlcycsIGJ1ZmZlcik7CgogICAgICBsZXQgYnl0ZUxlbmd0aCA9IGJ1ZmZlci5ieXRlTGVuZ3RoOwogICAgICB0aGlzLl9pbnQzMihieXRlTGVuZ3RoKTsKICAgICAgbmV3IFVpbnQ4QXJyYXkodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KS5zZXQobmV3IFVpbnQ4QXJyYXkoYnVmZmVyKSk7CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICB0aGlzLndhaXRSZWFkKCdieXRlcycpOwogICAgfQogIH0KCiAgbGV0IGlkYiA9IGdsb2JhbFRoaXMuaW5kZXhlZERCOwoKICBsZXQgb3BlbkRicyA9IG5ldyBNYXAoKTsKCiAgYXN5bmMgZnVuY3Rpb24gbG9hZERiKG5hbWUpIHsKICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgIGlmIChvcGVuRGJzLmdldChuYW1lKSkgewogICAgICAgIHJlc29sdmUob3BlbkRicy5nZXQobmFtZSkpOwogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgbGV0IHJlcSA9IGlkYi5vcGVuKG5hbWUsIDEpOwogICAgICByZXEub25zdWNjZXNzID0gZXZlbnQgPT4gewogICAgICAgIGNvbnNvbGUubG9nKCdkYiBpcyBvcGVuIScsIG5hbWUpOwogICAgICAgIGxldCBkYiA9IGV2ZW50LnRhcmdldC5yZXN1bHQ7CgogICAgICAgIGRiLm9udmVyc2lvbmNoYW5nZSA9ICgpID0+IHsKICAgICAgICAgIC8vIFRPRE86IE5vdGlmeSB0aGUgdXNlciBzb21laG93CiAgICAgICAgICBjb25zb2xlLmxvZygnY2xvc2luZyBiZWNhdXNlIHZlcnNpb24gY2hhbmdlZCcpOwogICAgICAgICAgZGIuY2xvc2UoKTsKICAgICAgICB9OwoKICAgICAgICBkYi5vbmNsb3NlID0gKCkgPT4gewogICAgICAgICAgb3BlbkRicy5kZWxldGUobmFtZSk7CiAgICAgICAgfTsKCiAgICAgICAgb3BlbkRicy5zZXQobmFtZSwgZGIpOwogICAgICAgIHJlc29sdmUoZGIpOwogICAgICB9OwogICAgICByZXEub251cGdyYWRlbmVlZGVkID0gZXZlbnQgPT4gewogICAgICAgIGxldCBkYiA9IGV2ZW50LnRhcmdldC5yZXN1bHQ7CiAgICAgICAgaWYgKCFkYi5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCdkYXRhJykpIHsKICAgICAgICAgIGRiLmNyZWF0ZU9iamVjdFN0b3JlKCdkYXRhJywgeyBrZXlQYXRoOiAna2V5JyB9KTsKICAgICAgICB9CiAgICAgIH07CiAgICAgIHJlcS5vbmJsb2NrZWQgPSBlID0+IGNvbnNvbGUubG9nKCdibG9ja2VkJywgZSk7CiAgICAgIHJlcS5vbmVycm9yID0gcmVxLm9uYWJvcnQgPSBlID0+IHJlamVjdChlLnRhcmdldC5lcnJvcik7CiAgICB9KTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGdldFN0b3JlKG5hbWUsIG1vZGUpIHsKICAgIGxldCBkYiA9IGF3YWl0IGxvYWREYihuYW1lKTsKICAgIGxldCB0cmFucyA9IGRiLnRyYW5zYWN0aW9uKFsnZGF0YSddLCBtb2RlIHx8ICdyZWFkd3JpdGUnKTsKICAgIHJldHVybiB7IHRyYW5zLCBzdG9yZTogdHJhbnMub2JqZWN0U3RvcmUoJ2RhdGEnKSB9OwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gZ2V0KHN0b3JlLCBrZXksIG1hcHBlciA9IHggPT4geCkgewogICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgbGV0IHJlcSA9IHN0b3JlLmdldChrZXkpOwogICAgICByZXEub25zdWNjZXNzID0gZSA9PiB7CiAgICAgICAgcmVzb2x2ZShtYXBwZXIocmVxLnJlc3VsdCkpOwogICAgICB9OwogICAgICByZXEub25lcnJvciA9IGUgPT4gcmVqZWN0KGUpOwogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBsb3dlckJvdW5kQ3Vyc29yKHN0b3JlLCBsb3dlckJvdW5kLCBjYikgewogICAgdmFyIGtleVJhbmdlID0gSURCS2V5UmFuZ2UubG93ZXJCb3VuZChsb3dlckJvdW5kKTsKCiAgICBsZXQgcmVxID0gc3RvcmUub3BlbkN1cnNvcihrZXlSYW5nZSk7CiAgICByZXEub25zdWNjZXNzID0gZSA9PiB7CiAgICAgIGNiKGUudGFyZ2V0LnJlc3VsdCk7CiAgICB9OwogIH0KCiAgY2xhc3MgQ3Vyc29yIHsKICAgIGNvbnN0cnVjdG9yKHN0YXJ0KSB7CiAgICAgIHRoaXMuX3VudGlsID0gbnVsbDsKICAgICAgdGhpcy5fcG9zID0gbnVsbDsKICAgIH0KCiAgICBydW4od3JpdGVyLCBzdG9yZSwgcG9zaXRpb24sIGNiKSB7CiAgICAgIGxvd2VyQm91bmRDdXJzb3Ioc3RvcmUsIHBvc2l0aW9uLCBjdXJzb3IgPT4gewogICAgICAgIHRoaXMuY3Vyc29yID0gY3Vyc29yOwogICAgICAgIGxldCBkYXRhID0gY3Vyc29yID8gY3Vyc29yLnZhbHVlIDogbnVsbDsKICAgICAgICB0aGlzLl9wb3MgPSBkYXRhID8gZGF0YS5rZXkgOiBudWxsOwoKICAgICAgICAvLyBpZiAoY3Vyc29yICYmIHRoaXMuX3VudGlsICYmIGRhdGEua2V5IDwgdGhpcy5fdW50aWwpIHsKICAgICAgICAvLyAgIGN1cnNvci5jb250aW51ZSgpOwogICAgICAgIC8vICAgcmV0dXJuOwogICAgICAgIC8vIH0gZWxzZSB7CiAgICAgICAgaWYgKGN1cnNvciA9PSBudWxsKSB7CiAgICAgICAgICB3cml0ZXIuYnl0ZXMobmV3IEFycmF5QnVmZmVyKDQwOTYgKiA0KSk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIHdyaXRlci5ieXRlcyhkYXRhLnZhbHVlKTsKICAgICAgICB9CiAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CgogICAgICAgIHRoaXMuX3VudGlsID0gbnVsbDsKICAgICAgICBjYihjdXJzb3IgPyB0aGlzIDogbnVsbCk7CiAgICAgICAgLy8gfQogICAgICB9KTsKICAgIH0KCiAgICB1bnRpbChrZXkpIHsKICAgICAgLy8gVE9ETzogU2hvdWxkIHdlIHZhbGlkYXRlIHRoYXQgdGhlIGFkdmFuY2VkIHBvc2l0aW9uIG1hdGNoZXMgdGhlCiAgICAgIC8vIHBvc2l0aW9uIHdlIGFyZSBsb29raW5nIGZvcj8gSWYgbm90IHRoZSBkYiBpcyBjb3JydXB0IGJlY2F1c2UgaXQncwogICAgICAvLyBtaXNzaW5nIGEgYmxvY2suIEluIGZhY3Qgd2UgcHJvYmFibHkgd2lsbCBtb3ZlIHRvIG5vdCBzdG9yaW5nCiAgICAgIC8vIHRoZSBrZXlzIGluIHRoZSB2YWx1ZSBhbnl3YXksIHNvIHdlIHdvbid0IGhhdmUgdGhhdCBpbmZvLiBJZgogICAgICAvLyB0aGUgZGIgaXMgY29ycnVwdCB0aGVyZSdzIG5vdGhpbmcgd2UgY2FuIGRvLgoKICAgICAgdGhpcy5fdW50aWwgPSBrZXk7CiAgICAgIHRoaXMuY3Vyc29yLmFkdmFuY2Uoa2V5IC0gdGhpcy5fcG9zKTsKICAgIH0KICB9CgogIGFzeW5jIGZ1bmN0aW9uIHNldChzdG9yZSwgaXRlbSkgewogICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgbGV0IHJlcSA9IHN0b3JlLnB1dChpdGVtKTsKICAgICAgcmVxLm9uc3VjY2VzcyA9IGUgPT4gcmVzb2x2ZShyZXEucmVzdWx0KTsKICAgICAgcmVxLm9uZXJyb3IgPSBlID0+IHJlamVjdChlKTsKICAgIH0pOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gYnVsa1NldCh0cmFucywgc3RvcmUsIGl0ZW1zKSB7CiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgIGZvciAobGV0IGl0ZW0gb2YgaXRlbXMpIHsKICAgICAgICBzdG9yZS5wdXQoaXRlbSk7CiAgICAgIH0KCiAgICAgIHRyYW5zLm9uY29tcGxldGUgPSBlID0+IHJlc29sdmUoKTsKICAgICAgdHJhbnMub25lcnJvciA9IGUgPT4gcmVqZWN0KGUpOwogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVSZWFkKHdyaXRlciwgbmFtZSwgcG9zaXRpb24sIGNiKSB7CiAgICBsZXQgeyB0cmFucywgc3RvcmUgfSA9IGF3YWl0IGdldFN0b3JlKG5hbWUsICdyZWFkb25seScpOwoKICAgIC8vIGNvbnNvbGUubG9nKCdvcGVuaW5nIGN1cnNvcicpOwoKICAgIGxldCBjdXJzb3IgPSBuZXcgQ3Vyc29yKCk7CiAgICBjdXJzb3IucnVuKHdyaXRlciwgc3RvcmUsIHBvc2l0aW9uLCBjYik7CgogICAgLy8gbGV0IGRhdGEgPSBhd2FpdCBnZXQoc3RvcmUsIHBvc2l0aW9uLCBkYXRhID0+ICh7CiAgICAvLyAgIHBvczogcG9zaXRpb24sCiAgICAvLyAgIGRhdGE6IGRhdGEgPyBkYXRhLnZhbHVlIDogbmV3IEFycmF5QnVmZmVyKDQwOTYgKiA0KQogICAgLy8gfSkpOwoKICAgIC8vIGlmICh0cmFucy5jb21taXQpIHsKICAgIC8vICAgdHJhbnMuY29tbWl0KCk7CiAgICAvLyB9IGVsc2UgewogICAgLy8gICBhd2FpdCBvbmNvbXBsZXRlOwogICAgLy8gfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlV3JpdGVzKHdyaXRlciwgbmFtZSwgd3JpdGVzKSB7CiAgICBsZXQgeyB0cmFucywgc3RvcmUgfSA9IGF3YWl0IGdldFN0b3JlKG5hbWUpOwoKICAgIHRyeSB7CiAgICAgIGF3YWl0IGJ1bGtTZXQoCiAgICAgICAgdHJhbnMsCiAgICAgICAgc3RvcmUsCiAgICAgICAgd3JpdGVzLm1hcCh3ID0+ICh7IGtleTogdy5wb3MsIHZhbHVlOiB3LmRhdGEgfSkpCiAgICAgICk7CgogICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUubG9nKGVycik7CiAgICAgIHdyaXRlci5pbnQzMigtMSk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlUmVhZE1ldGEod3JpdGVyLCBuYW1lKSB7CiAgICBsZXQgeyB0cmFucywgc3RvcmUgfSA9IGF3YWl0IGdldFN0b3JlKG5hbWUpOwogICAgbGV0IG9uY29tcGxldGUgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+ICh0cmFucy5vbmNvbXBsZXRlID0gcmVzb2x2ZSkpOwoKICAgIHRyeSB7CiAgICAgIGNvbnNvbGUubG9nKCdnZXR0aW5nIG1ldGEnKTsKICAgICAgbGV0IHJlcyA9IGF3YWl0IGdldChzdG9yZSwgLTEpOwoKICAgICAgaWYgKHRyYW5zLmNvbW1pdCkgewogICAgICAgIHRyYW5zLmNvbW1pdCgpOwogICAgICB9IGVsc2UgewogICAgICAgIGF3YWl0IG9uY29tcGxldGU7CiAgICAgIH0KCiAgICAgIGNvbnNvbGUubG9nKCdnZXR0aW5nIG1ldGEgKGRvbmUpJyk7CiAgICAgIGxldCBtZXRhID0gcmVzICYmIHJlcy52YWx1ZTsKICAgICAgd3JpdGVyLmludDMyKG1ldGEgPyBtZXRhLnNpemUgOiAtMSk7CiAgICAgIHdyaXRlci5pbnQzMihtZXRhID8gbWV0YS5ibG9ja1NpemUgOiAtMSk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUubG9nKGVycik7CiAgICAgIHdyaXRlci5pbnQzMigtMSk7CiAgICAgIHdyaXRlci5pbnQzMigtMSk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlV3JpdGVNZXRhKHdyaXRlciwgbmFtZSwgbWV0YSkgewogICAgbGV0IHsgdHJhbnMsIHN0b3JlIH0gPSBhd2FpdCBnZXRTdG9yZShuYW1lKTsKICAgIGxldCBvbmNvbXBsZXRlID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiAodHJhbnMub25jb21wbGV0ZSA9IHJlc29sdmUpKTsKCiAgICB0cnkgewogICAgICBjb25zb2xlLmxvZygnc2V0dGluZyBtZXRhJywgbWV0YSk7CiAgICAgIGF3YWl0IHNldChzdG9yZSwgeyBrZXk6IC0xLCB2YWx1ZTogbWV0YSB9KTsKCiAgICAgIGlmICh0cmFucy5jb21taXQpIHsKICAgICAgICB0cmFucy5jb21taXQoKTsKICAgICAgfSBlbHNlIHsKICAgICAgICBhd2FpdCBvbmNvbXBsZXRlOwogICAgICB9CgogICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUubG9nKGVycik7CiAgICAgIHdyaXRlci5pbnQzMigtMSk7CiAgICAgIHdyaXRlci5maW5hbGl6ZSgpOwogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gaGFuZGxlRGVsZXRlRmlsZSh3cml0ZXIsIG5hbWUpIHsKICAgIC8vIGZpbGVDYWNoZVtuYW1lXSA9IG51bGw7CgogICAgd3JpdGVyLmludDMyKDApOwogICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpIHsKICAgIC8vIHJlYWRlci53YWl0KCdsb29wJywgMTAwMDApOwogICAgbGV0IG1ldGhvZCA9IHJlYWRlci5zdHJpbmcoKTsKCiAgICBzd2l0Y2ggKG1ldGhvZCkgewogICAgICBjYXNlICd3cml0ZUJsb2Nrcyc6IHsKICAgICAgICBsZXQgbmFtZSA9IHJlYWRlci5zdHJpbmcoKTsKICAgICAgICBsZXQgd3JpdGVzID0gW107CiAgICAgICAgd2hpbGUgKCFyZWFkZXIuZG9uZSgpKSB7CiAgICAgICAgICBsZXQgcG9zID0gcmVhZGVyLmludDMyKCk7CiAgICAgICAgICBsZXQgZGF0YSA9IHJlYWRlci5ieXRlcygpOwogICAgICAgICAgd3JpdGVzLnB1c2goeyBwb3MsIGRhdGEgfSk7CiAgICAgICAgfQoKICAgICAgICBhd2FpdCBoYW5kbGVXcml0ZXMod3JpdGVyLCBuYW1lLCB3cml0ZXMpOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ3JlYWRCbG9jayc6IHsKICAgICAgICBsZXQgbmFtZSA9IHJlYWRlci5zdHJpbmcoKTsKICAgICAgICBsZXQgcG9zID0gcmVhZGVyLmludDMyKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgc3RyZWFtUmVhZCh3cml0ZXIsIG5hbWUsIHBvcyk7CgogICAgICAgIGZ1bmN0aW9uIHN0cmVhbVJlYWQod3JpdGVyLCBuYW1lLCBwb3MpIHsKICAgICAgICAgIGhhbmRsZVJlYWQod3JpdGVyLCBuYW1lLCBwb3MsIGN1cnNvciA9PiB7CiAgICAgICAgICAgIGxldCBtZXRob2QgPSByZWFkZXIucGVlaygoKSA9PiByZWFkZXIuc3RyaW5nKCkpOwoKICAgICAgICAgICAgaWYgKG1ldGhvZCA9PT0gJ3JlYWRCbG9jaycpIHsKICAgICAgICAgICAgICAvLyBQb3Agb2ZmIHRoZSBtZXRob2QgbmFtZSBzaW5jZSB3ZSBvbmx5IHBlZWtlZCBpdAogICAgICAgICAgICAgIHJlYWRlci5zdHJpbmcoKTsKICAgICAgICAgICAgICBsZXQgbmV4dE5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgICAgICAgbGV0IG5leHRQb3MgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICAgICAgICByZWFkZXIuZG9uZSgpOwoKICAgICAgICAgICAgICBpZiAoY3Vyc29yICYmIG5leHROYW1lID09PSBuYW1lKSB7CiAgICAgICAgICAgICAgICBpZiAobmV4dFBvcyA+IGN1cnNvci5fcG9zKSB7CiAgICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdTVUNDRVNTJyk7CiAgICAgICAgICAgICAgICAgIGN1cnNvci51bnRpbChuZXh0UG9zKTsKICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdGQUlMJyk7CiAgICAgICAgICAgICAgICAgIGxldCB0cmFucyA9IGN1cnNvci5jdXJzb3IucmVxdWVzdC50cmFuc2FjdGlvbjsKICAgICAgICAgICAgICAgICAgaWYgKHRyYW5zLmNvbW1pdCkgewogICAgICAgICAgICAgICAgICAgIHRyYW5zLmNvbW1pdCgpOwogICAgICAgICAgICAgICAgICB9CgogICAgICAgICAgICAgICAgICBzdHJlYW1SZWFkKHdyaXRlciwgbmFtZSwgbmV4dFBvcyk7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgICAgIHN0cmVhbVJlYWQod3JpdGVyLCBuYW1lLCBuZXh0UG9zKTsKICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICAgICAgfQogICAgICAgICAgfSk7CiAgICAgICAgfQoKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAncmVhZE1ldGEnOiB7CiAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKICAgICAgICBhd2FpdCBoYW5kbGVSZWFkTWV0YSh3cml0ZXIsIG5hbWUpOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ3dyaXRlTWV0YSc6IHsKICAgICAgICBsZXQgbmFtZSA9IHJlYWRlci5zdHJpbmcoKTsKICAgICAgICBsZXQgc2l6ZSA9IHJlYWRlci5pbnQzMigpOwogICAgICAgIGxldCBibG9ja1NpemUgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICByZWFkZXIuZG9uZSgpOwogICAgICAgIGF3YWl0IGhhbmRsZVdyaXRlTWV0YSh3cml0ZXIsIG5hbWUsIHsgc2l6ZSwgYmxvY2tTaXplIH0pOwogICAgICAgIGxpc3RlbihyZWFkZXIsIHdyaXRlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNhc2UgJ2RlbGV0ZUZpbGUnOiB7CiAgICAgICAgcmVhZGVyLnN0cmluZygpOwogICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgIGF3YWl0IGhhbmRsZURlbGV0ZUZpbGUod3JpdGVyKTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CgogICAgICBjYXNlICdsb2NrRmlsZSc6IHsKICAgICAgICByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgLy8gTm9vcAogICAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKCiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgY2FzZSAndW5sb2NrRmlsZSc6IHsKICAgICAgICByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgLy8gTm9vcAogICAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKCiAgICAgICAgbGlzdGVuKHJlYWRlciwgd3JpdGVyKTsKICAgICAgICBicmVhazsKICAgICAgfQoKICAgICAgLy8gVE9ETzogaGFuZGxlIGNsb3NlCgogICAgICBkZWZhdWx0OgogICAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBtZXRob2Q6ICcgKyBtZXRob2QpOwogICAgfQogIH0KCiAgc2VsZi5vbm1lc3NhZ2UgPSBtc2cgPT4gewogICAgc3dpdGNoIChtc2cuZGF0YS50eXBlKSB7CiAgICAgIGNhc2UgJ2luaXQnOiB7CiAgICAgICAgcG9zdE1lc3NhZ2UoeyB0eXBlOiAnd29ya2VyLXJlYWR5JyB9KTsKICAgICAgICBsZXQgW2FyZ0J1ZmZlciwgcmVzdWx0QnVmZmVyXSA9IG1zZy5kYXRhLmJ1ZmZlcnM7CiAgICAgICAgbGV0IHJlYWRlciA9IG5ldyBSZWFkZXIoYXJnQnVmZmVyLCB7IG5hbWU6ICdhcmdzJywgZGVidWc6IGZhbHNlIH0pOwogICAgICAgIGxldCB3cml0ZXIgPSBuZXcgV3JpdGVyKHJlc3VsdEJ1ZmZlciwgeyBuYW1lOiAncmVzdWx0cycsIGRlYnVnOiBmYWxzZSB9KTsKICAgICAgICBsaXN0ZW4ocmVhZGVyLCB3cml0ZXIpOwogICAgICAgIGJyZWFrOwogICAgICB9CiAgICB9CiAgfTsKCn0oKSk7Cgo=', null, false);
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

    console.log('posting message');
    worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });

    worker.onmessage = msg => {
      if (msg.data.type === 'worker-ready') {
        onReady();
      }
    };

    console.log('waiting to be ready');
    return workerReady;
  }
}

// This is called from the main thread
function supportNestedWorkers(worker) {
  worker.addEventListener('message', e => {
    if (e.data.type === 'spawn-idb-worker') {
      startWorker(e.data.argBuffer, e.data.resultBuffer).then(() => {
        worker.postMessage({ type: 'worker-ready' });
      });
    }
  });
}

let argBuffer = new SharedArrayBuffer(4096 * 9);
let writer = new Writer(argBuffer, { name: 'args (backend)', debug: false });

let resultBuffer = new SharedArrayBuffer(4096 * 9);
let reader = new Reader(resultBuffer, { name: 'results', debug: false });

function positionToKey(pos, blockSize) {
  // We are forced to round because of floating point error. `pos`
  // should always be divisible by `blockSize`
  return Math.round(pos / blockSize);
}

function invokeWorker(method, args) {
  // console.log('invoking', method, args);
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
        res.push({ pos, data });
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
      writer.finalize();

      let res = reader.int32();
      reader.done();
      return res === 0;
    }

    case 'unlockFile': {
      writer.string('unlockFile');
      writer.string(args.name);
      writer.finalize();

      let res = reader.int32();
      reader.done();
      return res;
    }
  }
}

class FileOps {
  constructor(filename) {
    this.filename = filename;
  }

  startStats() {
    this.stats = {
      read: 0,
      write: 0
    };
  }

  endStats() {
    let stats = this.stats;
    this.stats = {};
    return stats;
  }

  getStoreName() {
    // TODO: better sanitization
    return this.filename.replace(/\//g, '-');
  }

  lock() {
    return invokeWorker('lockFile', { name: this.getStoreName() });
  }

  unlock() {
    return invokeWorker('unlockFile', { name: this.getStoreName() });
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
    // console.log('_reading', this.filename, positions);
    // if (Math.random() < 0.01) {
    //   console.log('reading');
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
    await startWorker(argBuffer, resultBuffer);
  }

  // lookupFile() {
  // }

  createFile(filename) {
    // let meta = invokeWorker('readMeta', { filename });
    return new File(filename, this.defaultBlockSize, new FileOps(filename));
  }
}

var index = {
  BlockedFS,
  MemoryBackend,
  IndexedDBBackend,
  supportNestedWorkers
};

export default index;
