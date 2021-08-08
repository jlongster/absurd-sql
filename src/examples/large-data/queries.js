if (globalThis.performance == null) {
  globalThis.performance = require('perf_hooks').performance;
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

function populate(db, output, uuid, count = 1000000) {
  output('Clearing existing data');
  db.exec(`
    BEGIN TRANSACTION;
    DROP TABLE IF EXISTS kv;
    CREATE TABLE kv (key TEXT, value TEXT);
    COMMIT;
  `);

  output('Done');

  let start = Date.now();
  db.exec('BEGIN TRANSACTION');
  let stmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');

  output(`Inserting ${formatNumber(count)} items`);

  for (let i = 0; i < count; i++) {
    stmt.run([uuid.v4(), ((Math.random() * 100000) | 0).toString()]);
  }
  db.exec('COMMIT');
  output('Done! Took: ' + (Date.now() - start));
}

function countAll(db, output) {
  output('Running <code>SELECT COUNT(*) FROM kv</code>');
  let start = performance.now();

  let stmt;
  try {
    stmt = db.prepare(`SELECT COUNT(*) FROM kv`);
  } catch (err) {
    output('Error (make sure you write data first): ' + err.message);
    throw err;
  }
  if (stmt.all) {
    let row = stmt.all();
    output(JSON.stringify(row));
  } else {
    while (stmt.step()) {
      let row = stmt.getAsObject();
      output('<code>' + JSON.stringify(row) + '</code>');
    }
    stmt.free();
  }

  output(
    'Done reading, took ' + formatNumber(performance.now() - start) + 'ms'
  );
  output('That scanned through all 50MB of data');
}

async function randomReads(db, output) {
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

  for (let i = 0; i < 100; i++) {
    let off = i * 300;
    if (canRebind) {
      stmt.bind([off]);
    }
    output('Using offset: ' + formatNumber(off));

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
        let row = stmt.getAsObject();
        if (num === 999) {
          output('(999 items hidden)');
        } else if (num > 998) {
          output('<code>' + JSON.stringify(row) + '</code>');
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

  output('Done reading, took ' + formatNumber(Date.now() - start) + 'ms');
}

module.exports = { populate, countAll, randomReads };
