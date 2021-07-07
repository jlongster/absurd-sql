import { File } from './virtual-file';

class FileOps {
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
    this.meta.size = meta.size;
    this.meta.blockSize = meta.blockSize;
  }

  readBlocks(positions) {
    console.log('_reading', this.filename, positions);
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
    console.log('_writing', this.filename, writes);
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

export default class MemoryBackend {
  constructor(defaultBlockSize, fileData) {
    this.fileData = Object.fromEntries(
      Object.entries(fileData).map(([name, data]) => {
        return [name, { data, size: data.byteLength }];
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
        new FileOps(
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
