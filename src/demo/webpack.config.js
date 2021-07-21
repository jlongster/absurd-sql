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
      extensions: ['.dev.js', '.js', '.json', '.wasm'],
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
          test: /\/worker\.js$/,
          use: { loader: 'worker-loader' }
        }
      ]
    }
  };
}

module.exports = getConfig('main', './main.js', './index.html');
