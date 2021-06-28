import { concatChunks } from './virtual-file';

function makeChunks(chunkSize, data) {
  let arr = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    arr.push({ pos: i, data: Int8Array.from(data.slice(i, i + chunkSize)) });
  }
  return arr;
}

describe('concatChunks', () => {
  test('works', () => {
    let chunks = makeChunks(3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(concatChunks(chunks, 1, 7))).toBe([]);
  });
});
