const queries = require('./queries');

let Database = require('better-sqlite3');
let db = new Database(__dirname + '/db.sqlite');

let cacheSize = 0;

db.exec(`
  PRAGMA cache_size=-${cacheSize};
  PRAGMA journal_mode=MEMORY;
`);

queries.clear(db);
queries.populate(db, 30000);
// queries.randomReads(db, console.log);
queries.sumAll(db);
