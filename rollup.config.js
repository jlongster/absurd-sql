import webWorkerLoader from 'rollup-plugin-web-worker-loader';

function getConfig(entry, filename) {
  return {
    input: entry,
    output: {
      file: `dist/${filename}`,
      format: 'esm',
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
  getConfig('src/index.js', 'index.js'),
  getConfig('src/memory/backend.js', 'memory-backend.js'),
  getConfig('src/indexeddb/backend.js', 'indexeddb-backend.js')
];
