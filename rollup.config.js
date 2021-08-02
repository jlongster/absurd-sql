import webWorkerLoader from 'rollup-plugin-web-worker-loader';

function getConfig(entry, filename, format) {
  return {
    input: entry,
    output: {
      file: `dist/${filename}`,
      format,
      exports: 'named'
    },
    plugins: [
      webWorkerLoader({
        pattern: /.*\/worker\.js/,
        targetPlatform: 'browser'
      })
    ]
  };
}

export default [
  getConfig('src/index.js', 'index.cjs.js', 'cjs'),
  getConfig('src/index.js', 'index.esm.js', 'esm'),
  getConfig('src/memory/backend.js', 'memory-backend.cjs.js', 'cjs'),
  getConfig('src/memory/backend.js', 'memory-backend.esm.js', 'esm'),
  getConfig('src/indexeddb/backend.js', 'indexeddb-backend.cjs.js', 'cjs'),
  getConfig('src/indexeddb/backend.js', 'indexeddb-backend.esm.js', 'esm')
];
