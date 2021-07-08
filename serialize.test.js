import { Reader, Writer } from './serialize';
import * as fc from 'fast-check';

describe('reader/writer', () => {
  function propTest(data) {
    // There's a chance this will fill up, but we allocate a large
    // enough buffer that the prop test never reaches the limit
    let size = 1000000;
    let buffer = new ArrayBuffer(size);
    let writer = new Writer(buffer, {
      useAtomics: false,
      stream: false
    });
    for (let item of data) {
      if (typeof item === 'string') {
        writer.string(item);
      } else if (typeof item === 'number') {
        writer.int32(item);
      } else if (item.buffer) {
        writer.bytes(item.buffer);
      } else {
        throw new Error('Unknown type: ' + item);
      }
    }
    writer.finalize();

    let reader = new Reader(buffer, {
      useAtomics: false,
      stream: false
    });

    let i = 0;
    while (!reader.done()) {
      let item = data[i];
      if (typeof item === 'string') {
        expect(reader.string()).toBe(item);
      } else if (typeof item === 'number') {
        expect(reader.int32()).toBe(item);
      } else if (item.buffer) {
        expect(reader.bytes()).toEqual(item.buffer);
      } else {
        throw new Error('Unknown type: ' + item);
      }
      i++;
    }
  }

  it.skip('counter', () => {
    propTest([-3]);
  });

  it('works', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.integer(), fc.uint8Array(), fc.string())),
        propTest
      ),
      { numRuns: 2000 }
    );
  });
});

describe('reader/writer worker', () => {
  function propTest(data) {
    // There's a chance this will fill up, but we allocate a large
    // enough buffer that the prop test never reaches the limit
    let size = 1000000;
    let buffer = new ArrayBuffer(size);
    let writer = new Writer(buffer, {
      useAtomics: false,
      stream: true
    });
    let reader = new Reader(buffer, {
      useAtomics: false,
      stream: true
    });

    let int32 = new Int32Array(buffer);
    let cur = 0;
    let writeLog = [];
    while (!reader.done()) {
      let state = int32[0];
      switch (state) {
        // Readable
        case 0: {
          let item = writeLog.shift();
          if (typeof item === 'string') {
            expect(reader.string()).toBe(item);
          } else if (typeof item === 'number') {
            expect(reader.int32()).toBe(item);
          } else if (item.buffer) {
            expect(reader.bytes()).toEqual(item.buffer);
          } else {
            throw new Error('Unknown type: ' + item);
          }
          break;
        }

        // Writable
        case 1: {
          if (cur < data.length) {
            let item = data[cur];

            if (typeof item === 'string') {
              writer.string(item);
            } else if (typeof item === 'number') {
              writer.int32(item);
            } else if (item.buffer) {
              writer.bytes(item.buffer);
            } else {
              throw new Error('Unknown type: ' + item);
            }

            writeLog.push(item);
            cur++;
          } else {
            writer.finalize();
          }
          break;
        }

        default:
          throw new Error('Unknown read/write state: ' + state);
      }
    }
    expect(writeLog.length).toBe(0);
  }

  it.skip('counter', () => {
    propTest([-2]);
  });

  it('works', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.integer(), fc.uint8Array(), fc.string())),
        propTest
      ),
      { numRuns: 2000 }
    );
  });
});
