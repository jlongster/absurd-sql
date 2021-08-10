import initSqlJs from '@jlongster/sql.js';
import { SQLiteFS } from '../..';
import * as uuid from 'uuid';
import MemoryBackend from '../../memory/backend';
import IndexedDBBackend from '../../indexeddb/backend';

// Various global state for the demo

let currentBackendType = 'idb';
let cacheSize = 5000;
let pageSize = 8192;
let dbName = `fts.sqlite`;

let idbBackend = new IndexedDBBackend();
let sqlFS;

// Helper methods

let SQL = null;
let ready = null;
async function _init() {
  SQL = await initSqlJs({ locateFile: file => file });
  sqlFS = new SQLiteFS(SQL.FS, idbBackend);
  SQL.register_for_idb(sqlFS);

  SQL.FS.mkdir('/blocked');
  SQL.FS.mount(sqlFS, {}, '/blocked');
}

function init() {
  if (ready) {
    return ready;
  }

  ready = _init();
}

function output(msg) {
  self.postMessage({ type: 'output', msg });
}

function getDBName() {
  return dbName;
}

let _db = null;
function closeDatabase() {
  if (_db) {
    output(`Closed db`);
    _db.close();
    _db = null;
  }
}

async function getDatabase() {
  await init();
  if (_db == null) {
    _db = new SQL.Database(`/blocked/${getDBName()}`, { filename: true });
    // Should ALWAYS use the journal in memory mode. Doesn't make
    // any sense at all to write the journal
    //
    // It's also important to use the same page size that our storage
    // system uses. This will change in the future so that you don't
    // have to worry about sqlite's page size (requires some
    // optimizations)
    _db.exec(`
      PRAGMA cache_size=-${cacheSize};
      PRAGMA page_size=${pageSize};
      PRAGMA journal_mode=MEMORY;
    `);
    _db.exec('VACUUM');
    output(
      `Opened ${getDBName()} (${currentBackendType}) cache size: ${cacheSize}`
    );
  }
  return _db;
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

async function fetchJSON(url) {
  let res = await fetch(url);
  return res.json();
}

async function load() {
  let db = await getDatabase();

  let storyIds = await fetchJSON(
    'https://hacker-news.firebaseio.com/v0/topstories.json?print=pretty'
  );

  let stories = await Promise.all(
    storyIds
      .slice(0, 10)
      .map(storyId =>
        fetchJSON(
          `https://hacker-news.firebaseio.com/v0/item/${storyId}.json?print=pretty`
        )
      )
  );

  let results = [];
  for (let story of stories) {
    let comments = story.kids;

    if (comments && comments.length > 0) {
      for (let commentId of comments.slice(0, 10)) {
        let comment = await fetchJSON(
          `https://hacker-news.firebaseio.com/v0/item/${commentId}.json?print=pretty`
        );

        if (comment && comment.text) {
          results.push({
            id: commentId,
            text: comment.text,
            storyId: story.id,
            storyTitle: story.title
          });
        }
      }
    }
  }

  db.exec('BEGIN TRANSACTION');
  let stmt = db.prepare(
    'INSERT INTO comments (content, url, title) VALUES (?, ?, ?)'
  );
  for (let result of results) {
    let url = `https://news.ycombinator.com/item?id=${result.id}`;
    stmt.run([result.text, url, result.storyTitle]);
  }
  db.exec('COMMIT');
  console.log('done!');

  count();
}

async function search(term) {
  let db = await getDatabase();

  if (!term.includes('NEAR') && !term.match(/"\*/)) {
    term = `"*${term}*"`;
  }

  let results = [];

  let stmt = db.prepare(
    `SELECT snippet(comments) as content, url, title FROM comments WHERE content MATCH ?`
  );
  stmt.bind([term]);
  while (stmt.step()) {
    let row = stmt.getAsObject();
    results.push(row);
  }
  stmt.free();

  self.postMessage({ type: 'results', results });
}

async function count() {
  let db = await getDatabase();

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS comments USING fts3(content, title, url);
  `);

  let stmt = db.prepare('SELECT COUNT(*) as count FROM comments');
  stmt.step();
  let row = stmt.getAsObject();
  self.postMessage({ type: 'count', count: row.count });

  stmt.free();
}

let methods = {
  init,
  load,
  search,
  count
};

if (typeof self !== 'undefined') {
  self.onmessage = msg => {
    switch (msg.data.type) {
      case 'search':
        search(msg.data.name);
        break;

      case 'ui-invoke':
        if (methods[msg.data.name] == null) {
          throw new Error('Unknown method: ' + msg.data.name);
        }
        methods[msg.data.name]();
        break;
    }
  };
} else {
  for (let method of Object.keys(methods)) {
    let btn = document.querySelector(`#${method}`);
    if (btn) {
      btn.addEventListener('click', methods[method]);
    }
  }
  init();
}
