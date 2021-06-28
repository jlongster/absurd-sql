function get_string(buf) {
  return String.fromCharCode
    .apply(null, new Uint16Array(buf))
    .replace(/\u0000/g, '');
}

function put_string(buf, str) {
  var bufView = new Uint16Array(buf);
  for (var i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

async function run(url, sab) {
  let res = await fetch(url);
  let json = await res.json();

  put_string(sab, JSON.stringify(json));

  let view = new Int32Array(sab);
  Atomics.notify(view, 0, 1);
}

async function listen(sab, urlSab) {
  let view = new Int32Array(urlSab);

  while (1) {
    Atomics.wait(view, 0, 0);

    let url = get_string(urlSab);
    view[0] = 0;
    await run(url, sab);
  }
}

self.onmessage = msg => {
  postMessage({ type: 'syncify-ready' });

  let [sab, urlSab] = msg.data;
  listen(sab, urlSab);
};
