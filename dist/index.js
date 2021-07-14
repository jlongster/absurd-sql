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
      console.log('block size', this.defaultBlockSize);
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
      missingChunks = this.ops.readBlocks(status.missing);
    }
    return status.chunks.concat(missingChunks);
  }

  read(bufferView, offset, length, position) {
    console.log('reading', this.filename, offset, length, position);
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
      this.ops.writeBlocks([...this.buffer.values()]);
    }

    console.log(this._metaDirty, this.meta);
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

  readBlocks(positions) {
    // console.log('_reading', this.filename, positions);
    let data = this.data;

    return positions.map(pos => {
      let buffer = new ArrayBuffer(this.meta.blockSize);

      if (pos < data.byteLength) {
        new Uint8Array(buffer).set(
          new Uint8Array(
            data,
            pos,
            Math.min(this.meta.blockSize, data.byteLength - pos)
          )
        );
      }

      return { pos, data: buffer };
    });
  }

  writeBlocks(writes) {
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
          {
            size: data ? data.byteLength : 0,
            blockSize: this.defaultBlockSize
          },
          data ? data : null
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
    }
  }

  flip() {
    let prev = Atomics.compareExchange(this.atomicView, 0, READABLE, WRITEABLE);

    if (prev !== READABLE) {
      throw new Error('Read data out of sync! This is disastrous');
    }

    Atomics.notify(this.atomicView, 0);
    this.offset = 4;
  }

  // notify() {
  //   if (this.stream) {
  //     if (this.useAtomics) {
  //       // Switch to writable
  //       this.log('switching to writable');
  //       Atomics.store(this.atomicView, 0, 1);
  //       Atomics.notify(this.atomicView, 0);
  //     } else {
  //       this.atomicView[0] = 1;
  //     }
  //     this.offset = 4;
  //   }
  // }

  done(force) {
    this.log('checking done');
    this.waitWrite();

    let dataView = new DataView(this.buffer, this.offset);
    let done = dataView.getUint32(0) === FINALIZED;

    if (done) {
      this.flip();
    }

    return done;
  }

  string() {
    this.waitWrite();

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
    this.flip();
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
    this.waitWrite();
    let num = this._int32();
    this.log('int32', num);
    this.flip();
    return num;
  }

  bytes() {
    this.waitWrite();

    let byteLength = this._int32();

    let bytes = new ArrayBuffer(byteLength);
    new Uint8Array(bytes).set(
      new Uint8Array(this.buffer, this.offset, byteLength)
    );
    this.log('bytes', bytes);

    this.offset += byteLength;
    this.flip();
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
      this.atomicView[0] = 1;
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

      this.offset = 4;

      this.log(`resumed for ${name}`);
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
    let dataView = new DataView(this.buffer, this.offset);
    dataView.setUint32(0, FINALIZED);
    this.waitRead();
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
    this.waitRead();
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
    this.waitRead();
  }

  bytes(buffer) {
    this.log('bytes', buffer);

    let byteLength = buffer.byteLength;
    this._int32(byteLength);
    new Uint8Array(this.buffer, this.offset).set(new Uint8Array(buffer));

    this.offset += byteLength;
    this.waitRead();
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

var WorkerFactory = createBase64WorkerFactory('Lyogcm9sbHVwLXBsdWdpbi13ZWItd29ya2VyLWxvYWRlciAqLwooZnVuY3Rpb24gKCkgewogICd1c2Ugc3RyaWN0JzsKCiAgbGV0IEZJTkFMSVpFRCA9IDB4ZGVhZGJlZWY7CgogIGxldCBXUklURUFCTEUgPSAwOwogIGxldCBSRUFEQUJMRSA9IDE7CgogIGNsYXNzIFJlYWRlciB7CiAgICBjb25zdHJ1Y3RvcigKICAgICAgYnVmZmVyLAogICAgICB7IGluaXRpYWxPZmZzZXQgPSA0LCB1c2VBdG9taWNzID0gdHJ1ZSwgc3RyZWFtID0gdHJ1ZSwgZGVidWcsIG5hbWUgfSA9IHt9CiAgICApIHsKICAgICAgdGhpcy5idWZmZXIgPSBidWZmZXI7CiAgICAgIHRoaXMuYXRvbWljVmlldyA9IG5ldyBJbnQzMkFycmF5KGJ1ZmZlcik7CiAgICAgIHRoaXMub2Zmc2V0ID0gaW5pdGlhbE9mZnNldDsKICAgICAgdGhpcy51c2VBdG9taWNzID0gdXNlQXRvbWljczsKICAgICAgdGhpcy5zdHJlYW0gPSBzdHJlYW07CiAgICAgIHRoaXMuZGVidWcgPSBkZWJ1ZzsKICAgICAgdGhpcy5uYW1lID0gbmFtZTsKICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbcmVhZGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0V3JpdGUobmFtZSkgewogICAgICBpZiAodGhpcy51c2VBdG9taWNzKSB7CiAgICAgICAgdGhpcy5sb2coYHdhaXRpbmcgZm9yICR7bmFtZX1gKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBXUklURUFCTEUpIHsKICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCd3YWl0aW5nIGZvciB3cml0ZS4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgV1JJVEVBQkxFLCA1MDApOwogICAgICAgIH0KCiAgICAgICAgdGhpcy5sb2coYHJlc3VtZWQgZm9yICR7bmFtZX1gKTsKICAgICAgfQogICAgfQoKICAgIGZsaXAoKSB7CiAgICAgIGxldCBwcmV2ID0gQXRvbWljcy5jb21wYXJlRXhjaGFuZ2UodGhpcy5hdG9taWNWaWV3LCAwLCBSRUFEQUJMRSwgV1JJVEVBQkxFKTsKCiAgICAgIGlmIChwcmV2ICE9PSBSRUFEQUJMRSkgewogICAgICAgIHRocm93IG5ldyBFcnJvcignUmVhZCBkYXRhIG91dCBvZiBzeW5jISBUaGlzIGlzIGRpc2FzdHJvdXMnKTsKICAgICAgfQoKICAgICAgQXRvbWljcy5ub3RpZnkodGhpcy5hdG9taWNWaWV3LCAwKTsKICAgICAgdGhpcy5vZmZzZXQgPSA0OwogICAgfQoKICAgIC8vIG5vdGlmeSgpIHsKICAgIC8vICAgaWYgKHRoaXMuc3RyZWFtKSB7CiAgICAvLyAgICAgaWYgKHRoaXMudXNlQXRvbWljcykgewogICAgLy8gICAgICAgLy8gU3dpdGNoIHRvIHdyaXRhYmxlCiAgICAvLyAgICAgICB0aGlzLmxvZygnc3dpdGNoaW5nIHRvIHdyaXRhYmxlJyk7CiAgICAvLyAgICAgICBBdG9taWNzLnN0b3JlKHRoaXMuYXRvbWljVmlldywgMCwgMSk7CiAgICAvLyAgICAgICBBdG9taWNzLm5vdGlmeSh0aGlzLmF0b21pY1ZpZXcsIDApOwogICAgLy8gICAgIH0gZWxzZSB7CiAgICAvLyAgICAgICB0aGlzLmF0b21pY1ZpZXdbMF0gPSAxOwogICAgLy8gICAgIH0KICAgIC8vICAgICB0aGlzLm9mZnNldCA9IDQ7CiAgICAvLyAgIH0KICAgIC8vIH0KCiAgICBkb25lKGZvcmNlKSB7CiAgICAgIHRoaXMubG9nKCdjaGVja2luZyBkb25lJyk7CiAgICAgIHRoaXMud2FpdFdyaXRlKCk7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgbGV0IGRvbmUgPSBkYXRhVmlldy5nZXRVaW50MzIoMCkgPT09IEZJTkFMSVpFRDsKCiAgICAgIGlmIChkb25lKSB7CiAgICAgICAgdGhpcy5mbGlwKCk7CiAgICAgIH0KCiAgICAgIHJldHVybiBkb25lOwogICAgfQoKICAgIHN0cmluZygpIHsKICAgICAgdGhpcy53YWl0V3JpdGUoKTsKCiAgICAgIGxldCBieXRlTGVuZ3RoID0gdGhpcy5faW50MzIoKTsKICAgICAgbGV0IGxlbmd0aCA9IGJ5dGVMZW5ndGggLyAyOwoKICAgICAgbGV0IGRhdGFWaWV3ID0gbmV3IERhdGFWaWV3KHRoaXMuYnVmZmVyLCB0aGlzLm9mZnNldCwgYnl0ZUxlbmd0aCk7CiAgICAgIGxldCBjaGFycyA9IFtdOwogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7CiAgICAgICAgY2hhcnMucHVzaChkYXRhVmlldy5nZXRVaW50MTYoaSAqIDIpKTsKICAgICAgfQogICAgICBsZXQgc3RyID0gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBjaGFycyk7CiAgICAgIHRoaXMubG9nKCdzdHJpbmcnLCBzdHIpOwoKICAgICAgdGhpcy5vZmZzZXQgKz0gYnl0ZUxlbmd0aDsKICAgICAgdGhpcy5mbGlwKCk7CiAgICAgIHJldHVybiBzdHI7CiAgICB9CgogICAgX2ludDMyKCkgewogICAgICBsZXQgYnl0ZUxlbmd0aCA9IDQ7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgbGV0IG51bSA9IGRhdGFWaWV3LmdldEludDMyKCk7CiAgICAgIHRoaXMubG9nKCdfaW50MzInLCBudW0pOwoKICAgICAgdGhpcy5vZmZzZXQgKz0gYnl0ZUxlbmd0aDsKICAgICAgcmV0dXJuIG51bTsKICAgIH0KCiAgICBpbnQzMigpIHsKICAgICAgdGhpcy53YWl0V3JpdGUoKTsKICAgICAgbGV0IG51bSA9IHRoaXMuX2ludDMyKCk7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CiAgICAgIHRoaXMuZmxpcCgpOwogICAgICByZXR1cm4gbnVtOwogICAgfQoKICAgIGJ5dGVzKCkgewogICAgICB0aGlzLndhaXRXcml0ZSgpOwoKICAgICAgbGV0IGJ5dGVMZW5ndGggPSB0aGlzLl9pbnQzMigpOwoKICAgICAgbGV0IGJ5dGVzID0gbmV3IEFycmF5QnVmZmVyKGJ5dGVMZW5ndGgpOwogICAgICBuZXcgVWludDhBcnJheShieXRlcykuc2V0KAogICAgICAgIG5ldyBVaW50OEFycmF5KHRoaXMuYnVmZmVyLCB0aGlzLm9mZnNldCwgYnl0ZUxlbmd0aCkKICAgICAgKTsKICAgICAgdGhpcy5sb2coJ2J5dGVzJywgYnl0ZXMpOwoKICAgICAgdGhpcy5vZmZzZXQgKz0gYnl0ZUxlbmd0aDsKICAgICAgdGhpcy5mbGlwKCk7CiAgICAgIHJldHVybiBieXRlczsKICAgIH0KICB9CgogIGNsYXNzIFdyaXRlciB7CiAgICBjb25zdHJ1Y3RvcigKICAgICAgYnVmZmVyLAogICAgICB7IGluaXRpYWxPZmZzZXQgPSA0LCB1c2VBdG9taWNzID0gdHJ1ZSwgc3RyZWFtID0gdHJ1ZSwgZGVidWcsIG5hbWUgfSA9IHt9CiAgICApIHsKICAgICAgdGhpcy5idWZmZXIgPSBidWZmZXI7CiAgICAgIHRoaXMuYXRvbWljVmlldyA9IG5ldyBJbnQzMkFycmF5KGJ1ZmZlcik7CiAgICAgIHRoaXMub2Zmc2V0ID0gaW5pdGlhbE9mZnNldDsKICAgICAgdGhpcy51c2VBdG9taWNzID0gdXNlQXRvbWljczsKICAgICAgdGhpcy5zdHJlYW0gPSBzdHJlYW07CgogICAgICB0aGlzLmRlYnVnID0gZGVidWc7CiAgICAgIHRoaXMubmFtZSA9IG5hbWU7CgogICAgICBpZiAodGhpcy51c2VBdG9taWNzKSB7CiAgICAgICAgLy8gVGhlIGJ1ZmZlciBzdGFydHMgb3V0IGFzIHdyaXRlYWJsZQogICAgICAgIEF0b21pY3Muc3RvcmUodGhpcy5hdG9taWNWaWV3LCAwLCBXUklURUFCTEUpOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMuYXRvbWljVmlld1swXSA9IDE7CiAgICAgIH0KICAgIH0KCiAgICBsb2coLi4uYXJncykgewogICAgICBpZiAodGhpcy5kZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKGBbd3JpdGVyOiAke3RoaXMubmFtZX1dYCwgLi4uYXJncyk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0UmVhZChuYW1lKSB7CiAgICAgIGlmICh0aGlzLnVzZUF0b21pY3MpIHsKICAgICAgICB0aGlzLmxvZyhgd2FpdGluZyBmb3IgJHtuYW1lfWApOwogICAgICAgIC8vIFN3aXRjaCB0byB3cml0YWJsZQogICAgICAgIC8vIEF0b21pY3Muc3RvcmUodGhpcy5hdG9taWNWaWV3LCAwLCAxKTsKCiAgICAgICAgbGV0IHByZXYgPSBBdG9taWNzLmNvbXBhcmVFeGNoYW5nZSgKICAgICAgICAgIHRoaXMuYXRvbWljVmlldywKICAgICAgICAgIDAsCiAgICAgICAgICBXUklURUFCTEUsCiAgICAgICAgICBSRUFEQUJMRQogICAgICAgICk7CgogICAgICAgIGlmIChwcmV2ICE9PSBXUklURUFCTEUpIHsKICAgICAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAgICAgJ1dyb3RlIHNvbWV0aGluZyBpbnRvIHVud3JpdGFibGUgYnVmZmVyISBUaGlzIGlzIGRpc2FzdHJvdXMnCiAgICAgICAgICApOwogICAgICAgIH0KCiAgICAgICAgQXRvbWljcy5ub3RpZnkodGhpcy5hdG9taWNWaWV3LCAwKTsKCiAgICAgICAgd2hpbGUgKEF0b21pY3MubG9hZCh0aGlzLmF0b21pY1ZpZXcsIDApID09PSBSRUFEQUJMRSkgewogICAgICAgICAgLy8gY29uc29sZS5sb2coJ3dhaXRpbmcgdG8gYmUgcmVhZC4uLicpOwogICAgICAgICAgQXRvbWljcy53YWl0KHRoaXMuYXRvbWljVmlldywgMCwgUkVBREFCTEUsIDUwMCk7CiAgICAgICAgfQoKICAgICAgICB0aGlzLm9mZnNldCA9IDQ7CgogICAgICAgIHRoaXMubG9nKGByZXN1bWVkIGZvciAke25hbWV9YCk7CiAgICAgIH0KICAgIH0KCiAgICB3YWl0KCkgewogICAgICBpZiAodGhpcy51c2VBdG9taWNzKSB7CiAgICAgICAgLy8gV2FpdCB0byBiZSB3cml0YWJsZSBhZ2FpbgogICAgICAgIHRoaXMubG9nKCd3YWl0aW5nJyk7CgogICAgICAgIGlmIChBdG9taWNzLndhaXQodGhpcy5hdG9taWNWaWV3LCAwLCAwLCAxMDApID09PSAndGltZWQtb3V0JykgewogICAgICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICAgICBgW3dyaXRlcjogJHt0aGlzLm5hbWV9XSBXcml0ZXIgY2Fubm90IHdyaXRlOiB0aW1lZCBvdXRgCiAgICAgICAgICApOwogICAgICAgIH0KICAgICAgICB0aGlzLmxvZygncmVzdW1lZCcpOwogICAgICB9CiAgICB9CgogICAgbm90aWZ5KCkgewogICAgICBpZiAodGhpcy5zdHJlYW0pIHsKICAgICAgICBpZiAodGhpcy51c2VBdG9taWNzKSB7CiAgICAgICAgICAvLyBGbHVzaCBpdCBvdXQuIFN3aXRjaCB0byByZWFkYWJsZQogICAgICAgICAgQXRvbWljcy5zdG9yZSh0aGlzLmF0b21pY1ZpZXcsIDAsIDApOwogICAgICAgICAgQXRvbWljcy5ub3RpZnkodGhpcy5hdG9taWNWaWV3LCAwKTsKICAgICAgICAgIHRoaXMubG9nKCdzd2l0Y2hpbmcgdG8gcmVhZGFibGUnKTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgdGhpcy5hdG9taWNWaWV3WzBdID0gMDsKICAgICAgICB9CiAgICAgICAgdGhpcy5vZmZzZXQgPSA0OwogICAgICB9CiAgICB9CgogICAgZmluYWxpemUoKSB7CiAgICAgIHRoaXMubG9nKCdmaW5hbGl6aW5nJyk7CiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpOwogICAgICBkYXRhVmlldy5zZXRVaW50MzIoMCwgRklOQUxJWkVEKTsKICAgICAgdGhpcy53YWl0UmVhZCgpOwogICAgfQoKICAgIHN0cmluZyhzdHIpIHsKICAgICAgdGhpcy5sb2coJ3N0cmluZycsIHN0cik7CgogICAgICBsZXQgYnl0ZUxlbmd0aCA9IHN0ci5sZW5ndGggKiAyOwogICAgICB0aGlzLl9pbnQzMihieXRlTGVuZ3RoKTsKCiAgICAgIGxldCBkYXRhVmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQsIGJ5dGVMZW5ndGgpOwogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykgewogICAgICAgIGRhdGFWaWV3LnNldFVpbnQxNihpICogMiwgc3RyLmNoYXJDb2RlQXQoaSkpOwogICAgICB9CgogICAgICB0aGlzLm9mZnNldCArPSBieXRlTGVuZ3RoOwogICAgICB0aGlzLndhaXRSZWFkKCk7CiAgICB9CgogICAgX2ludDMyKG51bSkgewogICAgICBsZXQgYnl0ZUxlbmd0aCA9IDQ7CgogICAgICBsZXQgZGF0YVZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIsIHRoaXMub2Zmc2V0KTsKICAgICAgZGF0YVZpZXcuc2V0SW50MzIoMCwgbnVtKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CiAgICB9CgogICAgaW50MzIobnVtKSB7CiAgICAgIHRoaXMubG9nKCdpbnQzMicsIG51bSk7CiAgICAgIHRoaXMuX2ludDMyKG51bSk7CiAgICAgIHRoaXMud2FpdFJlYWQoKTsKICAgIH0KCiAgICBieXRlcyhidWZmZXIpIHsKICAgICAgdGhpcy5sb2coJ2J5dGVzJywgYnVmZmVyKTsKCiAgICAgIGxldCBieXRlTGVuZ3RoID0gYnVmZmVyLmJ5dGVMZW5ndGg7CiAgICAgIHRoaXMuX2ludDMyKGJ5dGVMZW5ndGgpOwogICAgICBuZXcgVWludDhBcnJheSh0aGlzLmJ1ZmZlciwgdGhpcy5vZmZzZXQpLnNldChuZXcgVWludDhBcnJheShidWZmZXIpKTsKCiAgICAgIHRoaXMub2Zmc2V0ICs9IGJ5dGVMZW5ndGg7CiAgICAgIHRoaXMud2FpdFJlYWQoKTsKICAgIH0KICB9CgogIGxldCBpZGIgPSBnbG9iYWxUaGlzLmluZGV4ZWREQjsKCiAgbGV0IG9wZW5EYnMgPSBuZXcgTWFwKCk7CgogIGFzeW5jIGZ1bmN0aW9uIGxvYWREYihuYW1lKSB7CiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICBpZiAob3BlbkRicy5nZXQobmFtZSkpIHsKICAgICAgICByZXNvbHZlKG9wZW5EYnMuZ2V0KG5hbWUpKTsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGxldCByZXEgPSBpZGIub3BlbihuYW1lLCAxKTsKICAgICAgcmVxLm9uc3VjY2VzcyA9IGV2ZW50ID0+IHsKICAgICAgICBjb25zb2xlLmxvZygnZGIgaXMgb3BlbiEnLCBuYW1lKTsKICAgICAgICBsZXQgZGIgPSBldmVudC50YXJnZXQucmVzdWx0OwoKICAgICAgICBkYi5vbnZlcnNpb25jaGFuZ2UgPSAoKSA9PiB7CiAgICAgICAgICAvLyBUT0RPOiBOb3RpZnkgdGhlIHVzZXIgc29tZWhvdwogICAgICAgICAgY29uc29sZS5sb2coJ2Nsb3NpbmcgYmVjYXVzZSB2ZXJzaW9uIGNoYW5nZWQnKTsKICAgICAgICAgIGRiLmNsb3NlKCk7CiAgICAgICAgfTsKCiAgICAgICAgZGIub25jbG9zZSA9ICgpID0+IHsKICAgICAgICAgIG9wZW5EYnMuZGVsZXRlKG5hbWUpOwogICAgICAgIH07CgogICAgICAgIG9wZW5EYnMuc2V0KG5hbWUsIGRiKTsKICAgICAgICByZXNvbHZlKGRiKTsKICAgICAgfTsKICAgICAgcmVxLm9udXBncmFkZW5lZWRlZCA9IGV2ZW50ID0+IHsKICAgICAgICBsZXQgZGIgPSBldmVudC50YXJnZXQucmVzdWx0OwogICAgICAgIGlmICghZGIub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygnZGF0YScpKSB7CiAgICAgICAgICBkYi5jcmVhdGVPYmplY3RTdG9yZSgnZGF0YScsIHsga2V5UGF0aDogJ2tleScgfSk7CiAgICAgICAgfQogICAgICB9OwogICAgICByZXEub25ibG9ja2VkID0gZSA9PiBjb25zb2xlLmxvZygnYmxvY2tlZCcsIGUpOwogICAgICByZXEub25lcnJvciA9IHJlcS5vbmFib3J0ID0gZSA9PiByZWplY3QoZS50YXJnZXQuZXJyb3IpOwogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBnZXRTdG9yZShuYW1lKSB7CiAgICBsZXQgZGIgPSBhd2FpdCBsb2FkRGIobmFtZSk7CiAgICBsZXQgdHJhbnMgPSBkYi50cmFuc2FjdGlvbihbJ2RhdGEnXSwgJ3JlYWR3cml0ZScpOwogICAgcmV0dXJuIHsgdHJhbnMsIHN0b3JlOiB0cmFucy5vYmplY3RTdG9yZSgnZGF0YScpIH07CiAgfQoKICBhc3luYyBmdW5jdGlvbiBnZXQoc3RvcmUsIGtleSwgbWFwcGVyID0geCA9PiB4KSB7CiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICBsZXQgcmVxID0gc3RvcmUuZ2V0KGtleSk7CiAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBlID0+IHsKICAgICAgICByZXNvbHZlKG1hcHBlcihyZXEucmVzdWx0KSk7CiAgICAgIH07CiAgICAgIHJlcS5vbmVycm9yID0gZSA9PiByZWplY3QoZSk7CiAgICB9KTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIHNldChzdG9yZSwgaXRlbSkgewogICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgICAgbGV0IHJlcSA9IHN0b3JlLnB1dChpdGVtKTsKICAgICAgcmVxLm9uc3VjY2VzcyA9IGUgPT4gcmVzb2x2ZShyZXEucmVzdWx0KTsKICAgICAgcmVxLm9uZXJyb3IgPSBlID0+IHJlamVjdChlKTsKICAgIH0pOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gYnVsa1NldCh0cmFucywgc3RvcmUsIGl0ZW1zKSB7CiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgIGZvciAobGV0IGl0ZW0gb2YgaXRlbXMpIHsKICAgICAgICBzdG9yZS5wdXQoaXRlbSk7CiAgICAgIH0KCiAgICAgIHRyYW5zLm9uY29tcGxldGUgPSBlID0+IHJlc29sdmUoKTsKICAgICAgdHJhbnMub25lcnJvciA9IGUgPT4gcmVqZWN0KGUpOwogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVSZWFkcyh3cml0ZXIsIG5hbWUsIHBvc2l0aW9ucykgewogICAgbGV0IHsgdHJhbnMsIHN0b3JlIH0gPSBhd2FpdCBnZXRTdG9yZShuYW1lKTsKICAgIGxldCBvbmNvbXBsZXRlID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiAodHJhbnMub25jb21wbGV0ZSA9IHJlc29sdmUpKTsKICAgIGxldCBkYXRhID0gYXdhaXQgUHJvbWlzZS5hbGwoCiAgICAgIHBvc2l0aW9ucy5tYXAocG9zID0+CiAgICAgICAgZ2V0KHN0b3JlLCBwb3MsIGRhdGEgPT4gKHsKICAgICAgICAgIHBvcywKICAgICAgICAgIGRhdGE6IGRhdGEgPyBkYXRhLnZhbHVlIDogbmV3IEFycmF5QnVmZmVyKDQwOTYgKiA0KQogICAgICAgIH0pKQogICAgICApCiAgICApOwogICAgLy8gY29uc29sZS5sb2coJ3Jlc3VsdCcsIERhdGUubm93KCkgLSBzdGFydCk7CgogICAgaWYgKHRyYW5zLmNvbW1pdCkgewogICAgICB0cmFucy5jb21taXQoKTsKICAgIH0gZWxzZSB7CiAgICAgIGF3YWl0IG9uY29tcGxldGU7CiAgICB9CgogICAgZm9yIChsZXQgcmVhZCBvZiBkYXRhKSB7CiAgICAgIHdyaXRlci5pbnQzMihyZWFkLnBvcyk7CiAgICAgIHdyaXRlci5ieXRlcyhyZWFkLmRhdGEpOwogICAgfQogICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVXcml0ZXMod3JpdGVyLCBuYW1lLCB3cml0ZXMpIHsKICAgIGxldCB7IHRyYW5zLCBzdG9yZSB9ID0gYXdhaXQgZ2V0U3RvcmUobmFtZSk7CgogICAgdHJ5IHsKICAgICAgYXdhaXQgYnVsa1NldCgKICAgICAgICB0cmFucywKICAgICAgICBzdG9yZSwKICAgICAgICB3cml0ZXMubWFwKHcgPT4gKHsga2V5OiB3LnBvcywgdmFsdWU6IHcuZGF0YSB9KSkKICAgICAgKTsKCiAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5sb2coZXJyKTsKICAgICAgd3JpdGVyLmludDMyKC0xKTsKICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVSZWFkTWV0YSh3cml0ZXIsIG5hbWUpIHsKICAgIGxldCB7IHRyYW5zLCBzdG9yZSB9ID0gYXdhaXQgZ2V0U3RvcmUobmFtZSk7CiAgICBsZXQgb25jb21wbGV0ZSA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gKHRyYW5zLm9uY29tcGxldGUgPSByZXNvbHZlKSk7CgogICAgdHJ5IHsKICAgICAgY29uc29sZS5sb2coJ2dldHRpbmcgbWV0YScpOwogICAgICBsZXQgcmVzID0gYXdhaXQgZ2V0KHN0b3JlLCAtMSk7CgogICAgICBpZiAodHJhbnMuY29tbWl0KSB7CiAgICAgICAgdHJhbnMuY29tbWl0KCk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgYXdhaXQgb25jb21wbGV0ZTsKICAgICAgfQoKICAgICAgY29uc29sZS5sb2coJ2dldHRpbmcgbWV0YSAoZG9uZSknKTsKICAgICAgbGV0IG1ldGEgPSByZXMgJiYgcmVzLnZhbHVlOwogICAgICB3cml0ZXIuaW50MzIobWV0YSA/IG1ldGEuc2l6ZSA6IC0xKTsKICAgICAgd3JpdGVyLmludDMyKG1ldGEgPyBtZXRhLmJsb2NrU2l6ZSA6IC0xKTsKICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5sb2coZXJyKTsKICAgICAgd3JpdGVyLmludDMyKC0xKTsKICAgICAgd3JpdGVyLmludDMyKC0xKTsKICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVXcml0ZU1ldGEod3JpdGVyLCBuYW1lLCBtZXRhKSB7CiAgICBsZXQgeyB0cmFucywgc3RvcmUgfSA9IGF3YWl0IGdldFN0b3JlKG5hbWUpOwogICAgbGV0IG9uY29tcGxldGUgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+ICh0cmFucy5vbmNvbXBsZXRlID0gcmVzb2x2ZSkpOwoKICAgIHRyeSB7CiAgICAgIGNvbnNvbGUubG9nKCdzZXR0aW5nIG1ldGEnLCBtZXRhKTsKICAgICAgYXdhaXQgc2V0KHN0b3JlLCB7IGtleTogLTEsIHZhbHVlOiBtZXRhIH0pOwoKICAgICAgaWYgKHRyYW5zLmNvbW1pdCkgewogICAgICAgIHRyYW5zLmNvbW1pdCgpOwogICAgICB9IGVsc2UgewogICAgICAgIGF3YWl0IG9uY29tcGxldGU7CiAgICAgIH0KCiAgICAgIHdyaXRlci5pbnQzMigwKTsKICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5sb2coZXJyKTsKICAgICAgd3JpdGVyLmludDMyKC0xKTsKICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVEZWxldGVGaWxlKHdyaXRlciwgbmFtZSkgewogICAgLy8gZmlsZUNhY2hlW25hbWVdID0gbnVsbDsKCiAgICB3cml0ZXIuaW50MzIoMCk7CiAgICB3cml0ZXIuZmluYWxpemUoKTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGxpc3RlbihhcmdCdWZmZXIsIHJlc3VsdEJ1ZmZlcikgewogICAgbGV0IHJlYWRlciA9IG5ldyBSZWFkZXIoYXJnQnVmZmVyLCB7IG5hbWU6ICdhcmdzJywgZGVidWc6IGZhbHNlIH0pOwogICAgbGV0IHdyaXRlciA9IG5ldyBXcml0ZXIocmVzdWx0QnVmZmVyLCB7IG5hbWU6ICdyZXN1bHRzJywgZGVidWc6IGZhbHNlIH0pOwogICAgY29uc29sZS5sb2coJ2xpc3RlbmluZycpOwoKICAgIHdoaWxlICgxKSB7CiAgICAgIC8vIHJlYWRlci53YWl0KCdsb29wJywgMTAwMDApOwogICAgICBsZXQgbWV0aG9kID0gcmVhZGVyLnN0cmluZygpOwoKICAgICAgc3dpdGNoIChtZXRob2QpIHsKICAgICAgICBjYXNlICd3cml0ZUJsb2Nrcyc6IHsKICAgICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgICAgbGV0IHdyaXRlcyA9IFtdOwogICAgICAgICAgd2hpbGUgKCFyZWFkZXIuZG9uZSgpKSB7CiAgICAgICAgICAgIGxldCBwb3MgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICAgICAgbGV0IGRhdGEgPSByZWFkZXIuYnl0ZXMoKTsKICAgICAgICAgICAgd3JpdGVzLnB1c2goeyBwb3MsIGRhdGEgfSk7CiAgICAgICAgICB9CgogICAgICAgICAgYXdhaXQgaGFuZGxlV3JpdGVzKHdyaXRlciwgbmFtZSwgd3JpdGVzKTsKICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KCiAgICAgICAgY2FzZSAncmVhZEJsb2Nrcyc6IHsKICAgICAgICAgIGxldCBuYW1lID0gcmVhZGVyLnN0cmluZygpOwogICAgICAgICAgbGV0IHBvc2l0aW9ucyA9IFtdOwogICAgICAgICAgd2hpbGUgKCFyZWFkZXIuZG9uZSgpKSB7CiAgICAgICAgICAgIGxldCBwb3MgPSByZWFkZXIuaW50MzIoKTsKICAgICAgICAgICAgcG9zaXRpb25zLnB1c2gocG9zKTsKICAgICAgICAgIH0KCiAgICAgICAgICBhd2FpdCBoYW5kbGVSZWFkcyh3cml0ZXIsIG5hbWUsIHBvc2l0aW9ucyk7CiAgICAgICAgICBicmVhazsKICAgICAgICB9CgogICAgICAgIGNhc2UgJ3JlYWRNZXRhJzogewogICAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgICByZWFkZXIuZG9uZSgpOwogICAgICAgICAgYXdhaXQgaGFuZGxlUmVhZE1ldGEod3JpdGVyLCBuYW1lKTsKICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KCiAgICAgICAgY2FzZSAnd3JpdGVNZXRhJzogewogICAgICAgICAgbGV0IG5hbWUgPSByZWFkZXIuc3RyaW5nKCk7CiAgICAgICAgICBsZXQgc2l6ZSA9IHJlYWRlci5pbnQzMigpOwogICAgICAgICAgbGV0IGJsb2NrU2l6ZSA9IHJlYWRlci5pbnQzMigpOwogICAgICAgICAgcmVhZGVyLmRvbmUoKTsKICAgICAgICAgIGF3YWl0IGhhbmRsZVdyaXRlTWV0YSh3cml0ZXIsIG5hbWUsIHsgc2l6ZSwgYmxvY2tTaXplIH0pOwogICAgICAgICAgYnJlYWs7CiAgICAgICAgfQoKICAgICAgICBjYXNlICdkZWxldGVGaWxlJzogewogICAgICAgICAgcmVhZGVyLnN0cmluZygpOwogICAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgICBhd2FpdCBoYW5kbGVEZWxldGVGaWxlKHdyaXRlcik7CiAgICAgICAgICBicmVhazsKICAgICAgICB9CgogICAgICAgIGNhc2UgJ2xvY2tGaWxlJzogewogICAgICAgICAgcmVhZGVyLnN0cmluZygpOwogICAgICAgICAgcmVhZGVyLmRvbmUoKTsKCiAgICAgICAgICAvLyBOb29wCiAgICAgICAgICB3cml0ZXIuaW50MzIoMCk7CiAgICAgICAgICB3cml0ZXIuZmluYWxpemUoKTsKICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KCiAgICAgICAgY2FzZSAndW5sb2NrRmlsZSc6IHsKICAgICAgICAgIHJlYWRlci5zdHJpbmcoKTsKICAgICAgICAgIHJlYWRlci5kb25lKCk7CgogICAgICAgICAgLy8gTm9vcAogICAgICAgICAgd3JpdGVyLmludDMyKDApOwogICAgICAgICAgd3JpdGVyLmZpbmFsaXplKCk7CiAgICAgICAgICBicmVhazsKICAgICAgICB9CgogICAgICAgIC8vIFRPRE86IGhhbmRsZSBjbG9zZQoKICAgICAgICBkZWZhdWx0OgogICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIG1ldGhvZDogJyArIG1ldGhvZCk7CiAgICAgIH0KICAgIH0KICB9CgogIGNvbnNvbGUubG9nKCdydW5uaW5nIHdvcmtlcicpOwoKICBzZWxmLm9ubWVzc2FnZSA9IG1zZyA9PiB7CiAgICBjb25zb2xlLmxvZygnd29ya2VyIGdvdCBtZXNzYWdlJywgbXNnKTsKICAgIHN3aXRjaCAobXNnLmRhdGEudHlwZSkgewogICAgICBjYXNlICdpbml0JzogewogICAgICAgIHBvc3RNZXNzYWdlKHsgdHlwZTogJ3dvcmtlci1yZWFkeScgfSk7CiAgICAgICAgbGV0IFthcmdCdWZmZXIsIHJlc3VsdEJ1ZmZlcl0gPSBtc2cuZGF0YS5idWZmZXJzOwogICAgICAgIGxpc3RlbihhcmdCdWZmZXIsIHJlc3VsdEJ1ZmZlcik7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KICAgIH0KICB9OwoKfSgpKTsKCg==', null, false);
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

  console.log('running');

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
let writer = new Writer(argBuffer, { name: 'args', debug: false });

let resultBuffer = new SharedArrayBuffer(4096 * 9);
let reader = new Reader(resultBuffer, { name: 'results', debug: false });

function invokeWorker(method, args) {
  // console.log('invoking', method, args);
  switch (method) {
    case 'readBlocks': {
      let { name, positions } = args;
      writer.string('readBlocks');
      writer.string(name);
      for (let pos of positions) {
        writer.int32(pos);
      }
      writer.finalize();

      let res = [];
      while (!reader.done()) {
        let pos = reader.int32();
        let data = reader.bytes();
        res.push({ pos, data });
      }

      return res;
    }

    case 'writeBlocks': {
      let { name, writes } = args;
      writer.string('writeBlocks');
      writer.string(name);
      for (let write of writes) {
        writer.int32(write.pos);
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

  readBlocks(positions) {
    // console.log('_reading', this.filename, positions);
    if (Math.random() < 0.01) {
      console.log('reading');
    }

    if (this.stats) {
      this.stats.read += positions.length;
    }

    return invokeWorker('readBlocks', {
      name: this.getStoreName(),
      positions
    });
  }

  writeBlocks(writes) {
    // console.log('_writing', this.filename, writes);
    if (this.stats) {
      this.stats.writes += writes.length;
    }

    return invokeWorker('writeBlocks', { name: this.getStoreName(), writes });
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
