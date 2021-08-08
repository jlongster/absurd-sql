import { File } from '../sqlite-file';

class FileOps {
  constructor(filename, meta = null, data) {
    this.filename = filename;
    this.locked = false;
    this.meta = meta;
    this.data = data || new ArrayBuffer(0);
  }

  lock() {
    return true;
  }

  unlock() {
    return true;
  }

  open() {}

  close() {
    return true;
  }

  delete() {
    // in-memory noop
  }

  startStats() {}
  stats() {}

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

    console.log('writes', writes.length);
    let i = 0;
    for (let write of writes) {
      if (i % 1000 === 0) {
        console.log('write');
      }
      i++;
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
  constructor(fileData) {
    this.fileData = Object.fromEntries(
      Object.entries(fileData).map(([name, data]) => {
        return [name, data];
      })
    );
    this.files = {};
  }

  createFile(filename) {
    if (this.files[filename] == null) {
      let data = this.fileData[filename];

      this.files[filename] = new File(
        filename,
        new FileOps(
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

  startProfile() {}

  stopProfile() {}
}
