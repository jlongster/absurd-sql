const HtmlWebpackPlugin = require('html-webpack-plugin');

function getConfig(name, entry, html) {
  return {
    name,
    devServer: {
      publicPath: '/',
      hot: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    },
    entry,
    mode: 'development',
    resolve: {
      fallback: {
        crypto: false,
        path: false,
        fs: false
      }
    },
    plugins: [new HtmlWebpackPlugin({ template: html })],
    module: {
      rules: [
        {
          test: /\.worker\.js$/,
          use: { loader: 'worker-loader' }
        }
      ]
    }
  };
}

module.exports = [
  getConfig('basic-memory', './basic-memory.js', './index.html'),
  getConfig('basic-idb', './basic-idb.js', './index.html'),
  getConfig('idb-test', './idb-test.js', './idb-test.html'),
  getConfig('dir', './dir.js', './dir.html')
];
