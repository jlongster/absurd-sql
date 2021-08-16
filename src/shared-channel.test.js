import { Reader, Writer } from './shared-channel';
import * as fc from 'fast-check';

// describe('reader/writer', () => {
//   function propTest(data) {
//     // There's a chance this will fill up, but we allocate a large
//     // enough buffer that the prop test never reaches the limit
//     let size = 1000000;
//     let buffer = new ArrayBuffer(size);
//     let writer = new Writer(buffer, {
//       useAtomics: false,
//       stream: false
//     });
//     for (let item of data) {
//       if (typeof item === 'string') {
//         writer.string(item);
//       } else if (typeof item === 'number') {
//         writer.int32(item);
//       } else if (item.buffer) {
//         writer.bytes(item.buffer);
//       } else {
//         throw new Error('Unknown type: ' + item);
//       }
//     }
//     writer.finalize();

//     let reader = new Reader(buffer, {
//       useAtomics: false,
//       stream: false
//     });

//     console.log(new Int32Array(buffer)[0])

//     let i = 0;
//     while (!reader.done()) {
//       let item = data[i];
//       if (typeof item === 'string') {
//         expect(reader.string()).toBe(item);
//       } else if (typeof item === 'number') {
//         expect(reader.int32()).toBe(item);
//       } else if (item.buffer) {
//         expect(reader.bytes()).toEqual(item.buffer);
//       } else {
//         throw new Error('Unknown type: ' + item);
//       }
//       i++;
//     }
//   }

//   it('counter', () => {
//     propTest([-3]);
//   });

//   it('works-it', () => {
//     fc.assert(
//       fc.property(
//         fc.array(fc.oneof(fc.integer(), fc.uint8Array(), fc.string())),
//         propTest
//       ),
//       { numRuns: 2000 }
//     );
//   });
// });

function checkDone(reader) {
  try {
    return reader.done();
  } catch (e) {
    return false;
  }
}

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
    while (!checkDone(reader)) {
      let state = int32[0];

      switch (state) {
        // Readable
        case 1: {
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
        case 0: {
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

  it('counter', () => {
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
