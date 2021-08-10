export let LOCK_TYPES = {
  NONE: 0,
  SHARED: 1,
  RESERVED: 2,
  PENDING: 3,
  EXCLUSIVE: 4
};

export function getPageSize(bufferView) {
  // See 1.3.2 on https://www.sqlite.org/fileformat.html The page size
  // is stored as a 2 byte integer at the 16th byte. It's stored as
  // big-endian so the first byte is the larger one. Combine it into a
  // single integer.
  let int1 = bufferView[16];
  let int2 = bufferView[17];
  return (int1 << 8) + int2;
}

export function isSafeToWrite(localData, diskData) {
  if (localData != null && diskData != null) {
    let localView = new Uint8Array(localData);
    let diskView = new Uint8Array(diskData);

    // See
    // https://github.com/sqlite/sqlite/blob/master/src/pager.c#L93-L96
    // (might be documented somewhere? I didn't see it this clearly in
    // the docs). At least one of these bytes change when sqlite3 writes
    // data. We can check this against our in-memory data to see if it's
    // safe to write (if something changes underneath us, it's not)
    for (let i = 24; i < 40; i++) {
      if (localView[i] !== diskView[i]) {
        return false;
      }
    }
    return true;
  }

  // One of them is null, so it's only safe if to write if both are
  // null, otherwise they are different
  return localData == null && diskData == null;
}
