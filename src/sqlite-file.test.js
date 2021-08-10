import {
  readChunks,
  writeChunks,
  File,
  getBoundaryIndexes
} from './sqlite-file';
import MemoryBackend from './memory/backend';
import * as fc from 'fast-check';

function setPageSize(view) {
  if (view.byteLength >= 17) {
    view[16] = 4096 / 256;
    view[17] = 4096 % 256;
  }
  return view;
}

function toArray(buffer) {
  return Array.from(new Uint8Array(buffer));
}

function makeChunks(chunkSize, data) {
  let arr = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    arr.push({
      pos: i,
      data: Int8Array.from(data.slice(i, i + chunkSize)).buffer
    });
  }
  return arr;
}

function zeroBuffer(size) {
  let buffer = new ArrayBuffer(size);
  let view = new Uint8Array(buffer);
  for (let i = 0; i < size; i++) {
    view[i] = 0;
  }
  return buffer;
}

describe('chunks', () => {
  test('reading', () => {
    let chunks = makeChunks(3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    expect(toArray(readChunks(chunks, 1, 7))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(toArray(readChunks(chunks, 0, 7))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(toArray(readChunks(chunks, 0, 10))).toEqual([
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9
    ]);
    expect(toArray(readChunks(chunks, 5, 12))).toEqual([5, 6, 7, 8, 9, 0, 0]);
  });

  test('writing', () => {
    let buffer = new ArrayBuffer(20);
    let view = new Uint8Array(buffer);
    for (let i = 0; i < buffer.byteLength; i++) {
      view[i] = i;
    }

    let pos = 2;
    let chunkSize = 8;

    let offset = 4;
    let length = 10;

    let res = writeChunks(
      new Uint8Array(
        buffer,
        offset,
        Math.max(Math.min(length, buffer.byteLength - length), 0)
      ),
      chunkSize,
      pos,
      pos + length
    );
    expect(res.map(res => ({ ...res, data: toArray(res.data) }))).toEqual([
      { pos: 0, offset: 2, length: 6, data: [0, 0, 4, 5, 6, 7, 8, 9] },
      { pos: 8, offset: 0, length: 4, data: [10, 11, 12, 13, 0, 0, 0, 0] }
    ]);
  });
});

describe('reading file', () => {
  function readPropTest(bufferView, chunkSize, pos, length) {
    setPageSize(bufferView);
    if (bufferView.buffer.byteLength < length) {
      return;
    }

    // Needs the meta with it
    let files = { 'file.db': bufferView.buffer };

    let backend = new MemoryBackend(chunkSize, files);

    let file = backend.createFile('file.db');
    file.open();

    let offset = 0;
    let len = Math.max(
      Math.min(length, bufferView.length - Math.max(pos, 0)),
      0
    );

    let buffer = new ArrayBuffer(Math.max(length, 0));
    let bytesRead = file.read(new Uint8Array(buffer), offset, length, pos);

    if (length < 0 || pos < 0) {
      expect(bytesRead).toBe(0);
      expect(toArray(buffer)).toEqual(toArray(zeroBuffer(Math.max(length, 0))));
    } else {
      expect(bytesRead).toBe(length);

      let testBuffer = new ArrayBuffer(length);
      if (len > 0) {
        new Uint8Array(testBuffer).set(
          new Uint8Array(bufferView.buffer, pos, len)
        );
      }
      expect(toArray(buffer)).toEqual(toArray(testBuffer));
    }
  }

  test('read-counter', () => {
    let counter = [Int8Array.from([]), 1, 0, -1];
    readPropTest(...counter);
  });

  test('read-prop', () => {
    fc.assert(
      fc.property(
        // buffer
        fc.int8Array({ maxLength: 1000 }),
        // chunk size
        fc.integer(1, 1000),
        // position
        fc.integer(-1, 100),
        // length
        fc.integer(-1, 100),
        readPropTest
      ),
      { numRuns: 1000 }
    );
  });
});

// TODO: write prop test for reading file that has pending writes

describe('writing file', () => {
  function applyWrite(
    file,
    original,
    chunkSize,
    writeDataView,
    offset,
    length,
    pos
  ) {
    let bytesWritten = file.write(writeDataView, offset, length, pos);

    // Check bytes written
    let len = Math.min(length, writeDataView.length);
    if (pos < 0 || len <= 0) {
      expect(bytesWritten).toBe(0);
    } else {
      expect(bytesWritten).toBe(len);

      // Manually make the writes into our test buffer
      let fullLength = pos + len;
      // The length of the file must be aligned to the boundary
      let [index] = getBoundaryIndexes(chunkSize, fullLength - 1, fullLength);
      fullLength = index + chunkSize;

      if (fullLength > original.byteLength) {
        // Resize
        let buffer = new ArrayBuffer(fullLength);
        new Uint8Array(buffer).set(new Uint8Array(original));
        original = buffer;
      }

      // Set
      new Uint8Array(original).set(
        new Uint8Array(writeDataView.buffer, offset, len),
        pos,
        len
      );
    }

    return { original, bytesWritten };
  }

  function writePropTest(bufferView, chunkSize, writeDataView, length, pos) {
    setPageSize(bufferView);
    let files = { 'file.db': bufferView.buffer };
    let backend = new MemoryBackend(chunkSize, files);

    let file = backend.createFile('file.db');
    file.open();
    let original = file.ops.data.slice(0);
    let maxPos = file.getattr().size;

    let offset = 0;
    let result = applyWrite(
      file,
      original,
      chunkSize,
      writeDataView,
      offset,
      length,
      pos
    );
    original = result.original;
    if (result.bytesWritten > 0) {
      maxPos = Math.max(maxPos, pos + result.bytesWritten);
    }

    file.fsync();

    let fileInfo = backend.getFile('file.db');
    expect(toArray(fileInfo.ops.data)).toEqual(toArray(original));
    expect(fileInfo.getattr().size).toBe(maxPos);
  }

  function writePropTest2(bufferView, chunkSize, arr) {
    let files = { 'file.db': bufferView.buffer };
    let backend = new MemoryBackend(chunkSize, files);

    let file = backend.createFile('file.db');
    file.open();
    let original2 = file.ops.data.slice(0);
    let original = file.ops.data.slice(0);

    let maxPos = file.getattr().size;

    for (let writeInfo of arr) {
      let offset = 0;
      let [writeDataView, pos, length] = writeInfo;
      let result = applyWrite(
        file,
        original,
        chunkSize,
        writeDataView,
        offset,
        length,
        pos
      );

      original = result.original;

      if (result.bytesWritten > 0) {
        maxPos = Math.max(maxPos, pos + result.bytesWritten);
      }
    }

    expect(toArray(file.ops.data)).toEqual(toArray(original2));
    file.fsync();
    expect(toArray(file.ops.data)).toEqual(toArray(original));

    // let file = backend.getFile('file.db');
    expect(toArray(file.ops.data)).toEqual(toArray(original));
    expect(file.getattr().size).toBe(maxPos);
  }

  test('write-counter', () => {
    let counter = [Uint8Array.from([]), 1, [[Uint8Array.from([0]), 0, 1]]];
    writePropTest2(...counter);
  });

  test('write-prop1', () => {
    fc.assert(
      fc.property(
        // buffer
        fc.uint8Array({ maxLength: 1000 }),
        // block size
        fc.integer(1, 1000),
        // writeData
        fc.uint8Array({ maxLength: 1000 }),
        // position
        fc.integer(-1, 1000),
        // length
        fc.integer(-1, 1000),
        writePropTest
      )
    );
  });

  test('write-prop2', () => {
    fc.assert(
      fc.property(
        // buffer
        fc.uint8Array({ maxLength: 1000 }),
        // block size
        fc.integer(1, 1000),
        // many writes!
        fc.array(
          fc.tuple(
            // writeData
            fc.uint8Array({ maxLength: 1000 }),
            // position
            fc.integer(-1, 1000),
            // length
            fc.integer(-1, 1000)
          )
        ),
        writePropTest2
      ),
      { numRuns: 1000 }
    );
  });
});
