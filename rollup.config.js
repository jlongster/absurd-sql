import webWorkerLoader from 'rollup-plugin-web-worker-loader';
import { nodeResolve } from '@rollup/plugin-node-resolve';

function getConfig(entry, filename, perf) {
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
  getConfig('src/index.js', 'perf/index.js', true),
  getConfig('src/memory/backend.js', 'perf/memory-backend.js', true),
  getConfig('src/indexeddb/backend.js', 'perf/indexeddb-backend.js', true)
];
