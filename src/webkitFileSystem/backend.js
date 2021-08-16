import { File } from '../sqlite-file';
import { getPageSize } from '../sqlite-util';
import * as perf from 'perf-deets';

class FileOps {
  constructor(filename, rootEntry) {
    this.filename = filename;
    this.rootEntry = rootEntry;
  }

  getDatabaseName() {
    return this.filename.replace(/\//g, '-');
  }

  lock(lockType) {
    return true;
  }

  unlock(lockType) {
    return true;
  }

  delete() {
    console.log('deleting');
    this.entry.remove();
  }

  open() {
    this.entry = this.rootEntry.getFile(this.getDatabaseName(), {
      create: true
    });
  }

  close() {
    // close
  }

  readMeta() {
    let file = this.entry.file();
    let reader = new FileReaderSync();

    let blockSize = null;
    if (file.size > 0) {
      let data = reader.readAsArrayBuffer(file.slice(16, 18));
      let arr = new Uint16Array(data);
      blockSize = arr[0] * 256;
    }

    return { size: file.size, blockSize: blockSize == 0 ? null : blockSize };
  }

  writeMeta(meta) {
    let writer = this.entry.createWriter();
    writer.truncate(meta.size);
    return 0;
  }

  readBlocks(positions, blockSize) {
    let res = [];
    let file = this.entry.file();
    let reader = new FileReaderSync();
    for (let pos of positions) {
      let data = reader.readAsArrayBuffer(file.slice(pos, pos + blockSize));
      res.push({
        pos,
        data: data.byteLength === 0 ? new ArrayBuffer(blockSize) : data
      });
    }
    return res;
  }

  writeBlocks(writes, blockSize) {
    for (let write of writes) {
      let writer = this.entry.createWriter();
      writer.seek(write.pos);
      writer.write(new Blob([write.data], { type: 'octet/stream' }));
    }
    return 0;
  }
}

export default class webkitFileSystemBackend {
  constructor() {
    // TODO: need to do `navigator.webkitPersistentStorage.requestQuota(10000000, function (quota) { console.log(quota) })`
    this.FS = self.webkitRequestFileSystemSync(self.PERSISTENT, 100000);
    this.rootEntry = this.FS.root.getDirectory('dbs', { create: true });
  }

  createFile(filename) {
    return new File(filename, new FileOps(filename, this.rootEntry));
  }

  startProfile() {
    perf.start();
  }

  stopProfile() {
    perf.stop();
  }
}
