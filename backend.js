let syncifyWorker = new Worker('syncify.js');

function get_string(buf) {
  return String.fromCharCode
    .apply(null, new Uint16Array(buf))
    .replace(/\u0000/g, '');
}

function put_string(buf, str) {
  var bufView = new Uint16Array(buf);
  for (var i = 0, strLen = str.length; i < strLen; i++) {
    Atomics.store(bufView, i, str.charCodeAt(i));
  }
  return buf;
}

function loadURL(sab, urlSab, url) {
  sab[0] = 0;

  let view = new Int32Array(sab);
  let urlView = new Int32Array(urlSab);

  put_string(urlSab, url);
  Atomics.notify(urlView, 0, 1);
  Atomics.wait(view, 0, 0);

  return JSON.parse(get_string(sab));
}

function run() {
  // SYNCHRONOUS!!
  console.log(
    loadURL(sab, urlSab, 'https://jsonplaceholder.typicode.com/todos/1')
  );
}

let sab = new SharedArrayBuffer(10000);
let urlSab = new SharedArrayBuffer(10000);
syncifyWorker.postMessage([sab, urlSab]);

syncifyWorker.onmessage = msg => {
  switch (msg.data.type) {
    case 'syncify-ready':
      // run();
      let f = self.webkitRequestFileSystemSync(self.PERSISTENT, 1000);
      console.log(f);
  }
};
