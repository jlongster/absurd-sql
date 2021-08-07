const queries = require('./queries');
const uuid = require('uuid');

let Database = require('better-sqlite3');
let db = new Database(__dirname + '/db.sqlite');

let cacheSize = 0;

db.exec(`
  PRAGMA cache_size=-${cacheSize};
  PRAGMA journal_mode=MEMORY;
`);

// queries.populate(db, console.log, uuid);
queries.countAll(db, console.log);
