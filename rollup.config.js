import webWorkerLoader from 'rollup-plugin-web-worker-loader';

export default {
  input: 'src/index.js',
  output: {
    // file: 'bundle.js',
    dir: 'dist',
    format: 'esm'
  },
  plugins: [
    webWorkerLoader({
      pattern: /.*\.worker\.js/,
      targetPlatform: 'browser'
    })
  ]
};
