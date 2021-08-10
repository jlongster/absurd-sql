if (globalThis.performance == null) {
  globalThis.performance = require('perf_hooks').performance;
}

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

async function clear(db, output = console.log) {
  output('Clearing existing data');
  db.exec(`
    BEGIN TRANSACTION;
    DROP TABLE IF EXISTS kv;
    CREATE TABLE kv (key TEXT, value TEXT);
    COMMIT;
  `);
  output('Done');
}

function populate(db, count, output = console.log, outputTiming = console.log) {
  let start = Date.now();
  db.exec('BEGIN TRANSACTION');
  let stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');

  output(`Inserting ${formatNumber(count)} items`);

  for (let i = 0; i < count; i++) {
    stmt.run([uid(i), ((Math.random() * 100) | 0).toString()]);
  }
  db.exec('COMMIT');
  let took = Date.now() - start;
  output('Done! Took: ' + took);
  outputTiming(took);
}

function sumAll(db, output = console.log, outputTiming = console.log) {
  output('Running <code>SELECT COUNT(*) FROM kv</code>');

  let stmt;
  try {
    stmt = db.prepare(`SELECT SUM(value) FROM kv`);
  } catch (err) {
    output('Error (make sure you write data first): ' + err.message);
    throw err;
  }

  let start = performance.now();
  let row;

  if (stmt.all) {
    let row = stmt.all();
    output(JSON.stringify(row));
  } else {
    while (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
  }

  let took = performance.now() - start;
  output('<code>' + JSON.stringify(row) + '</code>');

  outputTiming(took);
  output('Done reading, took ' + formatNumber(took) + 'ms');
  output('That scanned through all of the data');
}

async function randomReads(
  db,
  output = console.log,
  outputTiming = console.log
) {
  output(
    'Running <code>SELECT key FROM kv LIMIT 1000 OFFSET ?</code> 20 times with increasing offset'
  );
  let start = Date.now();

  let stmt;
  try {
    stmt = db.prepare(`SELECT key FROM kv LIMIT 1000 OFFSET ?`);
  } catch (err) {
    output('Error (make sure you write data first): ' + err.message);
    throw err;
  }

  let canRebind = !!stmt.reset;

  for (let i = 0; i < 20; i++) {
    let off = i * 300;
    if (canRebind) {
      stmt.bind([off]);
    }
    // output('Using offset: ' + formatNumber(off));

    if (stmt.all) {
      // better-sqlite3 doesn't allow you to rebind the same
      // statement. This is probably a tiny perf hit, but negligable
      // for what we're measuring (it's already so much faster anyway)
      stmt = db.prepare(`SELECT key FROM kv LIMIT 2000 OFFSET ${off}`);
      let rows = stmt.all();
      console.log(rows[rows.length - 1]);
    } else {
      let num = 0;
      while (stmt.step()) {
        num++;
        let row = stmt.get();
        if (num === 999) {
          // output('(999 items hidden)');
        } else if (num > 998) {
          // output('<code>' + JSON.stringify(row) + '</code>');
        }
      }
    }

    if (canRebind) {
      stmt.reset();
    }
  }

  if (stmt.free) {
    stmt.free();
  }

  let took = Date.now() - start;
  outputTiming(took);
  output('Done reading, took ' + formatNumber(took) + 'ms');
}

module.exports = { clear, populate, sumAll, randomReads };
