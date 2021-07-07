

self.onmessage = msg => {
  postMessage({ type: 'worker-ready' });

  let [sab, urlSab] = msg.data;
  listen(sab, urlSab);
};
