const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  devServer: {
    publicPath: '/',
    hot: true
  },
  entry: './index.js',
  mode: 'development',
  resolve: {
    fallback: {
      crypto: false,
      path: false,
      fs: false
    }
  },
  // module: {
  //   rules: [
  //     {
  //       test: /\.js$/,
  //       use: [
  //         {
  //           loader: 'babel-loader',
  //           options: {
  //             presets: ['@babel/preset-react']
  //           }
  //         }
  //       ]
  //     },
  //     {
  //       test: /\.css$/,
  //       use: [
  //         {
  //           loader: 'style-loader'
  //         },
  //         {
  //           loader: 'css-loader',
  //           options: {
  //             importLoaders: 2,
  //             sourceMap: true
  //           }
  //         }
  //       ]
  //     }
  //   ]
  // },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html'
    })
  ]
};
