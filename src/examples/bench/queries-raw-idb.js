function uid(i) {
  // This will make ids of different lengths, but we want to inject
  // some larger data than just ints (something like a uuid) but we
  // don't want to actually generate uuids because that's slow-ish and
  // we want profiling to show sqlite as much as possible
  return '0000000000000000000000000' + i;
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

export function clear(db, output) {
  let trans = db.transaction(['kv'], 'readwrite');
  let store = trans.objectStore('kv');
  return new Promise((resolve, reject) => {
    let req = store.clear();
    req.onsuccess = resolve;
    req.onerror = reject;
  });
}

export function populate(db, count, output, outputTiming) {
  let start = Date.now();
  let trans = db.transaction(['kv'], 'readwrite');
  let store = trans.objectStore('kv');

  output(`Inserting ${formatNumber(count)} items (raw idb)`);

  return new Promise((resolve, reject) => {
    for (let i = 0; i < count; i++) {
      let id = uid(i);
      let value = (Math.random() * 100) | 0;
      store.put(value, id);
    }
    trans.oncomplete = () => {
      let took = Date.now() - start;
      output('Done! Took: ' + took);
      outputTiming(took);
      resolve();
    };
    trans.onerror = reject;
  });
}

export function sumAll(db, output, outputTiming) {
  let start = Date.now();
  let trans = db.transaction(['kv'], 'readonly');
  let store = trans.objectStore('kv');
  let count = 0;
  output('Running a sum on all values');

  return new Promise((resolve, reject) => {
    let req = store.openCursor();
    let total = 0;
    req.onsuccess = e => {
      let cursor = e.target.result;
      if (cursor) {
        count++;
        total += cursor.value;
        cursor.continue();
      } else {
        let took = Date.now() - start;
        output(`Total sum: ${total} (counted ${count} items), took ${took}`);
        outputTiming(took);
        resolve();
      }
    };
    req.onerror = reject;
  });
}

export function randomReads(db, output) {
  output('randomReads is not implemented for raw idb yet');
  // let trans = db.transaction(['kv'], 'readonly');
  // let store = trans.objectStore('kv');
  // return new Promise((resolve, reject) => {
  // });
}
