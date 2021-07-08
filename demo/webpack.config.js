const HtmlWebpackPlugin = require('html-webpack-plugin');

function getConfig(name, entry, html) {
  return {
    name,
    devServer: {
      publicPath: '/',
      hot: true
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
    plugins: [new HtmlWebpackPlugin({ template: html })]
  };
}

module.exports = [
  getConfig('basic-memory', './basic-memory.js', './index.html'),
  getConfig('basic-idb', './basic-idb.js', './index.html'),
  getConfig('idb-test', './idb-test.js', './idb-test.html')
];
