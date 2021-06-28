function range(start, end, step) {
  let r = [];
  for (let i = start; i <= end; i += step) {
    r.push(i);
  }
  return r;
}

export function concatChunks(chunks, start, end) {
  let buffer = new Buffer(end - start);
  let view = new Uint8Array(buffer);

  let cursor = 0;
  for (let i = 0; i < chunks.length; i++) {
    console.log(chunks[i]);
    let cstart = 0;
    let cend = chunks[i].byteLength;
    if (start > chunks[i].pos) {
      cstart = start - chunks[i].pos;
    }
    if (end < chunks[i].pos + chunks[i].data.byteLength) {
      cend = end - chunks[i].pos;
    }

    console.log(cstart, cend);
    view.set(new Uint8Array(chunks[i], cstart, cend), cursor);
    cursor += cend - cstart;
  }
  return buffer;
}

class File {
  constructor(chunkSize) {
    this.chunkSize = chunkSize;
    // TODO: make LRU cache
    this.cache = new Map();
  }

  loadMissing(boundaries) {}

  updateCache(chunks) {
    for (let i = 0; i < chunks.length; i++) {
      this.cache.set(chunks[i].pos, chunks[i]);
    }
  }

  getBoundaryIndexes(start, end) {
    let startC = start - (start % this.chunkSize);
    let endC = end - 1 - ((end - 1) % this.chunkSize);

    return range(startC, endC, this.chunkSize);
  }

  load(start, end) {
    let indexes = this.getBoundaryIndexes(start, end);
    let status = boundaries.reduce(
      (acc, b) => {
        let cached = this.chunks.get(b);
        if (cached) {
          acc.cached.push(cached);
        } else {
          acc.missing.push(cached);
        }
        return acc;
      },
      { cached: [], missing: [] }
    );

    let missingChunks = this.loadMissing(status.missing);

    let allChunks = status.cached.concat(missingChunks);
    allChunks.sort((c1, c2) => {
      return c1.pos - c2.pos;
    });

    this.updateCache(allChunks);
    return concatChunks(allChunks, start, end);
  }

  read(buffer, offset, length, position) {
    let readBuffer = this.load(position, position + length);
    let view = new Uint8Array(buffer);
    toView.set(new Uint8Array(readBuffer), offset);
    // TODO: need to check end of file
    return length;
  }

  write(buffer, offset, length, position) {}
}
