import initSqlJs from 'sql.js';
import BlockedFS from '../blockedfs';
import IndexedDBBackend from '../backend-indexeddb';

let backend = new IndexedDBBackend(256);
let SQL;

async function init() {
  SQL = await initSqlJs({ locateFile: file => file });
  SQL._register_for_idb();

  let BFS = new BlockedFS(SQL.FS, backend);
  await BFS.init();

  let FS = SQL.FS;

  console.log('starting');

  FS.mkdir('/blocked');
  FS.mount(BFS, {}, '/blocked');

  FS.mkdir('/blocked/foo');
  FS.mkdir('/blocked/foo/bar');
  FS.mkdir('/blocked/foo/bar2');
  FS.mkdir('/blocked/foo/bar/baz');
  let file = FS.open('/blocked/foo/bar/baz/file.txt', 'w');
  console.log('opened');
  // FS.write(file, 'hello');

  // console.log('foo', FS.readdir('/blocked/foo'));

  // console.log(FS.readFile('/blocked/foo/bar/baz/file.txt'), {
  //   encoding: 'utf8'
  // });
}

self.onmessage = msg => {
  switch (msg.data.type) {
    case 'init':
      init();
      break;
  }
};
