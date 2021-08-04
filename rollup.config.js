import webWorkerLoader from 'rollup-plugin-web-worker-loader';
import { nodeResolve } from '@rollup/plugin-node-resolve';

function getConfig(entry, filename, perf) {
  // Remove the extension
  let basename = filename.replace(/\.[^.]*/, '');

  return {
    input: entry,
    output: {
      dir: perf ? 'dist/perf' : 'dist',
      entryFileNames: filename,
      chunkFileNames: `${basename}-[name]-[hash].js`,
      format: 'esm',
      exports: 'named'
    },
    external: ['perf-deets'],
    plugins: [
      webWorkerLoader({
        pattern: /.*\/worker\.js/,
        targetPlatform: 'browser',
        external: []
      }),
      nodeResolve({
        extensions: (perf ? ['.dev.js'] : []).concat(['.js'])
      })
    ]
  };
}

export default [
  getConfig('src/index.js', 'index.js'),
  getConfig('src/memory/backend.js', 'memory-backend.js'),
  getConfig('src/indexeddb/backend.js', 'indexeddb-backend.js'),
  getConfig('src/indexeddb/main-thread.js', 'indexeddb-main-thread.js'),
  getConfig('src/indexeddb/backend.js', 'indexeddb-backend.js', true),
  getConfig('src/indexeddb/main-thread.js', 'indexeddb-main-thread.js', true)
];
